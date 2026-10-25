// Paper fills for resting (maker) orders, from the public feed only: where our order would sit in the queue,
// and when the exchange's trades would have reached it.
//
// The rules (ROADMAP Etap 2):
//   - An order joins the queue latencyMs after it is placed (activeAt). Its queueAhead is the level's size at
//     that moment; a price nobody was quoting → queueAhead 0. Events inside the latency window are ignored.
//   - Post-only: an order that would cross the book when it becomes active is rejected.
//   - Trade volume is the authority. A level decrease is never applied straight away: it waits in a pending
//     buffer and is matched with trades at that level within ±300 ms, in either order. What no trade explains
//     when the window closes is a cancel (cancelMode). A resync decrease is never a fill.
//   - Books are mirrored (YES ask P = NO bid 1−P), so the queue and the buffer come from the order's own token.
//     Trades are not: one match can be reported on either token or on both. The trade stream is unified —
//     a NO SELL at 1−P is a YES BUY at P — and a match reported on both tokens is counted once (same txHash,
//     size, P ↔ 1−P, opposite side). Measured 2026-10-25 (10 min, 4241 trades): 99.9% of matches are
//     reported on one token only.
//   - Effective side: a trade that matches a decrease already in the buffer takes its side from that level;
//     the reported side is used only when nothing matches.
//   - Fill sources: trade_at_level (trade at our price, after the queue ahead), trade_through (traded past our
//     price), cross (the other side of the book reached our price; only with crossFill).
import { EventEmitter } from "node:events";

const EPS = 1e-9;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// Polymarket taker fee: shares × r × (p(1−p))^e, fd = { r, e } from /clob-markets.
export function takerFee(shares, p, fd) {
  if (!fd || !Number.isFinite(fd.r)) throw new Error("takerFee needs the market's fee data (fd)");
  return shares * fd.r * (p * (1 - p)) ** (fd.e ?? 1);
}

// A price on the tick grid: a SELL rounds up, a BUY rounds down (never a better price than asked for).
export function roundToTick(price, tick, side) {
  const n = r6(price / tick);
  const k = side === "SELL" ? Math.ceil(n - EPS) : Math.floor(n + EPS);
  return r6(k * tick);
}

// Shares for a dollar amount at a price, in 0.01 steps, at least the exchange minimum (5).
export function sharesForUsd(usd, price, min = 5) {
  if (!(price > 0)) return 0;
  return Math.max(min, Math.floor(r6((usd / price) * 100)) / 100);
}

// Walk the book as a taker. side "BUY" eats asks from the lowest, "SELL" eats bids from the highest.
// levels: Map<price, size> → { filled, avgPrice, cost, levels: [[price, qty], …] }
export function sweep(levels, qty, side) {
  const prices = [...levels.keys()].sort((a, b) => (side === "BUY" ? a - b : b - a));
  let left = qty;
  let cost = 0;
  const used = [];
  for (const p of prices) {
    if (left <= EPS) break;
    const q = Math.min(left, levels.get(p));
    if (q <= 0) continue;
    used.push([p, q]);
    cost += p * q;
    left -= q;
  }
  const filled = qty - Math.max(0, left);
  return { filled: r6(filled), avgPrice: filled > 0 ? cost / filled : null, cost, levels: used };
}

// Markouts: how the mid moved after a fill. SELL markout = fillPrice − midLater; BUY = midLater − fillPrice.
export class MarkoutTracker {
  constructor({ horizons = [5_000, 30_000] } = {}) {
    this.horizons = horizons;
    this.open = [];
  }
  track(fill) {
    this.open.push({ ...fill, marks: {} });
  }
  // midOf(assetId) → mid or null. Returns the fills whose last horizon completed.
  tick(now, midOf) {
    const done = [];
    for (const f of this.open) {
      for (const h of this.horizons) {
        if (h in f.marks || now < f.at + h) continue;
        const mid = midOf(f.assetId);
        f.marks[h] = mid == null ? null : f.side === "SELL" ? f.price - mid : mid - f.price;
      }
      if (this.horizons.every((h) => h in f.marks)) done.push(f);
    }
    if (done.length) this.open = this.open.filter((f) => !done.includes(f));
    return done;
  }
}

