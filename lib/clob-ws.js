// Polymarket CLOB market-channel feed: a local L2 book per token, kept from the public WebSocket.
// No key, no account, no dependency: Node's built-in WebSocket (Node 22+).
//
//   ClobFeed  one WebSocket connection and the tokens on it
//   FeedPool  several connections (one connection drops at ~60 tokens), one event stream
//   RawLog    every frame to data/ws-raw/YYYY-MM-DD-HH.jsonl.gz, one gzip member per flush
//
// Events (ClobFeed and FeedPool):
//   level        { assetId, side: "bid"|"ask", price, newSize, prevSize, ts, recvTs, source }
//                source: price_change | snapshot | bbo_heal | resync
//   trade        { assetId, market, price, size, side (taker), ts, recvTs, txHash }
//   tick         { assetId, oldTick, newTick, ts }
//   stale        { assetId, reason }      fresh { assetId }
//   reconnected  { conn, attempt }
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
export const CLOB = "https://clob.polymarket.com";

const PING_MS = 10_000;
const PONG_TIMEOUT_MS = 25_000;
const BACKOFF_MIN = 1_000;
const BACKOFF_MAX = 30_000;
const HEALTHY_RESET_MS = 60_000;

const SHADOW_MS = 50_000; // every token re-checked at least this often, so a drift lives under 60 s
const SHADOW_PRIORITY_MS = 15_000; // tokens we have orders on
const SHADOW_INFLIGHT = 4;
const SHADOW_TIMEOUT_MS = 5_000;
const REST_SAMPLE_MS = 5 * 60_000;
const LOG_MS = 15_000;
const LOG_MAX = 4_000;

const num = (x) => (x === undefined || x === null || x === "" ? NaN : Number(x));

// A book message (WS or REST) as two maps, levels with size 0 dropped.
export function bookMaps(m) {
  const side = (list) => {
    const out = new Map();
    for (const l of list || []) if (num(l.size) > 0) out.set(num(l.price), num(l.size));
    return out;
  };
  return { bids: side(m?.bids), asks: side(m?.asks) };
}

export const sameMaps = (a, b) => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

const topOfMaps = ({ bids, asks }) => {
  let bid = -Infinity;
  let ask = Infinity;
  for (const p of bids.keys()) if (p > bid) bid = p;
  for (const p of asks.keys()) if (p < ask) ask = p;
  return {
    bid: bid === -Infinity ? null : bid,
    bidSize: bid === -Infinity ? null : bids.get(bid),
    ask: ask === Infinity ? null : ask,
    askSize: ask === Infinity ? null : asks.get(ask),
  };
};

// One token's book. Prices and sizes are numbers; a level with size 0 is removed.
export class OrderBook {
  constructor(assetId) {
    this.assetId = assetId;
    this.market = null;
    this.bids = new Map();
    this.asks = new Map();
    this.tickSize = null;
    this.hash = null;
    this.lastUpdateTs = 0; // exchange timestamp of the last change
    this.lastMsgAt = 0; // local receive time of the last message about this token
    this.hasSnapshot = false;
    this.freshAt = 0;
    // Recent changes, each tagged with the exchange's book hash after it. The hash covers the whole book,
    // so a snapshot from anywhere (a second connection, REST) can be lined up with our book exactly.
    this.log = []; // { hash, ts, recvTs, changes: [[side, price, prevSize, newSize], …] }
  }

  record(hash, ts, recvTs, changes) {
    this.log.push({ hash, ts, recvTs, changes });
    while (this.log.length > LOG_MAX || (this.log.length && recvTs - this.log[0].recvTs > LOG_MS)) this.log.shift();
  }

  // Our book as it was when the exchange's book had `hash` → { bids, asks, after } (after = the changes
  // since), or null if that hash isn't in the recent log.
  stateAt(hash) {
    if (!hash) return null;
    let i = this.log.length - 1;
    while (i >= 0 && this.log[i].hash !== hash) i--;
    if (i < 0) return this.hash === hash && !this.log.length ? { bids: new Map(this.bids), asks: new Map(this.asks), after: [] } : null;
    const bids = new Map(this.bids);
    const asks = new Map(this.asks);
    for (let j = this.log.length - 1; j > i; j--) {
      const ch = this.log[j].changes;
      for (let k = ch.length - 1; k >= 0; k--) {
        const [side, price, prevSize] = ch[k];
        const map = side === "bid" ? bids : asks;
        if (prevSize > 0) map.set(price, prevSize);
        else map.delete(price);
      }
    }
    return { bids, asks, after: this.log.slice(i + 1) };
  }

