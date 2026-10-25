// Engine v2 on a fake feed: strategy B cycles, stop-loss, exits, clean merge + cooldown, strategy A, restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { OrderBook } from "../lib/clob-ws.js";
import { MarketMakerV2, computeStats, DEFAULT_CONFIG } from "../lib/mm-v2.js";

const UP = "1000";
const DOWN = "2000";
const FD = { r: 0.07, e: 1, to: true };
const T0 = Date.UTC(2026, 9, 25, 10, 1, 0);

// A fake feed with one 15-minute market. Books are mirrored unless a test breaks that on purpose.
function world({ config = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-mm2-")), fd = FD, resolve, stale = false } = {}) {
  let t = T0;
  const books = { [UP]: new OrderBook(UP), [DOWN]: new OrderBook(DOWN) };
  for (const b of Object.values(books)) {
    b.tickSize = 0.01;
    b.hasSnapshot = true;
  }
  const pool = new EventEmitter();
  pool.book = (id) => books[id];
  pool.isStale = () => stale;
  pool.priority = new Set();
  pool.setPriority = (ids, on) => ids.forEach((id) => (on ? pool.priority.add(id) : pool.priority.delete(id)));
  const start = Math.floor(T0 / 1000 / 900) * 900;
  const market = { slug: `btc-updown-15m-${start}`, coin: "btc", minutes: 15, start, end: start + 900, fd, minOrderSize: 5, tickSize: 0.01, tokens: [{ outcome: "Up", assetId: UP }, { outcome: "Down", assetId: DOWN }] };
  const set = (id, side, price, size) => {
    const m = side === "bid" ? books[id].bids : books[id].asks;
    const prev = m.get(price) || 0;
    size > 0 ? m.set(price, size) : m.delete(price);
    if (prev !== size) pool.emit("level", { assetId: id, side, price, newSize: size, prevSize: prev, recvTs: t, source: "price_change" });
  };
  // a level on Up and its mirror on Down
  const level = (side, price, size) => {
    set(UP, side, price, size);
    set(DOWN, side === "ask" ? "bid" : "ask", Math.round((1 - price) * 100) / 100, size);
  };
  const trade = (assetId, price, size, side) => pool.emit("trade", { assetId, price, size, side, ts: t, recvTs: t });
  const mm = new MarketMakerV2({ pool, markets: () => [market], dataDir: dir, now: () => t, timers: false, resolve: resolve || (async () => null) });
  if (Object.keys(config).length) mm.setConfig(config);
  const at = (ms) => {
    t = T0 + ms;
    mm.tick(t);
  };
  return { mm, books, pool, market, set, level, trade, at, dir, get t() { return t; } };
}

// Up bid 0.47 / ask 0.52 (spread 5¢): we quote Up 0.51 and Down 0.52 → 1.03
function quoted(opts) {
  const w = world(opts);
  w.level("bid", 0.47, 200);
  w.level("bid", 0.46, 500);
  w.level("ask", 0.52, 200);
  w.level("ask", 0.53, 500);
  w.mm.start();
  w.at(0);
  return w;
}

const cyclesOf = (w) => w.mm.readCycles();
const open = (w) => [...w.mm.cycles.values()];

test("B opens a split when the two quotes add up to 1.02–1.065, one tick inside the ask, post-only", () => {
  const w = quoted();
  const [cy] = open(w);
  assert.equal(cy.strategy, "B");
  assert.deepEqual(cy.legs.map((l) => l.price), [0.51, 0.52]);
  assert.equal(cy.pairSumAtOpen, 1.03);
  assert.equal(w.mm.s.cash, 40, "$10 split into 10 Up + 10 Down");
  assert.ok(w.pool.priority.has(UP), "the shadow checks this market every 15 s");
  w.at(500);
  assert.equal(w.mm.fm.orders.get(cy.legs[0].orderId).status, "active");
  assert.equal(w.mm.fm.orders.get(cy.legs[0].orderId).queueAheadAtPlace, 0, "a price nobody quoted");
});

test("B doesn't open when the quotes add up to less than pairSumMin", () => {
  const w = world();
  w.level("bid", 0.48, 200);
  w.level("ask", 0.51, 200); // spread 3¢ → quotes 0.50 + 0.51 = 1.01
  w.mm.start();
  w.at(0);
  assert.equal(open(w).length, 0);
});

test("both legs fill → net = shares × (sum − 1), written with fill sources and markouts", () => {
  const w = quoted();
  const first = open(w)[0].id;
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  w.at(800);
  w.trade(DOWN, 0.52, 10, "BUY");
  w.at(1000);
  assert.equal(w.mm.cycles.has(first), false, "closed (and the market quoted again)");
  assert.equal(cyclesOf(w).length, 0, "waits for the 30 s markouts");
  w.at(32_000);
  const [c] = cyclesOf(w);
  assert.equal(c.netPnl, 0.3);
  assert.equal(c.exit.reason, "both_filled");
  assert.deepEqual(c.legs.map((l) => l.fillSource), ["trade_at_level", "trade_at_level"]);
  assert.equal(c.legs[0].queueAheadAtPlace, 0);
  assert.equal(c.legs[0].timeToFillMs, 500);
  assert.equal(c.markout5, 0.015, "Up: sold 0.51, mid 0.495; Down: sold 0.52, mid 0.505 → +1.5¢ each");
  assert.equal(c.scratch, false);
  assert.equal(c.sideOverridden, false);
  assert.equal(c.cancelMode, "pessimistic");
  assert.equal(c.crossFill, "all");
  assert.deepEqual(c.fills.map((f) => [f.leg, f.source, f.m5]), [[0, "trade_at_level", 0.015], [1, "trade_at_level", 0.015]]);
  assert.equal(c.firstFillSource, "trade_at_level");
  assert.equal(c.exitMode, "taker_scratch");
  assert.equal(w.mm.s.totals.netPnl, 0.3);
  assert.equal(w.mm.s.equity.at(-1).v, 50.3);
});

test("stop-loss: a fill with a 4¢ spread doesn't scratch at once (the v1 bug)", () => {
  const w = world();
  w.level("bid", 0.48, 200);
  w.level("ask", 0.52, 200); // spread 4¢ → 0.51 + 0.51 = 1.02
  w.mm.start();
  w.at(0);
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  // our ask 0.51 is 3¢ over the Down... the old rule (price − bid ≥ 3¢) fired here
  for (const ms of [600, 3_000, 6_000, 20_000]) w.at(ms);
  const [cy] = open(w);
  assert.ok(cy, "still open");
  assert.equal(cy.exiting, false);
});

test("stop-loss: the unfilled leg's bid falls 3¢ since the fill — only after minHoldMs", () => {
  const w = world();
  w.level("bid", 0.48, 200);
  w.level("ask", 0.52, 200);
  w.mm.start();
  w.at(0);
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY"); // Down bid at fill: 0.48
  w.at(1_000);
  w.set(DOWN, "bid", 0.48, 0);
  w.set(DOWN, "bid", 0.45, 300); // −3¢
  w.at(3_000);
  assert.equal(open(w)[0].exiting, false, "fill is only 2.5 s old");
  w.at(5_600);
  assert.equal(open(w)[0].exit.reason, "stop");
  w.at(5_900); // taker scratch 250 ms later
  w.at(40_000);
  const [c] = cyclesOf(w);
  assert.equal(c.exit.reason, "stop");
  assert.equal(c.scratch, true);
  assert.equal(c.exit.scratchVwap, 0.45);
  const fee = 10 * 0.07 * 0.45 * 0.55;
  assert.equal(c.takerFees, +fee.toFixed(6));
  assert.equal(c.netPnl, +(10 * 0.51 + 10 * 0.45 - fee - 10).toFixed(6));
});

test("leg TTL: one leg filled, the other not within legTtlSec → exit", () => {
  const w = quoted({ config: { legTtlSec: 60 } });
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  w.at(60_000);
  assert.equal(open(w)[0].exiting, false);
  w.at(60_600);
  assert.equal(open(w)[0].exit.reason, "leg_ttl");
});

test("clean merge after quoteTtl with no fill: PnL 0, a 15 min cooldown, kept in the state file", () => {
  const w = quoted();
  w.at(180_100);
  assert.equal(open(w).length, 0);
  const [c] = cyclesOf(w);
  assert.equal(c.exit.reason, "clean_merge");
  assert.equal(c.netPnl, 0);
  assert.equal(w.mm.s.cash, 50);
  w.mm.save();
  const saved = JSON.parse(fs.readFileSync(path.join(w.dir, "mm-paper-v2.json"), "utf8"));
  assert.ok(saved.cooldowns[w.market.slug] > w.t + 14 * 60_000);
  w.at(185_000);
  assert.equal(open(w).length, 0, "cooling down");
  // a new engine on the same folder still knows the cooldown
  w.mm.stop();
  const again = new MarketMakerV2({ pool: w.pool, markets: () => [w.market], dataDir: w.dir, now: () => w.t, timers: false });
  again.start();
  again.tick(w.t + 2_000);
  assert.equal(again.cycles.size, 0);
});

test("partial: 6 of 10 sold on one leg → 4 pairs merge, 6 shares of the other leg exit", () => {
  const w = quoted({ config: { legTtlSec: 30 } });
  w.at(500);
  w.trade(UP, 0.51, 6, "BUY");
  w.at(31_000);
  const cy = open(w)[0];
  assert.equal(cy.merged, 4);
  assert.equal(cy.exit.qty, 6);
  assert.equal(cy.exit.leg, 1);
});

test("passive_exit re-pegs a maker SELL and scratches after exitTtl", () => {
  const w = quoted({ config: { exitMode: "passive_exit", legTtlSec: 10, exitTtlSec: 20 } });
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  w.at(10_600);
  const cy = open(w)[0];
  assert.equal(cy.exit.mode, "passive_exit");
  const leg = cy.legs[1];
  assert.equal(w.mm.fm.orders.get(leg.orderId).price, 0.52);
  w.at(30_700);
  assert.equal(cy.exit.scratching, true);
  w.at(31_000);
  w.at(70_000);
  assert.equal(cyclesOf(w)[0].exit.reason, "leg_ttl");
});

test("hold_to_resolution: no stop, no TTL; the leftover settles at the market's result", async () => {
  let winner = null;
  const w = quoted({ config: { exitMode: "hold_to_resolution", legTtlSec: 10 }, resolve: async () => (winner ? { winner } : null) });
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  w.set(DOWN, "bid", 0.47, 0);
  w.at(60_000);
  assert.equal(open(w)[0].exiting, false, "holding");
  const end = (w.market.end - T0 / 1000) * 1000;
  w.at(end + 1);
  assert.equal(open(w).length, 0);
  assert.equal(w.mm.waiting.size, 1);
  winner = "Down";
  w.at(end + 61_000 + 1);
  await new Promise((r) => setImmediate(r));
  w.at(end + 100_000);
  const [c] = cyclesOf(w);
  assert.equal(c.exit.resolvedTo, "Down");
  assert.equal(c.netPnl, +(10 * 0.51 + 10 - 10).toFixed(6), "the 10 Down shares paid $1 each");
});

test("strategy A: edge after fees on both asks, executed on the book 250 ms later", () => {
  // books that don't mirror (an A edge can't exist while they do: ask Up + ask Down = 1 + spread)
  const w = world({ config: { strategies: { A: true, B: false } } });
  w.set(UP, "ask", 0.45, 100);
  w.set(UP, "bid", 0.44, 100);
  w.set(DOWN, "ask", 0.5, 100);
  w.set(DOWN, "bid", 0.49, 100);
  w.mm.start();
  w.at(0);
  assert.equal(w.mm.s.counters.aOpportunities, 1);
  w.set(DOWN, "ask", 0.5, 4); // most of it went in the 250 ms
  w.set(DOWN, "ask", 0.51, 100);
  w.at(260);
  w.at(2_000);
  const [c] = cyclesOf(w);
  assert.equal(c.strategy, "A");
  assert.equal(w.mm.s.counters.aExecuted, 1);
  const n = 10.52; // min(100, 100, $10 / 0.95) shares
  const costDown = 4 * 0.5 + (n - 4) * 0.51;
  const fee = n * 0.07 * 0.45 * 0.55 + 4 * 0.07 * 0.25 + (n - 4) * 0.07 * 0.51 * 0.49;
  assert.ok(Math.abs(c.netPnl - (n - n * 0.45 - costDown - fee)) < 1e-6);
  assert.equal(c.legs[0].fillSource, "taker");
  w.at(3_000);
  assert.equal(w.mm.s.counters.aOpportunities, 1, "the same edge isn't counted twice");
});

test("a stale token → no new quote; no fee data → skipped and counted", () => {
  const s = world({ stale: true });
  s.level("bid", 0.47, 200);
  s.level("ask", 0.52, 200);
  s.mm.start();
  s.at(0);
  assert.equal(open(s).length, 0);
  const f = world({ fd: null });
  f.level("bid", 0.47, 200);
  f.level("ask", 0.52, 200);
  f.mm.start();
  f.at(0);
  assert.equal(open(f).length, 0);
  assert.equal(f.mm.s.counters.skippedNoFd, 1);
});

test("restart: a cycle left open is merged and its leftover leg resolved; config is locked while running", async () => {
  const w = quoted();
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  w.at(600);
  assert.throws(() => w.mm.setConfig({ orderUsd: 20 }), /Stop the engine/);
  w.mm.stop();
  const again = new MarketMakerV2({ pool: w.pool, markets: () => [w.market], dataDir: w.dir, now: () => w.t, timers: false, resolve: async () => ({ winner: "Up" }) });
  assert.equal(again.s.open.length, 1);
  again.start();
  assert.equal(again.waiting.size, 1);
  again.tick(w.market.end * 1000 + 61_000);
  await new Promise((r) => setImmediate(r));
  again.tick(w.market.end * 1000 + 62_000);
  const [c] = again.readCycles();
  assert.equal(c.exit.reason, "restart");
  assert.equal(c.netPnl, +(10 * 0.51 - 10).toFixed(6), "Down lost: the unsold Down shares are worth 0");
});

test("a fill decided by the effective side is flagged on the cycle", () => {
  const w = quoted();
  w.at(500);
  // someone bids Down 0.49 (the price of our Up ask 0.51, seen from Down), then it's hit
  w.set(DOWN, "bid", 0.49, 7);
  w.at(600);
  w.set(DOWN, "bid", 0.49, 0);
  w.trade(DOWN, 0.49, 7, "BUY"); // reported BUY, but a Down bid went down → a Down SELL = an Up BUY at 0.51
  w.at(700);
  const cy = open(w)[0];
  assert.equal(cy.legs[0].filled, 7);
  assert.equal(cy.legs[0].fills[0].sideOverridden, true);
});

test("rebate is never added to equity; stats over cycles", () => {
  const w = quoted({ config: { rebateMode: "estimate" } });
  w.at(500);
  w.trade(UP, 0.51, 10, "BUY");
  w.trade(DOWN, 0.52, 10, "BUY");
  w.at(40_000);
  // a new split ($10) is open again by now; the closed cycle added exactly its PnL, no rebate
  assert.equal(+(w.mm.s.cash + 10 * open(w).length).toFixed(6), 50.3);
  const s = computeStats(cyclesOf(w), DEFAULT_CONFIG.startBalance);
  assert.equal(s.cycles, 1);
  assert.equal(s.evPerCycle, 0.3);
  assert.equal(s.fillRatePct, 100);
  assert.equal(s.evByFillSource.trade_at_level.cycles, 1);
  assert.equal(s.maxDrawdownPct, 0);
});