const mid = (b) => {
  const bb = b?.bestBid();
  const ba = b?.bestAsk();
  return bb && ba ? (bb.price + ba.price) / 2 : null;
};
export const midOf = (book) => mid(book);

export class FillModel extends EventEmitter {
  // book(assetId) → OrderBook (the feed's), complementOf(assetId) → the market's other token
  constructor({ book, complementOf = () => null, latencyMs = 400, cancelMode = "pessimistic", crossFill = true, matchWindowMs = 300, dedupMs = 50, now = Date.now } = {}) {
    super();
    if (!["pessimistic", "proportional"].includes(cancelMode)) throw new Error(`cancelMode ${cancelMode}?`);
    Object.assign(this, { book, complementOf, latencyMs, cancelMode, crossFill, matchWindowMs, dedupMs, now });
    this.orders = new Map(); // id → order
    this.pending = []; // level decreases waiting for a trade: { assetId, side, price, qty, left, prevSize, at, source }
    this.recentTrades = []; // trades at a level still able to explain a later decrease: { assetId, side, price, left, at }
    this.seen = []; // unified trades, for dedup: { a, price, side, size, ts }
    this.stats = { trades: 0, duplicates: 0, sideOverridden: 0, cancelsQty: 0, matchedQty: 0 };
  }

  // { id, assetId, side: "SELL"|"BUY", price, size, placedAt? }
  place(o) {
    const placedAt = o.placedAt ?? this.now();
    const order = {
      id: o.id,
      assetId: o.assetId,
      side: o.side,
      price: r6(o.price),
      size: o.size,
      placedAt,
      activeAt: placedAt + this.latencyMs,
      status: "pending", // pending → active → filled | cancelled | rejected
      queueAhead: null,
      queueAheadAtPlace: null,
      filled: 0,
      fills: [],
    };
    this.orders.set(order.id, order);
    return order;
  }

  cancel(id) {
    const o = this.orders.get(id);
    if (!o || o.status === "filled" || o.status === "cancelled" || o.status === "rejected") return o || null;
    o.status = "cancelled";
    o.doneAt = this.now();
    this.emit("done", o);
    return o;
  }

  // the side of our own token's book an order rests on
  restSide = (o) => (o.side === "SELL" ? "ask" : "bid");

  activate(o, at) {
    if (o.status !== "pending" || at < o.activeAt) return;
    const b = this.book(o.assetId);
    const bb = b?.bestBid()?.price;
    const ba = b?.bestAsk()?.price;
    if ((o.side === "SELL" && bb != null && bb >= o.price - EPS) || (o.side === "BUY" && ba != null && ba <= o.price + EPS)) {
      o.status = "rejected";
      o.reason = "post-only: would cross";
      o.doneAt = at;
      this.emit("reject", o);
      this.emit("done", o);
      return;
    }
    const levels = o.side === "SELL" ? b?.asks : b?.bids;
    o.queueAhead = levels?.get(o.price) || 0;
    o.queueAheadAtPlace = o.queueAhead;
    o.status = "active";
    o.activatedAt = at;
    this.emit("active", o);
  }

  activateDue(at) {
    for (const o of this.orders.values()) if (o.status === "pending" && at >= o.activeAt) this.activate(o, at);
  }

  fill(o, qty, source, at) {
    qty = Math.min(qty, o.size - o.filled);
    if (qty <= EPS) return;
    o.filled = r6(o.filled + qty);
    const f = { orderId: o.id, assetId: o.assetId, side: o.side, price: o.price, qty: r6(qty), source, at, queueAheadAtPlace: o.queueAheadAtPlace, timeToFillMs: at - o.placedAt };
    o.fills.push(f);
    this.emit("fill", f);
    if (o.filled >= o.size - EPS) {
      o.status = "filled";
      o.doneAt = at;
      this.emit("done", o);
    }
  }

  live(assetId, side, price) {
    const out = [];
    for (const o of this.orders.values())
      if (o.status === "active" && o.assetId === assetId && this.restSide(o) === side && Math.abs(o.price - price) < EPS) out.push(o);
    return out;
  }