  bestBid() {
    let p = -Infinity;
    for (const k of this.bids.keys()) if (k > p) p = k;
    return p === -Infinity ? null : { price: p, size: this.bids.get(p) };
  }
  bestAsk() {
    let p = Infinity;
    for (const k of this.asks.keys()) if (k < p) p = k;
    return p === Infinity ? null : { price: p, size: this.asks.get(p) };
  }
  bbo() {
    const b = this.bestBid();
    const a = this.bestAsk();
    return { bid: b?.price ?? null, bidSize: b?.size ?? null, ask: a?.price ?? null, askSize: a?.size ?? null };
  }
}

// Top of book from a REST /book response (or a WS book message): best bid and ask with sizes.
export function topOfBook(b) {
  let bid = null;
  let ask = null;
  for (const l of b?.bids || []) {
    const p = num(l.price);
    if (num(l.size) > 0 && (!bid || p > bid.price)) bid = { price: p, size: num(l.size) };
  }
  for (const l of b?.asks || []) {
    const p = num(l.price);
    if (num(l.size) > 0 && (!ask || p < ask.price)) ask = { price: p, size: num(l.size) };
  }
  return { bid: bid?.price ?? null, bidSize: bid?.size ?? null, ask: ask?.price ?? null, askSize: ask?.size ?? null };
}

export const sameTop = (a, b) =>
  a.bid === b.bid && a.ask === b.ask && a.bidSize === b.bidSize && a.askSize === b.askSize;

export async function fetchBook(assetId, { timeout = 5000 } = {}) {
  const r = await fetch(`${CLOB}/book?token_id=${assetId}`, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`clob /book answered ${r.status}`);
  return r.json();
}

// Recent latency samples (recvTs − exchange timestamp), for p50/p95.
class Reservoir {
  constructor(n = 4000) {
    this.a = new Float64Array(n);
    this.n = 0;
    this.i = 0;
  }
  add(v) {
    this.a[this.i] = v;
    this.i = (this.i + 1) % this.a.length;
    if (this.n < this.a.length) this.n++;
  }
  pct(q) {
    if (!this.n) return null;
    const s = Array.from(this.a.subarray(0, this.n)).sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }
}

export class ClobFeed extends EventEmitter {
  // shadow: a resync connection. It keeps no books; each snapshot is handed out as a "shadow" event.
  constructor({ id = 0, url = WS_URL, WebSocketImpl = globalThis.WebSocket, now = Date.now, random = Math.random, shadow = false } = {}) {
    super();
    this.id = id;
    this.url = url;
    this.WS = WebSocketImpl;
    this.now = now;
    this.random = random;
    this.shadow = shadow;
    this.books = new Map();
    this.ws = null;
    this.state = "idle"; // idle | connecting | open | closed
    this.initialSent = false;
    this.attempt = 0;
    this.reconnects = 0;
    this.msgCount = 0;
    this.openedAt = 0;
    this.lastPong = 0;
    this.lastMsgAt = 0;
    this.latency = new Reservoir();
    this.subscribeSentAt = new Map(); // assetId → when its (re)subscribe went out
    this.snapshotDelays = new Reservoir(500);
    this.timers = [];
    this.reconnectTimer = null;
    this.closed = false;
  }

  get healthy() {
    return this.state === "open" && this.now() - this.lastPong <= PONG_TIMEOUT_MS;
  }

  tokens() {
    return [...this.books.keys()];
  }

  subscribe(ids) {
    const added = ids.filter((id) => !this.books.has(id));
    if (!added.length) return;
    for (const id of added) {
      this.books.set(id, new OrderBook(id));
      if (!this.shadow) this.emit("stale", { assetId: id, reason: "subscribing" });
    }
    if (this.state === "idle" || this.state === "closed") return this.connect();
    if (this.state === "open") this.sendSubscribe(added);
  }

