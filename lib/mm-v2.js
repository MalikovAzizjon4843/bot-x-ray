// Market-Maker v2: paper trading on Polymarket's crypto Up/Down markets, from the live feed (lib/mm-feed.js).
// No real order, no key, no account. Fills come from lib/fill-model.js (queue position, unified YES/NO trade
// stream, effective side); the engine never re-derives them.
//
// Strategy A (buy both, merge): edge = 1 − askUp − askDown − fee(up) − fee(down). Above minEdgeA, buy both as a
//   taker. Takers are held 250 ms (itode), so the price is whatever the book offers 250 ms later.
// Strategy B (split, sell both): split $1 into one Up + one Down share, rest a post-only SELL on each side at
//   one tick inside the best ask, when the two prices add up to pairSumMin…pairSumMax. Both fill → the pair
//   sold for more than $1. One fills → the other leg is exited (exitMode) on a stop or after legTtl. Neither
//   fills within quoteTtl → merge back (no cost) and leave that market alone for mergeCooldownMin.
// Stop-loss: the unfilled leg's best bid has fallen ≥ stopMoveCents since the first fill, and that fill is at
//   least minHoldMs old. (v1 compared our ask with the bid, which fires at once whenever the spread is wide.)
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { FillModel, takerFee, roundToTick, sweep, MarkoutTracker, midOf, CROSS_MODES } from "./fill-model.js";

export const DEFAULT_CONFIG = Object.freeze({
  startBalance: 50,
  orderUsd: 10,
  maxOpen: 3,
  minSpreadCents: 2,
  latencyMs: 400,
  cancelMode: "pessimistic",
  crossFill: "all", // all | through_only | off
  exitMode: "taker_scratch", // taker_scratch | passive_exit | hold_to_resolution
  // A is off: books are mirrored, so ask Up + ask Down = 1 + spread ≥ 1 and the edge can't exist.
  // Its opportunities are still counted.
  strategies: { A: false, B: true },
  minEdgeA: 0.003,
  pairSumMin: 1.02,
  pairSumMax: 1.065,
  quoteTtlSec: 180, // no fill by then → clean merge
  legTtlSec: 180, // one leg filled, the other not by then → exit
  exitTtlSec: 60, // passive_exit: re-peg this long, then scratch
  stopMoveCents: 3,
  minHoldMs: 5000,
  mergeCooldownMin: 15,
  takerDelayMs: 250,
  minTimeLeftSec: 240, // don't open a cycle in a market ending sooner
  repegMinMs: 2000,
  rebateMode: "off", // off | estimate (a column only, never added to equity)
});

const EXIT_MODES = ["taker_scratch", "passive_exit", "hold_to_resolution"];
const EPS = 1e-9;
const r2 = (x) => Math.round(x * 100) / 100;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const feeOn = (levels, fd) => levels.reduce((a, [p, q]) => a + takerFee(q, p, fd), 0);

export function validateConfig(c) {
  if (c.crossFill === true) c.crossFill = "all";
  if (c.crossFill === false) c.crossFill = "off";
  if (!CROSS_MODES.includes(c.crossFill)) throw new Error(`crossFill must be one of ${CROSS_MODES.join(", ")}`);
  if (!EXIT_MODES.includes(c.exitMode)) throw new Error(`exitMode must be one of ${EXIT_MODES.join(", ")}`);
  if (!["pessimistic", "proportional"].includes(c.cancelMode)) throw new Error("cancelMode must be pessimistic or proportional");
  if (!["off", "estimate"].includes(c.rebateMode)) throw new Error("rebateMode must be off or estimate");
  if (!(c.orderUsd >= 5) || !(c.startBalance > 0) || !(c.maxOpen >= 1)) throw new Error("orderUsd ≥ 5, startBalance > 0, maxOpen ≥ 1");
  if (!(c.pairSumMin > 1 && c.pairSumMax > c.pairSumMin)) throw new Error("1 < pairSumMin < pairSumMax");
  return c;
}

export class MarketMakerV2 extends EventEmitter {
  // pool: FeedPool-like (on level/trade, book, isStale, setPriority); markets: () → rotator markets
  // timers: false → the caller drives tick() (tests)
  constructor({ pool, markets, dataDir, now = Date.now, log = () => {}, resolve = async () => null, autosave = true, timers = true } = {}) {
    super();
    Object.assign(this, { pool, marketsOf: markets, dataDir, now, log, resolve, useTimers: timers });
    this.stateFile = path.join(dataDir, "mm-paper-v2.json");
    this.cyclesFile = path.join(dataDir, "mm-cycles-v2.jsonl");
    this.load();
    this.fm = null;
    this.timers = [];
    this.running = false;
    this.autosave = autosave;
    this.pendingTakers = []; // { at, fn }
    this.closing = []; // closed cycles waiting for their 30 s markouts
    this.markouts = new MarkoutTracker();
    this.lastEval = new Map(); // slug → ms
    this.aActive = new Set(); // markets currently showing an A edge (counts each opportunity once)
    this.onLevel = (e) => this.fm?.onLevel(e);
    this.onTrade = (t) => this.fm?.onTrade(t);
  }