  // A level change from the feed (lib/clob-ws.js "level" event) on any token.
  onLevel(e) {
    const at = e.recvTs ?? this.now();
    this.activateDue(at);
    this.expire(at);
    if (e.newSize < e.prevSize) {
      const price = r6(e.price);
      let qty = e.prevSize - e.newSize;
      // a trade that came first explains this decrease (resync decreases are never trades)
      if (e.source !== "resync")
        for (const t of this.recentTrades) {
          if (qty <= EPS) break;
          if (t.left <= EPS || t.assetId !== e.assetId || t.side !== e.side || t.price !== price || Math.abs(at - t.at) > this.matchWindowMs) continue;
          const q = Math.min(t.left, qty);
          t.left -= q;
          qty -= q;
          this.stats.matchedQty += q;
        }
      // Every decrease waits here, not just those at our levels: a trade's effective side is read from them.
      // An order only ever looks at its own token's entries; a decrease and its mirror on the other token
      // (opposite side, 1−P, same size) are linked so the metrics count them once.
      if (qty > EPS) {
        const d = { assetId: e.assetId, side: e.side, price, qty, left: qty, prevSize: e.prevSize, at, source: e.source, mirror: null };
        const other = this.complementOf(e.assetId);
        if (other != null) {
          const mp = r6(1 - price);
          const ms = e.side === "ask" ? "bid" : "ask";
          const m = this.pending.find((x) => !x.mirror && x.assetId === other && x.side === ms && x.price === mp && Math.abs(x.qty - qty) < EPS && Math.abs(x.at - at) <= this.dedupMs);
          if (m) {
            d.mirror = m;
            m.mirror = d;
          }
        }
        this.pending.push(d);
      }
      if (qty < e.prevSize - e.newSize - EPS) this.clamp(e.assetId, e.side, price);
    }
    if (this.crossFill) this.checkCross(e.assetId, at);
  }

  // A trade from the feed ("trade" event) on either token of a market.
  onTrade(t) {
    const at = t.recvTs ?? this.now();
    this.activateDue(at);
    this.expire(at);
    const other = this.complementOf(t.assetId);
    const side = this.effectiveSide(t, other, at);
    // one view of the match: in terms of the lower token id of the pair
    const flip = other != null && other < t.assetId;
    const u = flip
      ? { a: other, price: r6(1 - t.price), side: side === "BUY" ? "SELL" : "BUY", size: t.size, ts: t.ts, tx: t.txHash }
      : { a: t.assetId, price: r6(t.price), side, size: t.size, ts: t.ts, tx: t.txHash };
    this.seen = this.seen.filter((s) => at - s.at < 5_000);
    // A duplicate is the same match reported on the other token: same transaction AND same size AND P ↔ 1−P
    // AND opposite side (all of it shows up as equal in the one view). One transaction can carry several
    // maker matches, so the hash alone isn't enough.
    const dup = this.seen.find(
      (s) => s.from !== t.assetId && !!s.tx && s.tx === u.tx && s.a === u.a && s.price === u.price && s.side === u.side && Math.abs(s.size - u.size) < EPS && Math.abs(s.ts - u.ts) <= this.dedupMs,
    );
    if (dup) {
      this.stats.duplicates++;
      return;
    }
    this.seen.push({ ...u, at, from: t.assetId });
    this.stats.trades++;
    for (const asset of [u.a, this.complementOf(u.a)].filter((x) => x != null)) {
      // the same match seen from this token: price and taker side
      const own = asset === u.a ? u : { price: r6(1 - u.price), side: u.side === "BUY" ? "SELL" : "BUY" };
      this.tradeOn(asset, own.price, own.side, u.size, at);
    }
  }

  // The taker side as the book shows it: if a level at the trade's price already went down (on this token, or
  // its mirror at 1−P on the other one), the side of that level decides; otherwise the reported side stands.
  // About 5% of reported sides disagree with the book (cross-token matching).
  effectiveSide(t, other, at) {
    const p = r6(t.price);
    const q = r6(1 - t.price);
    const hit = (asset, price) =>
      this.pending.find((d) => d.left > EPS && d.source !== "resync" && d.assetId === asset && d.price === price && Math.abs(at - d.at) <= this.matchWindowMs);
    let side = t.side;
    const own = hit(t.assetId, p);
    if (own) side = own.side === "ask" ? "BUY" : "SELL";
    else if (other != null) {
      const mirror = hit(other, q); // their bid at 1−P is our ask at P
      if (mirror) side = mirror.side === "bid" ? "BUY" : "SELL";
    }
    if (side !== t.side) this.stats.sideOverridden++;
    return side;
  }