  unsubscribe(ids) {
    const gone = ids.filter((id) => this.books.has(id));
    if (!gone.length) return;
    for (const id of gone) {
      this.books.delete(id);
      this.subscribeSentAt.delete(id);
    }
    if (this.state === "open" && this.initialSent) this.send({ assets_ids: gone, operation: "unsubscribe" });
  }

  // Drop a token's book and ask for a fresh snapshot (stale until it arrives).
  resubscribe(id, reason = "resync") {
    const b = this.books.get(id);
    if (!b) return;
    this.unsnap(b);
    this.emit("stale", { assetId: id, reason });
    if (this.state !== "open") return;
    this.send({ assets_ids: [id], operation: "unsubscribe" });
    this.sendSubscribe([id]);
  }

  unsnap(b) {
    b.hasSnapshot = false;
    b.log = [];
  }

  sendSubscribe(ids) {
    const t = this.now();
    for (const id of ids) this.subscribeSentAt.set(id, t);
    if (!this.initialSent) {
      this.initialSent = true;
      this.send({ assets_ids: ids, type: "market", custom_feature_enabled: true });
    } else this.send({ assets_ids: ids, operation: "subscribe" });
  }

  send(obj) {
    try {
      this.ws?.send(typeof obj === "string" ? obj : JSON.stringify(obj));
    } catch {
      /* the close handler reconnects */
    }
  }