  // ── state ──
  load() {
    let s = null;
    try {
      s = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    } catch {
      /* first run */
    }
    const config = validateConfig({ ...DEFAULT_CONFIG, ...(s?.config || {}), strategies: { ...DEFAULT_CONFIG.strategies, ...(s?.config?.strategies || {}) } });
    this.s = {
      version: 2,
      config,
      running: !!s?.running,
      startedAt: s?.startedAt || null,
      cash: s?.cash ?? config.startBalance,
      cooldowns: s?.cooldowns || {}, // slug → until (ms)
      counters: { aOpportunities: 0, aExecuted: 0, bOpened: 0, cleanMerges: 0, rejected: 0, skippedNoFd: 0, ...(s?.counters || {}) },
      equity: s?.equity || [], // [{ t, v }] after each closed cycle
      totals: s?.totals || { cycles: 0, netPnl: 0, takerFees: 0 },
      open: s?.open || [],
      // leftover shares waiting for the market's result, and the cycles they belong to
      resolving: (s?.resolving || []).map((r) => ({ ...r, busy: false })),
      waitingCycles: s?.waitingCycles || [],
    };
    this.cycles = new Map();
    this.waiting = new Map(this.s.waitingCycles.map((c) => [c.id, c]));
    this.dirty = false;
  }