  // A taker BUY at `price` on `assetId` consumes asks up to that price; a taker SELL consumes bids down to it.
  tradeOn(assetId, price, takerSide, size, at) {
    const restSide = takerSide === "BUY" ? "ask" : "bid";
    this.recentTrades = this.recentTrades.filter((x) => at - x.at <= this.matchWindowMs);
    let unexplained = size;
    // decreases that came before this trade
    for (const p of this.pending) {
      if (unexplained <= EPS) break;
      if (p.left <= EPS || p.assetId !== assetId || p.side !== restSide || p.price !== price || p.source === "resync" || Math.abs(at - p.at) > this.matchWindowMs) continue;
      const q = Math.min(p.left, unexplained);
      p.left -= q;
      unexplained -= q;
      if (!this.isMirrorCopy(p)) this.stats.matchedQty += q;
    }
    this.recentTrades.push({ assetId, side: restSide, price, left: unexplained, at });
    for (const o of this.orders.values()) {
      if (o.status !== "active" || o.assetId !== assetId || this.restSide(o) !== restSide) continue;
      const through = o.side === "SELL" ? price > o.price + EPS : price < o.price - EPS;
      if (through) {
        this.fill(o, o.size - o.filled, "trade_through", at);
        continue;
      }
      if (Math.abs(price - o.price) > EPS) continue;
      const fillQty = Math.max(0, size - o.queueAhead);
      o.queueAhead = Math.max(0, o.queueAhead - size);
      if (fillQty > EPS) this.fill(o, fillQty, "trade_at_level", at);
    }
    this.clamp(assetId, restSide, price);
  }

  // cross = the other side of the book reached our price: the price went through us. Always an adverse fill.
  checkCross(assetId, at) {
    const b = this.book(assetId);
    if (!b) return;
    const bb = b.bestBid()?.price;
    const ba = b.bestAsk()?.price;
    for (const o of this.orders.values()) {
      if (o.status !== "active" || o.assetId !== assetId) continue;
      if ((o.side === "SELL" && bb != null && bb >= o.price - EPS) || (o.side === "BUY" && ba != null && ba <= o.price + EPS)) this.fill(o, o.size - o.filled, "cross", at);
    }
  }

  // Decreases no trade explained within the window are cancels.
  expire(at) {
    if (!this.pending.length) return;
    const done = this.pending.filter((p) => at - p.at > this.matchWindowMs);
    if (!done.length) return;
    this.pending = this.pending.filter((p) => at - p.at <= this.matchWindowMs);
    for (const p of done) {
      if (p.left <= EPS) continue;
      // a mirror pair is one cancel: counted on the lower token id's entry
      if (!this.isMirrorCopy(p)) this.stats.cancelsQty += p.mirror ? Math.max(p.left, p.mirror.left) : p.left;
      if (this.cancelMode === "proportional")
        for (const o of this.live(p.assetId, p.side, p.price)) if (p.prevSize > 0) o.queueAhead = Math.max(0, o.queueAhead - (p.left * o.queueAhead) / p.prevSize);
    }
    for (const p of done) this.clamp(p.assetId, p.side, p.price);
  }

  // the second half of a mirror pair (the higher token id): it never adds to the metrics
  isMirrorCopy = (p) => !!p.mirror && p.assetId > p.mirror.assetId;

  // After reconciliation the queue ahead can't be more than what's on the level — unless part of a decrease
  // there is still waiting for its trade.
  clamp(assetId, side, price) {
    if (this.pending.some((p) => p.left > EPS && p.assetId === assetId && p.side === side && p.price === price)) return;
    const b = this.book(assetId);
    const size = (side === "ask" ? b?.asks : b?.bids)?.get(price) || 0;
    for (const o of this.live(assetId, side, price)) if (o.queueAhead > size) o.queueAhead = size;
  }

  // Call regularly (e.g. every 100 ms): activates due orders and closes the match window.
  tick(at = this.now()) {
    this.activateDue(at);
    this.expire(at);
  }

  prune(olderThanMs = 10 * 60_000) {
    const t = this.now();
    for (const [id, o] of this.orders) if (o.doneAt && t - o.doneAt > olderThanMs) this.orders.delete(id);
  }
}