  connect() {
    if (this.closed || !this.WS) return;
    clearTimeout(this.reconnectTimer);
    this.state = "connecting";
    this.initialSent = false;
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch {
      return this.scheduleReconnect("connect failed");
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.state = "open";
      this.openedAt = this.lastPong = this.now();
      if (this.attempt > 0) this.emit("reconnected", { conn: this.id, attempt: this.attempt });
      const ids = this.tokens();
      if (ids.length) this.sendSubscribe(ids);
      this.startTimers();
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.onMessage(typeof e.data === "string" ? e.data : String(e.data));
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws === ws) this.scheduleReconnect("closed");
    };
  }

  startTimers() {
    this.stopTimers();
    this.timers.push(setInterval(() => this.send("PING"), PING_MS));
    this.timers.push(setInterval(() => this.checkHealth(), 5_000));
    for (const t of this.timers) t.unref?.();
  }

  stopTimers() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // PONG timeout → reconnect; a long-healthy connection resets the backoff. Silence alone is fine.
  checkHealth() {
    const t = this.now();
    if (this.state !== "open") return;
    if (t - this.lastPong > PONG_TIMEOUT_MS) return this.scheduleReconnect("no PONG");
    if (this.attempt && t - this.openedAt > HEALTHY_RESET_MS) this.attempt = 0;
  }

  scheduleReconnect(reason) {
    if (this.closed) return;
    const ws = this.ws;
    this.ws = null;
    this.stopTimers();
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
    const wasOpen = this.state === "open";
    this.state = "closed";
    for (const b of this.books.values()) {
      this.unsnap(b);
      if (!this.shadow) this.emit("stale", { assetId: b.assetId, reason: `connection ${reason}` });
    }
    if (wasOpen || this.attempt === 0) this.reconnects++;
    const base = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** this.attempt);
    const delay = base + base * 0.3 * this.random();
    this.attempt++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  close() {
    this.closed = true;
    this.stopTimers();
    clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    this.state = "closed";
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
  }

  onMessage(text) {
    const recvTs = this.now();
    this.msgCount++;
    this.lastMsgAt = recvTs;
    if (text === "PONG") {
      this.lastPong = recvTs;
      return;
    }
    this.emit("raw", text, recvTs, this.id);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) this.onEvent(m, recvTs);
  }

  onEvent(m, recvTs) {
    const ts = num(m.timestamp);
    if (this.shadow) {
      if (m.event_type === "book" && this.books.has(m.asset_id)) this.emit("shadow", m, recvTs);
      return;
    }
    if (ts > 0) this.latency.add(recvTs - ts);
    switch (m.event_type) {
      case "book":
        return this.onBook(m, ts, recvTs);
      case "price_change":
        return this.onPriceChange(m, ts, recvTs);
      case "last_trade_price": {
        const b = this.books.get(m.asset_id);
        if (!b) return;
        b.lastMsgAt = recvTs;
        return this.emit("trade", {
          assetId: m.asset_id,
          market: m.market,
          price: num(m.price),
          size: num(m.size),
          side: m.side,
          ts,
          recvTs,
          txHash: m.transaction_hash,
        });
      }
      case "tick_size_change": {
        const b = this.books.get(m.asset_id);
        if (!b) return;
        const oldTick = b.tickSize ?? num(m.old_tick_size);
        b.tickSize = num(m.new_tick_size);
        b.lastMsgAt = recvTs;
        return this.emit("tick", { assetId: m.asset_id, oldTick, newTick: b.tickSize, ts });
      }
      default:
        // best_bid_ask and anything new: the book is kept from book + price_change only.
        if (m.asset_id && this.books.has(m.asset_id)) this.books.get(m.asset_id).lastMsgAt = recvTs;
    }
  }

  // Replace a book with `next` maps, one level event per difference.
  replaceBook(b, next, ts, recvTs, source) {
    const changes = [];
    for (const [side, key] of [["bid", "bids"], ["ask", "asks"]]) {
      const prev = b[key];
      for (const [price, newSize] of next[key]) {
        const prevSize = prev.get(price) || 0;
        if (prevSize !== newSize) changes.push([side, price, prevSize, newSize]);
      }
      for (const [price, prevSize] of prev) if (!next[key].has(price)) changes.push([side, price, prevSize, 0]);
      b[key] = next[key];
    }
    for (const [side, price, prevSize, newSize] of changes)
      this.emit("level", { assetId: b.assetId, side, price, newSize, prevSize, ts, recvTs, source });
    return changes;
  }

  // A full snapshot on the main connection: diff it against the local book so every change is a level event.
  onBook(m, ts, recvTs) {
    const b = this.books.get(m.asset_id);
    if (!b) return;
    const source = b.hasSnapshot ? "snapshot" : "resync";
    const sent = this.subscribeSentAt.get(m.asset_id);
    if (!b.hasSnapshot && sent) {
      this.snapshotDelays.add(recvTs - sent);
      this.subscribeSentAt.delete(m.asset_id);
    }
    const changes = this.replaceBook(b, bookMaps(m), ts, recvTs, source);
    b.market = m.market || b.market;
    b.hash = m.hash || null;
    if (m.tick_size) b.tickSize = num(m.tick_size);
    b.lastUpdateTs = ts;
    b.lastMsgAt = recvTs;
    if (b.hasSnapshot) b.record(b.hash, ts, recvTs, changes);
    else {
      b.log = [];
      b.record(b.hash, ts, recvTs, []);
      b.hasSnapshot = true;
      b.freshAt = recvTs;
      this.emit("fresh", { assetId: b.assetId });
    }
  }

  onPriceChange(m, msgTs, recvTs) {
    const ts = msgTs;
    for (const pc of m.price_changes || []) {
      const b = this.books.get(pc.asset_id);
      if (!b) continue;
      b.lastMsgAt = recvTs;
      if (!b.hasSnapshot) continue; // the snapshot that's on its way replaces everything
      const changes = [];
      const side = pc.side === "BUY" ? "bid" : "ask";
      const map = side === "bid" ? b.bids : b.asks;
      const price = num(pc.price);
      const newSize = Math.max(0, num(pc.size) || 0);
      const prevSize = map.get(price) || 0;
      if (newSize > 0) map.set(price, newSize);
      else map.delete(price);
      if (newSize !== prevSize) {
        changes.push([side, price, prevSize, newSize]);
        this.emit("level", { assetId: b.assetId, side, price, newSize, prevSize, ts, recvTs, source: "price_change" });
      }
      // A multi-level sweep can show up only in the next snapshot: anything better than the
      // exchange's own best bid/ask is already gone.
      const bb = num(pc.best_bid);
      const ba = num(pc.best_ask);
      if (bb > 0)
        for (const [p, s] of b.bids)
          if (p > bb) {
            b.bids.delete(p);
            changes.push(["bid", p, s, 0]);
            this.emit("level", { assetId: b.assetId, side: "bid", price: p, newSize: 0, prevSize: s, ts, recvTs, source: "bbo_heal" });
          }
      if (ba > 0)
        for (const [p, s] of b.asks)
          if (p < ba) {
            b.asks.delete(p);
            changes.push(["ask", p, s, 0]);
            this.emit("level", { assetId: b.assetId, side: "ask", price: p, newSize: 0, prevSize: s, ts, recvTs, source: "bbo_heal" });
          }
      if (pc.hash) b.hash = pc.hash;
      b.lastUpdateTs = ts;
      b.record(pc.hash || null, ts, recvTs, changes);
    }
  }
}