  save() {
    const open = [...this.cycles.values()].map((c) => this.serialize(c));
    const waitingCycles = [...this.waiting.values()].map((c) => this.serialize(c));
    const resolving = this.s.resolving.map(({ busy, ...r }) => r);
    const out = { ...this.s, open, waitingCycles, resolving, savedAt: new Date(this.now()).toISOString() };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.stateFile + ".tmp", JSON.stringify(out, null, 1));
    fs.renameSync(this.stateFile + ".tmp", this.stateFile);
    this.dirty = false;
  }

  serialize(c) {
    const { legOrders, ...rest } = c;
    return rest;
  }

  get config() {
    return this.s.config;
  }

  setConfig(patch) {
    if (this.running) throw Object.assign(new Error("Stop the engine before changing its config"), { status: 409 });
    const next = validateConfig({ ...this.s.config, ...patch, strategies: { ...this.s.config.strategies, ...(patch.strategies || {}) } });
    this.s.config = next;
    this.save();
    return next;
  }

  reset() {
    if (this.running) throw Object.assign(new Error("Stop the engine before a reset"), { status: 409 });
    const config = this.s.config;
    try {
      fs.renameSync(this.cyclesFile, this.cyclesFile.replace(/\.jsonl$/, `.${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}.jsonl`));
    } catch {
      /* no cycles yet */
    }
    this.s = { version: 2, config, running: false, startedAt: null, cash: config.startBalance, cooldowns: {}, counters: { aOpportunities: 0, aExecuted: 0, bOpened: 0, cleanMerges: 0, rejected: 0, skippedNoFd: 0 }, equity: [], totals: { cycles: 0, netPnl: 0, takerFees: 0 }, open: [], resolving: [], waitingCycles: [] };
    this.cycles.clear();
    this.waiting.clear();
    this.closing = [];
    this.save();
    return this.status();
  }

  // ── run ──
  start() {
    if (this.running) return this.status();
    const c = this.config;
    this.fm = new FillModel({ book: (id) => this.pool.book(id), complementOf: (id) => this.complement(id), latencyMs: c.latencyMs, cancelMode: c.cancelMode, crossFill: c.crossFill, now: this.now });
    this.fm.on("fill", (f) => this.onFill(f));
    this.fm.on("reject", (o) => this.onReject(o));
    this.pool.on("level", this.onLevel);
    this.pool.on("trade", this.onTrade);
    this.running = true;
    this.s.running = true;
    this.s.startedAt = new Date(this.now()).toISOString();
    // cycles left open by a previous run can't be followed any more: settle what can be, resolve the rest
    for (const c of this.s.open) this.abandon(c, "restart");
    this.s.open = [];
    if (this.useTimers) this.timers.push(setInterval(() => this.tick(), 250));
    if (this.useTimers && this.autosave) this.timers.push(setInterval(() => this.dirty && this.save(), 5_000));
    for (const t of this.timers) t.unref?.();
    this.save();
    this.log("mm-v2: started");
    return this.status();
  }

  stop() {
    if (!this.running) return this.status();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.pool.off("level", this.onLevel);
    this.pool.off("trade", this.onTrade);
    this.running = false;
    this.s.running = false;
    // open cycles stay in the state file; the next start settles them
    this.flushClosing(true);
    this.save();
    this.log("mm-v2: stopped");
    return this.status();
  }

  // Server shutdown: like stop(), but the engine starts again with the server.
  suspend() {
    if (!this.running) return;
    this.stop();
    this.s.running = true;
    this.save();
  }

  complement(id) {
    for (const m of this.marketsOf()) {
      const [a, b] = m.tokens;
      if (a.assetId === id) return b.assetId;
      if (b.assetId === id) return a.assetId;
    }
    return null;
  }

  tick(at = this.now()) {
    if (!this.running) return;
    this.fm.tick(at);
    const due = this.pendingTakers.filter((x) => x.at <= at);
    this.pendingTakers = this.pendingTakers.filter((x) => x.at > at);
    for (const x of due) x.fn(at);
    for (const c of [...this.cycles.values()]) this.manage(c, at);
    this.scan(at);
    for (const f of this.markouts.tick(at, (id) => midOf(this.pool.book(id)))) this.onMarkout(f);
    this.flushClosing(false, at);
    this.resolveLeftovers(at);
  }

  // ── opening ──
  scan(at) {
    const c = this.config;
    const nowSec = at / 1000;
    for (const m of this.marketsOf()) {
      if (at - (this.lastEval.get(m.slug) || 0) < 1_000) continue;
      this.lastEval.set(m.slug, at);
      if (!(m.start <= nowSec && nowSec < m.end - c.minTimeLeftSec)) continue;
      const [up, down] = m.tokens;
      if (this.pool.isStale(up.assetId) || this.pool.isStale(down.assetId)) continue;
      if (!m.fd) {
        if (!m.noFdLogged) {
          m.noFdLogged = true;
          this.s.counters.skippedNoFd++;
          this.log(`mm-v2: ${m.slug} has no fee data, skipped`);
        }
        continue;
      }
      if (this.hasCycle(m.slug)) continue;
      if ((this.s.cooldowns[m.slug] || 0) > at) continue;
      const bu = this.pool.book(up.assetId);
      const bd = this.pool.book(down.assetId);
      this.tryA(m, bu, bd, at); // counts A opportunities; trades only when strategies.A is on
      if (c.strategies.B && !this.hasCycle(m.slug)) this.tryB(m, bu, bd, at);
    }
  }

  hasCycle(slug) {
    for (const x of this.cycles.values()) if (x.slug === slug) return true;
    for (const x of this.waiting.values()) if (x.slug === slug) return true;
    return false;
  }

  canOpen(usd) {
    return this.cycles.size < this.config.maxOpen && this.s.cash >= usd - EPS;
  }

  tryA(m, bu, bd, at) {
    const c = this.config;
    const au = bu.bestAsk();
    const ad = bd.bestAsk();
    if (!au || !ad) return this.aActive.delete(m.slug);
    const edge = 1 - au.price - ad.price - takerFee(1, au.price, m.fd) - takerFee(1, ad.price, m.fd);
    if (edge <= c.minEdgeA) return this.aActive.delete(m.slug);
    if (!this.aActive.has(m.slug)) {
      this.aActive.add(m.slug);
      this.s.counters.aOpportunities++;
      this.dirty = true;
    }
    if (!c.strategies.A) return;
    const shares = Math.floor(Math.min(au.size, ad.size, c.orderUsd / (au.price + ad.price)) * 100) / 100;
    if (shares < (m.minOrderSize || 5) || !this.canOpen(shares * (au.price + ad.price))) return;
    const cy = this.newCycle("A", m, at, { edgeAtSignal: r6(edge), shares });
    this.s.cash -= shares * (au.price + ad.price); // reserved; settled at execution
    cy.reserved = shares * (au.price + ad.price);
    // itode: takers wait 250 ms; the price is the book then
    this.pendingTakers.push({ at: at + c.takerDelayMs, fn: (t) => this.executeA(cy, m, t) });
  }

  executeA(cy, m, at) {
    const [up, down] = m.tokens;
    const su = sweep(this.pool.book(up.assetId).asks, cy.shares, "BUY");
    const sd = sweep(this.pool.book(down.assetId).asks, cy.shares, "BUY");
    const n = Math.min(su.filled, sd.filled);
    this.s.cash += cy.reserved;
    if (n < (m.minOrderSize || 5)) {
      cy.exit = { reason: "a_gone", qty: 0 };
      return this.close(cy, at);
    }
    const legU = sweep(this.pool.book(up.assetId).asks, n, "BUY");
    const legD = sweep(this.pool.book(down.assetId).asks, n, "BUY");
    const fee = feeOn(legU.levels, m.fd) + feeOn(legD.levels, m.fd);
    this.cash(-(legU.cost + legD.cost + fee), cy);
    this.cash(n, cy); // merged back to $1 a pair
    cy.takerFees += fee;
    cy.merged += n;
    cy.legs[0].fills.push({ qty: n, price: r6(legU.avgPrice), source: "taker", at });
    cy.legs[1].fills.push({ qty: n, price: r6(legD.avgPrice), source: "taker", at });
    cy.legs[0].filled = cy.legs[1].filled = n;
    this.s.counters.aExecuted++;
    this.close(cy, at);
  }

  tryB(m, bu, bd, at) {
    const c = this.config;
    if (!this.canOpen(c.orderUsd)) return;
    const tick = bu.tickSize || m.tickSize || 0.01;
    const [bbU, baU, bbD, baD] = [bu.bestBid(), bu.bestAsk(), bd.bestBid(), bd.bestAsk()];
    if (!bbU || !baU || !bbD || !baD) return;
    if (baU.price - bbU.price < c.minSpreadCents / 100 - EPS) return;
    const pu = this.quotePrice(baU.price, bbU.price, tick);
    const pd = this.quotePrice(baD.price, bbD.price, tick);
    const sum = r6(pu + pd);
    if (sum < c.pairSumMin - EPS || sum > c.pairSumMax + EPS) return;
    const shares = Math.floor(c.orderUsd);
    if (shares < (m.minOrderSize || 5)) return;
    const cy = this.newCycle("B", m, at, { shares, pairSumAtOpen: sum });
    this.cash(-shares, cy); // split: $1 → one Up + one Down
    this.s.counters.bOpened++;
    this.placeLeg(cy, 0, pu, at);
    this.placeLeg(cy, 1, pd, at);
    this.pool.setPriority?.([m.tokens[0].assetId, m.tokens[1].assetId], true);
  }

  // one tick inside the best ask, never at or through the bid (post-only)
  quotePrice(ask, bid, tick) {
    const inside = roundToTick(ask - tick, tick, "SELL");
    return inside > bid + EPS ? inside : roundToTick(ask, tick, "SELL");
  }

  newCycle(strategy, m, at, extra) {
    const c = this.config;
    const cy = {
      id: `${strategy}-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      strategy,
      slug: m.slug,
      coin: m.coin,
      minutes: m.minutes,
      marketEnd: m.end,
      openedAt: at,
      closedAt: null,
      config: { cancelMode: c.cancelMode, crossFill: c.crossFill, exitMode: c.exitMode, latencyMs: c.latencyMs },
      legs: m.tokens.map((t) => ({ outcome: t.outcome, assetId: t.assetId, orderId: null, price: null, quotes: 0, queueAheadAtPlace: null, filled: 0, fills: [], repegAt: 0 })),
      cashFlow: 0,
      takerFees: 0,
      merged: 0,
      firstFillAt: null,
      bidAtFirstFill: null, // the unfilled leg's best bid when the other leg first filled
      exit: null,
      exiting: false,
      ...extra,
    };
    this.cycles.set(cy.id, cy);
    this.dirty = true;
    return cy;
  }

  cash(delta, cy) {
    this.s.cash += delta;
    if (cy) cy.cashFlow += delta;
    this.dirty = true;
  }

  placeLeg(cy, i, price, at) {
    const leg = cy.legs[i];
    const left = r2(cy.shares - leg.filled);
    if (left <= EPS) return;
    const id = `${cy.id}:${i}:${leg.quotes}`;
    leg.quotes++;
    leg.orderId = id;
    leg.price = price;
    leg.repegAt = at;
    this.fm.place({ id, assetId: leg.assetId, side: "SELL", price, size: left, placedAt: at });
  }

  orderOf(orderId) {
    const [cid, i] = orderId.split(":");
    const cy = this.cycles.get(cid);
    return cy ? { cy, i: Number(i), leg: cy.legs[Number(i)] } : null;
  }

  onReject(o) {
    this.s.counters.rejected++;
    const x = this.orderOf(o.id);
    if (x && x.leg.orderId === o.id) x.leg.orderId = null; // manage() quotes again
  }

  onFill(f) {
    const x = this.orderOf(f.orderId);
    if (!x) return;
    const { cy, i, leg } = x;
    if (leg.queueAheadAtPlace == null) leg.queueAheadAtPlace = f.queueAheadAtPlace;
    leg.filled = r6(leg.filled + f.qty);
    const mkId = `${f.orderId}:${leg.fills.length}`;
    // diag is the fill model's object: tradeAfter is filled in up to 1 s later
    leg.fills.push({ qty: f.qty, price: f.price, source: f.source, at: f.at, queueAheadAtPlace: f.queueAheadAtPlace, timeToFillMs: f.timeToFillMs, sideOverridden: !!f.sideOverridden, exit: !!cy.exiting, mkId, diag: f.diag || null });
    this.cash(f.qty * f.price, cy);
    this.markouts.track({ id: mkId, cycleId: cy.id, assetId: leg.assetId, side: "SELL", price: f.price, qty: f.qty, at: f.at });
    if (cy.firstFillAt == null && !cy.exiting) {
      cy.firstFillAt = f.at;
      const other = this.pool.book(cy.legs[1 - i].assetId);
      cy.bidAtFirstFill = other?.bestBid()?.price ?? null;
    }
    this.emit("fill", { cycleId: cy.id, ...f });
  }

  // ── managing an open cycle ──
  manage(cy, at) {
    if (cy.strategy !== "B" || cy.closedAt) return;
    const c = this.config;
    const [a, b] = cy.legs;
    const leftA = r6(cy.shares - a.filled);
    const leftB = r6(cy.shares - b.filled);
    if (leftA <= EPS && leftB <= EPS) return this.finish(cy, at, "both_filled");
    if (cy.exiting) {
      // a passive exit still resting when the market ends: hold the rest to the result
      if (at / 1000 >= cy.marketEnd && cy.exit.mode === "passive_exit" && !cy.exit.scratching) {
        const leg = cy.legs[cy.exit.leg];
        if (leg.orderId) this.fm.cancel(leg.orderId);
        cy.exit.mode = "hold_to_resolution";
        return this.toResolution(cy, at);
      }
      return this.manageExit(cy, at);
    }
    if (at / 1000 >= cy.marketEnd) return this.exit(cy, at, "market_end", "hold_to_resolution");
    if (cy.firstFillAt == null) {
      if (at - cy.openedAt >= c.quoteTtlSec * 1000) return this.exit(cy, at, "clean_merge");
    } else {
      const unfilled = leftA > EPS ? a : b;
      const bidNow = this.pool.book(unfilled.assetId)?.bestBid()?.price;
      const held = at - cy.firstFillAt;
      if (c.exitMode !== "hold_to_resolution") {
        if (cy.bidAtFirstFill != null && bidNow != null && held >= c.minHoldMs && cy.bidAtFirstFill - bidNow >= c.stopMoveCents / 100 - EPS) return this.exit(cy, at, "stop");
        if (held >= c.legTtlSec * 1000) return this.exit(cy, at, "leg_ttl");
      }
    }
    // keep each unfilled leg quoted; re-peg (cancel + a new order at the back of the queue) when undercut
    for (let i = 0; i < 2; i++) {
      const leg = cy.legs[i];
      if (cy.shares - leg.filled <= EPS) continue;
      const o = leg.orderId && this.fm.orders.get(leg.orderId);
      const book = this.pool.book(leg.assetId);
      const ba = book?.bestAsk()?.price;
      const bb = book?.bestBid()?.price;
      if (ba == null || bb == null) continue;
      const tick = book.tickSize || 0.01;
      const otherPrice = cy.legs[1 - i].fills.length ? cy.legs[1 - i].fills.at(-1).price : cy.legs[1 - i].price;
      if (!o || o.status === "rejected" || o.status === "cancelled") {
        if (at - leg.repegAt < c.repegMinMs) continue;
        const p = this.quotePrice(ba, bb, tick);
        if (otherPrice != null && p + otherPrice < c.pairSumMin - EPS) continue;
        this.placeLeg(cy, i, p, at);
      } else if (o.status === "active" && ba < leg.price - EPS && at - leg.repegAt >= c.repegMinMs) {
        const p = this.quotePrice(ba, bb, tick);
        if (otherPrice != null && p + otherPrice < c.pairSumMin - EPS) continue;
        this.fm.cancel(o.id);
        this.placeLeg(cy, i, p, at);
      }
    }
  }

  // Stop quoting. Matched unfilled pairs merge back at $1; a single leftover leg goes out by exitMode.
  exit(cy, at, reason, mode = this.config.exitMode) {
    for (const leg of cy.legs) if (leg.orderId) this.fm.cancel(leg.orderId);
    const [a, b] = cy.legs;
    const leftA = r6(cy.shares - a.filled);
    const leftB = r6(cy.shares - b.filled);
    const pairs = Math.min(leftA, leftB);
    if (pairs > EPS) {
      this.cash(pairs, cy);
      cy.merged += pairs;
    }
    const legIdx = leftA - pairs > EPS ? 0 : leftB - pairs > EPS ? 1 : -1;
    const qty = legIdx < 0 ? 0 : r6(Math.max(leftA, leftB) - pairs);
    cy.exit = { reason, mode: qty > 0 ? mode : "merge", leg: legIdx, qty, startedAt: at, proceeds: 0, fee: 0 };
    if (reason === "clean_merge") {
      this.s.cooldowns[cy.slug] = at + this.config.mergeCooldownMin * 60_000;
      this.s.counters.cleanMerges++;
    }
    if (qty <= EPS) return this.finish(cy, at, reason);
    cy.exiting = true;
    if (mode === "taker_scratch") return this.scheduleScratch(cy, at);
    if (mode === "hold_to_resolution") return this.toResolution(cy, at);
    // passive_exit: a maker SELL at the best ask − tick, re-pegged until exitTtl, then scratched
    const leg = cy.legs[legIdx];
    leg.orderId = null;
    leg.repegAt = 0;
    this.manageExit(cy, at);
  }

  manageExit(cy, at) {
    const e = cy.exit;
    if (e.mode !== "passive_exit" || e.scratching) return;
    const leg = cy.legs[e.leg];
    const left = r6(cy.shares - leg.filled - cy.merged);
    if (left <= EPS) return this.finish(cy, at, cy.exit.reason);
    if (at - e.startedAt >= this.config.exitTtlSec * 1000) {
      if (leg.orderId) this.fm.cancel(leg.orderId);
      e.scratching = true;
      return this.scheduleScratch(cy, at);
    }
    const book = this.pool.book(leg.assetId);
    const ba = book?.bestAsk()?.price;
    const bb = book?.bestBid()?.price;
    if (ba == null || bb == null) return;
    const o = leg.orderId && this.fm.orders.get(leg.orderId);
    const p = this.quotePrice(ba, bb, book.tickSize || 0.01);
    if (!o || o.status === "rejected" || o.status === "cancelled" || (o.status === "active" && ba < leg.price - EPS && at - leg.repegAt >= this.config.repegMinMs)) {
      if (o?.status === "active") this.fm.cancel(o.id);
      this.fm.place({ id: `${cy.id}:${e.leg}:${leg.quotes++}`, assetId: leg.assetId, side: "SELL", price: p, size: left, placedAt: at });
      leg.orderId = `${cy.id}:${e.leg}:${leg.quotes - 1}`;
      leg.price = p;
      leg.repegAt = at;
    }
  }

  // taker SELL into the bids, 250 ms later (itode), VWAP and fee per level
  scheduleScratch(cy, at) {
    this.pendingTakers.push({
      at: at + this.config.takerDelayMs,
      fn: (t) => {
        const e = cy.exit;
        const leg = cy.legs[e.leg];
        const left = r6(cy.shares - leg.filled - cy.merged);
        if (left <= EPS) return this.finish(cy, t, e.reason);
        const m = this.market(cy.slug);
        const sw = sweep(this.pool.book(leg.assetId)?.bids || new Map(), left, "SELL");
        const fee = m?.fd ? feeOn(sw.levels, m.fd) : 0;
        this.cash(sw.cost - fee, cy);
        cy.takerFees += fee;
        e.proceeds += sw.cost;
        e.fee += fee;
        e.scratchQty = sw.filled;
        e.scratchVwap = sw.avgPrice == null ? null : r6(sw.avgPrice);
        if (sw.filled > 0) leg.fills.push({ qty: sw.filled, price: e.scratchVwap, source: "taker_scratch", at: t, exit: true });
        leg.filled = r6(leg.filled + sw.filled);
        if (left - sw.filled > EPS) return this.toResolution(cy, t); // the book ran out
        this.finish(cy, t, e.reason);
      },
    });
  }

  // hold the leftover until the market settles: $1 a share if it won, 0 if not
  toResolution(cy, at) {
    const e = cy.exit;
    const leg = cy.legs[e.leg];
    const qty = r6(cy.shares - leg.filled - cy.merged);
    this.s.resolving.push({ cycleId: cy.id, slug: cy.slug, outcome: leg.outcome, qty, end: cy.marketEnd, nextTry: 0 });
    e.resolving = qty;
    for (const l of cy.legs) if (l.orderId) this.fm?.cancel(l.orderId);
    this.cycles.delete(cy.id);
    this.waiting.set(cy.id, cy);
    this.dirty = true;
  }

  resolveLeftovers(at) {
    for (const r of this.s.resolving) {
      if (r.busy || at / 1000 < r.end + 60 || at < r.nextTry) continue;
      r.busy = true;
      r.nextTry = at + 15_000;
      Promise.resolve(this.resolve(r.slug))
        .then((w) => {
          if (!w?.winner) return;
          const cy = this.waiting.get(r.cycleId);
          const value = w.winner === r.outcome ? r.qty : 0;
          this.s.resolving = this.s.resolving.filter((x) => x !== r);
          if (cy) {
            this.cash(value, cy);
            cy.exit.proceeds += value;
            cy.exit.resolvedTo = w.winner;
            this.waiting.delete(cy.id);
            this.finish(cy, Math.max(at, this.now()), cy.exit.reason);
          } else this.cash(value, null);
        })
        .catch(() => {})
        .finally(() => (r.busy = false));
    }
  }

  market(slug) {
    return this.marketsOf().find((m) => m.slug === slug) || null;
  }

  // A previous run's open cycle: its orders are gone. Merge the unfilled pairs, resolve a leftover leg.
  abandon(c, reason) {
    const cy = { ...c, legs: c.legs.map((l) => ({ ...l, orderId: null })) };
    const [a, b] = cy.legs;
    const leftA = r6(cy.shares - a.filled);
    const leftB = r6(cy.shares - b.filled);
    const pairs = cy.strategy === "B" ? Math.min(leftA, leftB) : 0;
    if (cy.reserved && cy.strategy === "A") this.s.cash += cy.reserved;
    if (pairs > EPS) {
      this.cash(pairs, cy);
      cy.merged += pairs;
    }
    const legIdx = leftA - pairs > EPS ? 0 : leftB - pairs > EPS ? 1 : -1;
    cy.exit = { reason, mode: "hold_to_resolution", leg: legIdx, qty: legIdx < 0 ? 0 : r6(Math.max(leftA, leftB) - pairs), startedAt: this.now(), proceeds: 0, fee: 0 };
    if (cy.strategy !== "B" || legIdx < 0) return this.close(cy, this.now());
    this.waiting.set(cy.id, cy);
    this.s.resolving.push({ cycleId: cy.id, slug: cy.slug, outcome: cy.legs[legIdx].outcome, qty: cy.exit.qty, end: cy.marketEnd, nextTry: 0 });
  }

  finish(cy, at, reason) {
    for (const leg of cy.legs) if (leg.orderId) this.fm?.cancel(leg.orderId);
    if (!cy.exit) cy.exit = { reason, mode: "none", qty: 0, proceeds: 0, fee: 0 };
    this.close(cy, at);
  }

  close(cy, at) {
    cy.closedAt = at;
    this.cycles.delete(cy.id);
    if (cy.strategy === "B") {
      const still = [...this.cycles.values()].some((x) => x.slug === cy.slug);
      if (!still) this.pool.setPriority?.([cy.legs[0].assetId, cy.legs[1].assetId], false);
    }
    this.s.totals.takerFees += cy.takerFees;
    this.closing.push(cy);
    this.dirty = true;
  }

  onMarkout(f) {
    const cy = this.closing.find((c) => c.id === f.cycleId) || this.cycles.get(f.cycleId) || this.waiting.get(f.cycleId);
    if (!cy) return;
    cy.markouts = cy.markouts || [];
    cy.markouts.push({ qty: f.qty, m5: f.marks[5000], m30: f.marks[30000] });
    for (const l of cy.legs)
      for (const x of l.fills)
        if (x.mkId === f.id) {
          x.m5 = f.marks[5000] == null ? null : r6(f.marks[5000]);
          x.m30 = f.marks[30000] == null ? null : r6(f.marks[30000]);
        }
  }

  // a closed cycle is written once its fills' 30 s markouts are in (or at once when stopping)
  flushClosing(force, at = this.now()) {
    if (!this.closing.length) return;
    const keep = [];
    for (const cy of this.closing) {
      const makerFills = cy.legs.flatMap((l) => l.fills.filter((f) => f.source !== "taker" && f.source !== "taker_scratch"));
      const lastFill = Math.max(0, ...makerFills.map((f) => f.at));
      const ready = force || !makerFills.length || (cy.markouts?.length || 0) >= makerFills.length || at - lastFill > 35_000;
      if (ready) this.writeCycle(cy);
      else keep.push(cy);
    }
    this.closing = keep;
  }

  writeCycle(cy) {
    const net = r6(cy.cashFlow);
    const mk = cy.markouts || [];
    const w = mk.reduce((a, x) => a + x.qty, 0);
    const avg = (k) => (w && mk.every((x) => x[k] != null) ? r6(mk.reduce((a, x) => a + x[k] * x.qty, 0) / w) : null);
    const legFill = (l) => {
      const maker = l.fills.filter((f) => !f.exit);
      return {
        outcome: l.outcome,
        quotedPrice: l.price,
        quotes: l.quotes,
        filledQty: r6(maker.reduce((a, f) => a + f.qty, 0)),
        fillSource: [...new Set(maker.map((f) => f.source))].join("+") || null,
        queueAheadAtPlace: l.queueAheadAtPlace,
        timeToFillMs: maker.length ? maker[0].timeToFillMs ?? maker[0].at - cy.openedAt : null,
        sideOverridden: maker.some((f) => f.sideOverridden),
      };
    };
    const rec = {
      id: cy.id,
      strategy: cy.strategy,
      market: cy.slug,
      coin: cy.coin,
      minutes: cy.minutes,
      openedAt: new Date(cy.openedAt).toISOString(),
      closedAt: new Date(cy.closedAt).toISOString(),
      shares: cy.shares,
      legs: cy.legs.map(legFill),
      merged: r6(cy.merged),
      exit: cy.exit ? { reason: cy.exit.reason, mode: cy.exit.mode, qty: cy.exit.qty, scratchVwap: cy.exit.scratchVwap ?? null, proceeds: r6(cy.exit.proceeds || 0), resolvedTo: cy.exit.resolvedTo ?? null } : null,
      scratch: cy.strategy === "B" && !!cy.exit && ["stop", "leg_ttl", "market_end"].includes(cy.exit.reason) && cy.exit.qty > 0,
      takerFees: r6(cy.takerFees),
      markout5: avg("m5"),
      markout30: avg("m30"),
      sideOverridden: cy.legs.some((l) => l.fills.some((f) => f.sideOverridden)),
      netPnl: net,
      rebateEstimate: this.config.rebateMode === "estimate" ? null : undefined,
      cancelMode: cy.config.cancelMode,
      crossFill: cy.config.crossFill,
      exitMode: cy.config.exitMode,
      edgeAtSignal: cy.edgeAtSignal,
      pairSumAtOpen: cy.pairSumAtOpen,
      // every fill in order: its source, markouts, and for cross fills the diagnostics
      fills: cy.legs
        .flatMap((l, i) => l.fills.map((f) => ({ leg: i, outcome: l.outcome, source: f.source, price: f.price, qty: f.qty, at: f.at, exit: !!f.exit, m5: f.m5 ?? null, m30: f.m30 ?? null, diag: f.diag || undefined })))
        .sort((a, b) => a.at - b.at),
      firstFillSource: cy.legs.flatMap((l) => l.fills.filter((f) => !f.exit)).sort((a, b) => a.at - b.at)[0]?.source ?? null,
    };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.appendFileSync(this.cyclesFile, JSON.stringify(rec) + "\n");
    this.s.totals.cycles++;
    this.s.totals.netPnl = r6(this.s.totals.netPnl + net);
    this.s.equity.push({ t: cy.closedAt, v: r6(this.s.config.startBalance + this.s.totals.netPnl) });
    if (this.s.equity.length > 5000) this.s.equity.shift();
    this.dirty = true;
    this.emit("cycle", rec);
  }

  readCycles(limit = Infinity) {
    let lines = [];
    try {
      lines = fs.readFileSync(this.cyclesFile, "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
    return lines.slice(-limit).map((l) => JSON.parse(l));
  }

  stats() {
    return computeStats(this.readCycles(), this.s.config.startBalance);
  }

  status() {
    return {
      engine: "v2",
      running: this.running,
      startedAt: this.s.startedAt,
      uptimeSec: this.running && this.s.startedAt ? Math.round((this.now() - Date.parse(this.s.startedAt)) / 1000) : 0,
      config: this.s.config,
      cash: r6(this.s.cash),
      counters: this.s.counters,
      open: [...this.cycles.values()].map((c) => ({
        id: c.id,
        strategy: c.strategy,
        market: c.slug,
        openedAt: new Date(c.openedAt).toISOString(),
        exiting: c.exiting,
        legs: c.legs.map((l) => {
          const o = l.orderId && this.fm?.orders.get(l.orderId);
          return { outcome: l.outcome, price: l.price, filled: l.filled, order: o ? { status: o.status, queueAhead: o.queueAhead == null ? null : r2(o.queueAhead), size: o.size } : null };
        }),
      })),
      resolving: this.s.resolving.map(({ busy, ...r }) => r),
      fillModel: this.fm?.metrics() || null,
    };
  }
}

// Stats over cycle records (the jsonl), for the API and the go/no-go card.
export function computeStats(cycles, startBalance) {
  const n = cycles.length;
  const sum = (a, f) => a.reduce((x, c) => x + f(c), 0);
  const net = sum(cycles, (c) => c.netPnl);
  let eq = startBalance;
  let peak = startBalance;
  let maxDD = 0;
  for (const c of cycles) {
    eq += c.netPnl;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, peak > 0 ? (peak - eq) / peak : 0);
  }
  const bySource = {};
  for (const c of cycles)
    for (const s of new Set(c.legs.flatMap((l) => (l.fillSource ? l.fillSource.split("+") : [])))) {
      bySource[s] = bySource[s] || { cycles: 0, net: 0 };
      bySource[s].cycles++;
      bySource[s].net += c.netPnl;
    }
  for (const v of Object.values(bySource)) v.evPerCycle = r6(v.net / v.cycles);
  const b = cycles.filter((c) => c.strategy === "B");
  const bFilled = b.filter((c) => c.legs.some((l) => l.filledQty > 0));
  const quoted = sum(b, (c) => 2 * c.shares);
  const filled = sum(b, (c) => c.legs.reduce((a, l) => a + l.filledQty, 0));
  const ttf = b.flatMap((c) => c.legs.map((l) => l.timeToFillMs).filter((x) => x != null));
  const mk = (k) => {
    const xs = cycles.filter((c) => c[k] != null);
    return xs.length ? r6(xs.reduce((a, c) => a + c[k], 0) / xs.length) : null;
  };
  return {
    cycles: n,
    byStrategy: { A: cycles.filter((c) => c.strategy === "A").length, B: b.length },
    netPnl: r6(net),
    evPerCycle: n ? r6(net / n) : null,
    evByFillSource: bySource,
    scratchPct: bFilled.length ? +((100 * bFilled.filter((c) => c.scratch).length) / bFilled.length).toFixed(2) : null,
    markout5: mk("markout5"),
    markout30: mk("markout30"),
    takerFees: r6(sum(cycles, (c) => c.takerFees)),
    maxDrawdownPct: +(100 * maxDD).toFixed(2),
    fillRatePct: quoted ? +((100 * filled) / quoted).toFixed(2) : null,
    avgTimeToFillMs: ttf.length ? Math.round(ttf.reduce((a, x) => a + x, 0) / ttf.length) : null,
    sideOverriddenCycles: cycles.filter((c) => c.sideOverridden).length,
  };
}