const FORWARD = ["level", "trade", "tick", "stale", "fresh", "reconnected"];

// Several connections behind one event stream. Tokens added together (a market's two sides) share a connection.
// One more connection, the shadow, re-checks every book: round-robin, each token is subscribed there, its
// snapshot is lined up with our book by hash, and the token is unsubscribed again. The main connections are
// never interrupted, so no trade or level change is missed while a book is checked.
export class FeedPool extends EventEmitter {
  constructor({ size = 8, rawLog = null, shadowMs = SHADOW_MS, priorityMs = SHADOW_PRIORITY_MS, restSampleMs = REST_SAMPLE_MS, restBook = fetchBook, ...feedOpts } = {}) {
    super();
    this.setMaxListeners(50);
    this.feeds = Array.from({ length: Math.max(1, size) }, (_, id) => {
      const f = new ClobFeed({ id, ...feedOpts });
      for (const ev of FORWARD) f.on(ev, (e) => this.emit(ev, e));
      if (rawLog) f.on("raw", (text, recvTs, conn) => rawLog.write(recvTs, conn, text));
      return f;
    });
    this.where = new Map(); // assetId → feed
    this.now = feedOpts.now || Date.now;
    this.random = feedOpts.random || Math.random;
    this.rate = { at: this.now(), counts: this.feeds.map(() => 0), perSec: this.feeds.map(() => 0) };
    this.timers = [setInterval(() => this.sampleRates(), 5_000)];

    this.shadowMs = shadowMs;
    this.priorityMs = priorityMs;
    this.priority = new Set();
    this.checks = new Map(); // assetId → { nextAt, lastOkAt, sentAt }
    this.drift = { checks: 0, ok: 0, driftDetected: 0, hashLate: 0, hashMissing: 0, timeouts: 0, ages: [], recent: [], tokenMs: 0 };
    this.shadow = shadowMs > 0 ? new ClobFeed({ id: "shadow", ...feedOpts, shadow: true }) : null;
    if (this.shadow) {
      this.shadow.on("shadow", (m, recvTs) => this.onShadow(m, recvTs));
      // shadow snapshots go to the raw log too (conn "shadow"), so a replay sees the same corrections
      if (rawLog) this.shadow.on("raw", (text, recvTs) => text.includes('"book"') && rawLog.write(recvTs, "shadow", text));
      this.lastShadowTick = this.now();
      this.timers.push(setInterval(() => this.shadowTick(), 500));
    }

    this.restBook = restBook;
    this.rest = { checks: 0, match: 0, hashFound: 0, errors: 0, mismatches: [] };
    this.restCursor = 0;
    if (restSampleMs > 0) this.timers.push(setInterval(() => this.restSample(), restSampleMs));
    for (const t of this.timers) t.unref?.();
  }

  add(ids) {
    ids = ids.filter((id) => !this.where.has(id));
    if (!ids.length) return;
    const feed = this.feeds.reduce((a, f) => (f.books.size < a.books.size ? f : a));
    const t = this.now();
    for (const id of ids) {
      this.where.set(id, feed);
      // first check spread over one interval, so checks don't bunch up
      this.checks.set(id, { nextAt: t + 5_000 + this.random() * this.shadowMs, lastOkAt: 0, sentAt: 0 });
    }
    feed.subscribe(ids);
  }

  remove(ids) {
    const byFeed = new Map();
    for (const id of ids) {
      const f = this.where.get(id);
      if (!f) continue;
      this.where.delete(id);
      this.checks.delete(id);
      this.priority.delete(id);
      this.shadow?.unsubscribe([id]);
      byFeed.set(f, [...(byFeed.get(f) || []), id]);
    }
    for (const [f, list] of byFeed) f.unsubscribe(list);
  }

  // Tokens we have orders on are re-checked every 15 s instead of every 50 s.
  setPriority(ids, on = true) {
    for (const id of ids) {
      if (!this.where.has(id)) continue;
      if (on) {
        this.priority.add(id);
        const c = this.checks.get(id);
        if (c) c.nextAt = Math.min(c.nextAt, this.now() + this.priorityMs);
      } else this.priority.delete(id);
    }
  }

  book(id) {
    return this.where.get(id)?.books.get(id) || null;
  }

  isStale(id) {
    const f = this.where.get(id);
    const b = f?.books.get(id);
    return !b || !b.hasSnapshot || !f.healthy;
  }

  shadowTick() {
    const t = this.now();
    let live = 0;
    for (const id of this.where.keys()) if (!this.isStale(id)) live++;
    this.drift.tokenMs += live * (t - this.lastShadowTick);
    this.lastShadowTick = t;
    let inflight = 0;
    for (const [id, c] of this.checks) {
      if (!c.sentAt) continue;
      if (t - c.sentAt > SHADOW_TIMEOUT_MS) {
        this.shadow.unsubscribe([id]);
        c.sentAt = 0;
        c.nextAt = t + 5_000;
        this.drift.timeouts++;
      } else inflight++;
    }
    if (inflight >= SHADOW_INFLIGHT) return;
    const due = [...this.checks].filter(([id, c]) => !c.sentAt && c.nextAt <= t && !this.isStale(id)).sort((a, b) => a[1].nextAt - b[1].nextAt);
    for (const [id, c] of due.slice(0, SHADOW_INFLIGHT - inflight)) {
      c.sentAt = t;
      this.shadow.subscribe([id]);
    }
  }

  onShadow(m, recvTs) {
    const id = m.asset_id;
    const c = this.checks.get(id);
    this.shadow.unsubscribe([id]);
    if (!c?.sentAt) return;
    c.sentAt = 0;
    c.nextAt = recvTs + (this.priority.has(id) ? this.priorityMs : this.shadowMs);
    this.reconcile(id, m, recvTs, 0);
  }

  // Line the snapshot up with our book by hash. Same content → fine. Different → our book drifted: rebuild it
  // as the snapshot plus every change we've had since, and emit the differences as level events (source resync).
  reconcile(id, m, recvTs, tries) {
    const feed = this.where.get(id);
    const b = feed?.books.get(id);
    const c = this.checks.get(id);
    if (!b?.hasSnapshot || !c) return;
    const snap = bookMaps(m);
    const at = b.stateAt(m.hash);
    if (!at && tries < 3) {
      // the main connection hasn't seen that state yet
      const t = setTimeout(() => this.reconcile(id, m, recvTs, tries + 1), 500);
      t.unref?.();
      return;
    }
    this.drift.checks++;
    let after;
    if (at) {
      if (tries) this.drift.hashLate++;
      if (sameMaps(at.bids, snap.bids) && sameMaps(at.asks, snap.asks)) {
        this.drift.ok++;
        c.lastOkAt = this.now();
        return;
      }
      after = at.after;
    } else {
      // the hash never showed up on the main connection: replay by exchange time instead
      this.drift.hashMissing++;
      const sts = num(m.timestamp);
      after = b.log.filter((e) => e.ts > sts);
    }
    const fixed = { bids: new Map(snap.bids), asks: new Map(snap.asks) };
    for (const e of after)
      for (const [side, price, , newSize] of e.changes) {
        const map = side === "bid" ? fixed.bids : fixed.asks;
        if (newSize > 0) map.set(price, newSize);
        else map.delete(price);
      }
    if (sameMaps(fixed.bids, b.bids) && sameMaps(fixed.asks, b.asks)) {
      this.drift.ok++;
      c.lastOkAt = this.now();
      return;
    }
    const t = this.now();
    const ageMs = t - (c.lastOkAt || b.freshAt || t);
    const before = b.bbo();
    const changes = feed.replaceBook(b, fixed, num(m.timestamp), t, "resync");
    b.log = []; // the old history led to the wrong book; start over from the corrected one
    b.record(b.hash, num(m.timestamp), t, []);
    c.lastOkAt = t;
    this.drift.driftDetected++;
    this.drift.ages.push(ageMs);
    if (this.drift.ages.length > 1000) this.drift.ages.shift();
    this.drift.recent.push({ at: new Date(t).toISOString(), assetId: id, ageMs, levels: changes.length, before, after: b.bbo(), byHash: !!at });
    if (this.drift.recent.length > 20) this.drift.recent.shift();
    this.emit("drift", { assetId: id, ageMs, changes });
  }

  // Metric only: every few minutes one token's REST /book, lined up by hash, top of book compared.
  async restSample(id) {
    if (!id) {
      const ids = [...this.where.keys()].filter((x) => !this.isStale(x));
      if (!ids.length) return;
      id = ids[this.restCursor++ % ids.length];
    }
    let r;
    try {
      r = await this.restBook(id);
    } catch {
      this.rest.errors++;
      return;
    }
    const b = this.book(id);
    if (!b?.hasSnapshot) return;
    let at = b.stateAt(r.hash);
    for (let i = 0; i < 3 && !at; i++) {
      await new Promise((res) => setTimeout(res, 500));
      at = b.stateAt(r.hash);
    }
    this.rest.checks++;
    if (at) this.rest.hashFound++;
    const ours = at ? topOfMaps(at) : b.bbo();
    const theirs = topOfBook(r);
    const same = sameTop(ours, theirs);
    if (same) this.rest.match++;
    else if (this.rest.mismatches.length < 20) this.rest.mismatches.push({ assetId: id, byHash: !!at, ours, rest: theirs });
    return same;
  }

  sampleRates() {
    const t = this.now();
    const dt = Math.max(1, t - this.rate.at) / 1000;
    this.feeds.forEach((f, i) => {
      this.rate.perSec[i] = (f.msgCount - this.rate.counts[i]) / dt;
      this.rate.counts[i] = f.msgCount;
    });
    this.rate.at = t;
  }

  driftHealth() {
    const d = this.drift;
    const tokenHours = d.tokenMs / 3600e3;
    const ages = d.ages;
    return {
      intervalSec: this.shadowMs / 1000,
      priorityIntervalSec: this.priorityMs / 1000,
      shadowConnection: this.shadow ? { state: this.shadow.state, healthy: this.shadow.healthy, reconnects: this.shadow.reconnects } : null,
      checks: d.checks,
      ok: d.ok,
      driftDetected: d.driftDetected,
      tokenHours: +tokenHours.toFixed(2),
      driftPerTokenHour: tokenHours > 0 ? +(d.driftDetected / tokenHours).toFixed(3) : null,
      avgDriftAgeSec: ages.length ? +(ages.reduce((a, x) => a + x, 0) / ages.length / 1000).toFixed(1) : null,
      maxDriftAgeSec: ages.length ? +(Math.max(...ages) / 1000).toFixed(1) : null,
      hashLate: d.hashLate,
      hashMissing: d.hashMissing,
      timeouts: d.timeouts,
      recent: d.recent.slice(-5),
    };
  }

  health() {
    const lat = new Reservoir(this.feeds.length * 4000);
    for (const f of this.feeds) for (let i = 0; i < f.latency.n; i++) lat.add(f.latency.a[i]);
    const stale = [...this.where.keys()].filter((id) => this.isStale(id));
    const connections = this.feeds.map((f, i) => ({
      id: f.id,
      state: f.state,
      healthy: f.healthy,
      tokens: f.books.size,
      msgPerSec: Math.round(this.rate.perSec[i]),
      reconnects: f.reconnects,
      lastMsgAgoMs: f.lastMsgAt ? this.now() - f.lastMsgAt : null,
    }));
    return {
      connections,
      tokens: this.where.size,
      msgPerSec: Math.round(this.rate.perSec.reduce((a, b) => a + b, 0)),
      staleTokens: stale,
      reconnects: this.feeds.reduce((a, f) => a + f.reconnects, 0),
      latencyMs: { p50: lat.pct(0.5), p95: lat.pct(0.95) },
      drift: this.driftHealth(),
      restSample: {
        checks: this.rest.checks,
        match: this.rest.match,
        matchPct: this.rest.checks ? +((100 * this.rest.match) / this.rest.checks).toFixed(2) : null,
        hashFound: this.rest.hashFound,
        errors: this.rest.errors,
        mismatches: this.rest.mismatches.slice(-5),
      },
    };
  }

  close() {
    for (const t of this.timers) clearInterval(t);
    for (const f of this.feeds) f.close();
    this.shadow?.close();
  }
}

const hourKey = (ts) => new Date(ts).toISOString().slice(0, 13).replace("T", "-");

// Every frame, one JSON line each: {"r":recvTs,"c":conn,"m":<frame>}. Each flush appends one complete
// gzip member, so a file is readable (zcat, gunzipSync) even if the process dies mid-hour.
export class RawLog {
  constructor({ dir, maxBytes = 2 * 1024 ** 3, flushMs = 5_000 } = {}) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    this.lines = [];
    this.hour = null;
    this.chain = Promise.resolve();
    this.bytesWritten = 0;
    this.framesWritten = 0;
    this.lastLimitCheck = 0;
    this.timer = setInterval(() => this.flush(), flushMs);
    this.timer.unref?.();
  }

  write(recvTs, conn, text) {
    const h = hourKey(recvTs);
    if (this.hour && h !== this.hour) this.flush();
    this.hour = h;
    const frame = text.replace(/[\r\n]+/g, "");
    const body = frame[0] === "{" || frame[0] === "[" ? frame : JSON.stringify(frame);
    this.lines.push(`{"r":${recvTs},"c":${JSON.stringify(conn)},"m":${body}}\n`);
  }

  take() {
    if (!this.lines.length) return null;
    const out = { file: path.join(this.dir, `${this.hour}.jsonl.gz`), text: this.lines.join(""), n: this.lines.length };
    this.lines = [];
    return out;
  }

  flush() {
    const job = this.take();
    if (!job) return this.chain;
    this.chain = this.chain.then(
      () =>
        new Promise((resolve) => {
          zlib.gzip(job.text, (err, buf) => {
            if (err) return resolve();
            fs.promises
              .mkdir(this.dir, { recursive: true })
              .then(() => fs.promises.appendFile(job.file, buf))
              .then(() => {
                this.bytesWritten += buf.length;
                this.framesWritten += job.n;
                this.enforceLimit();
              })
              .catch(() => {})
              .finally(resolve);
          });
        }),
    );
    return this.chain;
  }

  // At exit: whatever is buffered, written synchronously.
  flushSync() {
    const job = this.take();
    if (!job) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const buf = zlib.gzipSync(job.text);
      fs.appendFileSync(job.file, buf);
      this.bytesWritten += buf.length;
      this.framesWritten += job.n;
    } catch {
      /* nothing more to do at exit */
    }
  }

  // Rolling limit: delete the oldest hour files until the folder fits (never the current hour).
  enforceLimit(force = false) {
    const t = Date.now();
    if (!force && t - this.lastLimitCheck < 60_000) return;
    this.lastLimitCheck = t;
    let files;
    try {
      files = fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith(".jsonl.gz"))
        .sort()
        .map((f) => ({ f, size: fs.statSync(path.join(this.dir, f)).size }));
    } catch {
      return;
    }
    let total = files.reduce((a, x) => a + x.size, 0);
    const current = this.hour && `${this.hour}.jsonl.gz`;
    for (const x of files) {
      if (total <= this.maxBytes) break;
      if (x.f === current) continue;
      try {
        fs.unlinkSync(path.join(this.dir, x.f));
        total -= x.size;
      } catch {
        /* in use; try next time */
      }
    }
  }

  stats() {
    let folderBytes = 0;
    try {
      for (const f of fs.readdirSync(this.dir)) if (f.endsWith(".jsonl.gz")) folderBytes += fs.statSync(path.join(this.dir, f)).size;
    } catch {
      /* no folder yet */
    }
    return { dir: this.dir, maxBytes: this.maxBytes, folderBytes, bytesWritten: this.bytesWritten, framesWritten: this.framesWritten, buffered: this.lines.length };
  }

  close() {
    clearInterval(this.timer);
    this.flushSync();
  }
}
