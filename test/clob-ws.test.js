// Feed layer: book upkeep, level events, stale/fresh, reconnects, raw log, rotator, instance lock. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { ClobFeed, FeedPool, RawLog, OrderBook, topOfBook, sameTop } from "../lib/clob-ws.js";
import { MarketRotator } from "../lib/market-rotator.js";
import * as lock from "../lib/instance-lock.js";
import { options } from "../lib/mm-feed.js";

class FakeWS {
  static all = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWS.all.push(this);
  }
  send(x) {
    this.sent.push(x);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  msg(obj) {
    this.onmessage?.({ data: typeof obj === "string" ? obj : JSON.stringify(obj) });
  }
}

const A = "111";
const B = "222";
const book = (asset, bids, asks, ts = 1000) => ({
  event_type: "book",
  asset_id: asset,
  market: "0xm",
  timestamp: String(ts),
  hash: "h",
  tick_size: "0.01",
  // the exchange sends bids ascending and asks descending: the best price is last
  bids: bids.map(([p, s]) => ({ price: String(p), size: String(s) })),
  asks: asks.map(([p, s]) => ({ price: String(p), size: String(s) })),
});

function feedWith(ids = [A], opts = {}) {
  FakeWS.all = [];
  let t = 10_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const f = new ClobFeed({ WebSocketImpl: FakeWS, now: clock.now, random: () => 0, ...opts });
  const events = [];
  for (const ev of ["level", "trade", "tick", "stale", "fresh", "reconnected"]) f.on(ev, (e) => events.push({ ev, ...e }));
  f.subscribe(ids);
  const ws = FakeWS.all.at(-1);
  ws.open();
  return { f, ws, events, clock };
}

test("subscribe: first message is the market subscribe, later ones are dynamic", () => {
  const { f, ws } = feedWith([A]);
  assert.deepEqual(JSON.parse(ws.sent[0]), { assets_ids: [A], type: "market", custom_feature_enabled: true });
  f.subscribe([B]);
  assert.deepEqual(JSON.parse(ws.sent[1]), { assets_ids: [B], operation: "subscribe" });
  f.unsubscribe([B]);
  assert.deepEqual(JSON.parse(ws.sent[2]), { assets_ids: [B], operation: "unsubscribe" });
  f.close();
});

test("book snapshot: best price is last in the arrays; stale until the snapshot, then fresh", () => {
  const { f, ws, events } = feedWith([A]);
  assert.ok(events.some((e) => e.ev === "stale" && e.assetId === A));
  ws.msg([book(A, [[0.01, 100], [0.45, 20], [0.48, 5]], [[0.99, 100], [0.55, 7], [0.52, 3]])]);
  const b = f.books.get(A);
  assert.deepEqual(b.bbo(), { bid: 0.48, bidSize: 5, ask: 0.52, askSize: 3 });
  assert.equal(b.tickSize, 0.01);
  assert.ok(events.some((e) => e.ev === "fresh" && e.assetId === A));
  const lv = events.filter((e) => e.ev === "level");
  assert.equal(lv.length, 6);
  assert.ok(lv.every((e) => e.source === "resync" && e.prevSize === 0));
  f.close();
});

test("price_change: size is the absolute new size; 0 removes the level", () => {
  const { f, ws, events } = feedWith([A]);
  ws.msg(book(A, [[0.47, 10], [0.48, 5]], [[0.53, 4], [0.52, 3]]));
  events.length = 0;
  ws.msg({
    event_type: "price_change",
    market: "0xm",
    timestamp: "2000",
    price_changes: [
      { asset_id: A, price: "0.48", size: "12", side: "BUY", hash: "x", best_bid: "0.48", best_ask: "0.52" },
      { asset_id: A, price: "0.52", size: "0", side: "SELL", hash: "y", best_bid: "0.48", best_ask: "0.53" },
    ],
  });
  const b = f.books.get(A);
  assert.equal(b.bids.get(0.48), 12);
  assert.equal(b.asks.has(0.52), false);
  assert.equal(b.bestAsk().price, 0.53);
  const lv = events.filter((e) => e.ev === "level");
  assert.deepEqual(
    lv.map((e) => [e.side, e.price, e.prevSize, e.newSize, e.source, e.ts]),
    [
      ["bid", 0.48, 5, 12, "price_change", 2000],
      ["ask", 0.52, 3, 0, "price_change", 2000],
    ],
  );
  f.close();
});

test("price_change for both tokens in one message updates both books", () => {
  const { f, ws } = feedWith([A, B]);
  ws.msg([book(A, [[0.48, 5]], [[0.52, 3]]), book(B, [[0.48, 5]], [[0.52, 3]])]);
  ws.msg({
    event_type: "price_change",
    timestamp: "2000",
    price_changes: [
      { asset_id: A, price: "0.49", size: "8", side: "BUY", best_bid: "0.49", best_ask: "0.52" },
      { asset_id: B, price: "0.51", size: "8", side: "SELL", best_bid: "0.48", best_ask: "0.51" },
    ],
  });
  assert.equal(f.books.get(A).bestBid().price, 0.49);
  assert.equal(f.books.get(B).bestAsk().price, 0.51);
  f.close();
});

test("bbo_heal: local levels better than the exchange's best bid/ask are removed", () => {
  const { f, ws, events } = feedWith([A]);
  ws.msg(book(A, [[0.45, 10], [0.46, 10], [0.47, 10]], [[0.55, 10], [0.54, 10], [0.53, 10]]));
  events.length = 0;
  // a sweep took 0.47 and 0.46 but only one level change arrived
  ws.msg({
    event_type: "price_change",
    timestamp: "3000",
    price_changes: [{ asset_id: A, price: "0.47", size: "0", side: "BUY", best_bid: "0.45", best_ask: "0.53" }],
  });
  const b = f.books.get(A);
  assert.equal(b.bestBid().price, 0.45);
  const heal = events.filter((e) => e.ev === "level" && e.source === "bbo_heal");
  assert.deepEqual(heal.map((e) => [e.side, e.price, e.prevSize, e.newSize]), [["bid", 0.46, 10, 0]]);
  f.close();
});

test("a later snapshot is diffed: only changed levels, source snapshot", () => {
  const { f, ws, events } = feedWith([A]);
  ws.msg(book(A, [[0.47, 10], [0.48, 5]], [[0.53, 4], [0.52, 3]]));
  events.length = 0;
  ws.msg(book(A, [[0.47, 10], [0.48, 2]], [[0.53, 4]], 4000));
  const lv = events.filter((e) => e.ev === "level");
  assert.deepEqual(
    lv.map((e) => [e.side, e.price, e.prevSize, e.newSize, e.source]),
    [
      ["bid", 0.48, 5, 2, "snapshot"],
      ["ask", 0.52, 3, 0, "snapshot"],
    ],
  );
  f.close();
});

test("trade and tick_size_change events; fee_rate_bps is ignored", () => {
  const { f, ws, events } = feedWith([A]);
  ws.msg(book(A, [[0.48, 5]], [[0.52, 3]]));
  ws.msg({ event_type: "last_trade_price", asset_id: A, market: "0xm", price: "0.52", size: "3", side: "BUY", fee_rate_bps: "0", timestamp: "5000", transaction_hash: "0xt" });
  ws.msg({ event_type: "tick_size_change", asset_id: A, old_tick_size: "0.01", new_tick_size: "0.001", timestamp: "5100" });
  const tr = events.find((e) => e.ev === "trade");
  assert.deepEqual({ p: tr.price, s: tr.size, side: tr.side, ts: tr.ts }, { p: 0.52, s: 3, side: "BUY", ts: 5000 });
  assert.equal("fee" in tr, false);
  const tk = events.find((e) => e.ev === "tick");
  assert.deepEqual([tk.oldTick, tk.newTick], [0.01, 0.001]);
  assert.equal(f.books.get(A).tickSize, 0.001);
  f.close();
});

test("PING every 10 s; no PONG for 25 s → reconnect, resubscribe, stale until snapshot", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { f, ws, events, clock } = feedWith([A]);
  ws.msg(book(A, [[0.48, 5]], [[0.52, 3]]));
  clock.advance(10_000);
  t.mock.timers.tick(10_000);
  assert.ok(ws.sent.includes("PING"));
  ws.msg("PONG");
  assert.equal(f.healthy, true);
  clock.advance(26_000);
  t.mock.timers.tick(5_000); // health check
  assert.equal(ws.closed, true);
  assert.equal(f.reconnects, 1);
  assert.ok(events.some((e) => e.ev === "stale" && /no PONG/.test(e.reason)));
  t.mock.timers.tick(1_000); // backoff 1 s (jitter 0)
  const ws2 = FakeWS.all.at(-1);
  assert.notEqual(ws2, ws);
  ws2.open();
  assert.deepEqual(JSON.parse(ws2.sent[0]), { assets_ids: [A], type: "market", custom_feature_enabled: true });
  assert.ok(events.some((e) => e.ev === "reconnected"));
  assert.equal(f.books.get(A).hasSnapshot, false);
  ws2.msg(book(A, [[0.48, 5]], [[0.52, 3]]));
  assert.equal(f.books.get(A).hasSnapshot, true);
  f.close();
});

test("backoff doubles to 30 s; silence alone is not stale", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { f, ws } = feedWith([A]);
  ws.msg(book(A, [[0.48, 5]], [[0.52, 3]]));
  const delays = [];
  for (let i = 0; i < 7; i++) {
    const before = FakeWS.all.length;
    FakeWS.all.at(-1).onclose();
    let waited = 0;
    while (FakeWS.all.length === before) {
      t.mock.timers.tick(250);
      waited += 250;
    }
    delays.push(waited);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  f.close();
});

const pc = (asset, price, size, side, hash, bb, ba, ts = 2000) => ({
  event_type: "price_change",
  timestamp: String(ts),
  price_changes: [{ asset_id: asset, price: String(price), size: String(size), side, hash, best_bid: String(bb), best_ask: String(ba) }],
});
const withHash = (m, hash) => ({ ...m, hash });

test("stateAt: our book as it was at an exchange hash, by undoing later changes", () => {
  const { f, ws } = feedWith([A]);
  ws.msg(withHash(book(A, [[0.47, 10], [0.48, 5]], [[0.53, 4], [0.52, 3]]), "h0"));
  ws.msg(pc(A, 0.48, 9, "BUY", "h1", 0.48, 0.52));
  ws.msg(pc(A, 0.49, 2, "BUY", "h2", 0.49, 0.52));
  const b = f.books.get(A);
  const at1 = b.stateAt("h1");
  assert.deepEqual([...at1.bids].sort(), [[0.47, 10], [0.48, 9]]);
  assert.equal(at1.after.length, 1);
  const at0 = b.stateAt("h0");
  assert.deepEqual([...at0.bids].sort(), [[0.47, 10], [0.48, 5]]);
  assert.equal(b.stateAt("nope"), null);
  assert.deepEqual([...b.bids].sort(), [[0.47, 10], [0.48, 9], [0.49, 2]], "the live book is untouched");
  f.close();
});

function poolWith(t) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  FakeWS.all = [];
  let now = 100_000;
  const clock = { now: () => now, advance: (ms) => (now += ms) };
  const pool = new FeedPool({ size: 1, WebSocketImpl: FakeWS, now: clock.now, random: () => 0, restSampleMs: 0 });
  pool.add([A]);
  const main = FakeWS.all[0];
  main.open();
  main.msg(withHash(book(A, [[0.47, 10], [0.48, 5]], [[0.52, 3], [0.53, 4]]), "h0"));
  const levels = [];
  pool.on("level", (e) => levels.push(e));
  // first check is due 5 s after the token is added
  clock.advance(5_000);
  t.mock.timers.tick(500);
  const shadow = FakeWS.all[1];
  shadow.open();
  return { pool, main, shadow, clock, levels };
}

test("shadow resync: the token is subscribed on the shadow connection, checked, and unsubscribed", (t) => {
  const { pool, main, shadow, clock } = poolWith(t);
  assert.deepEqual(JSON.parse(shadow.sent[0]), { assets_ids: [A], type: "market", custom_feature_enabled: true });
  shadow.msg(withHash(book(A, [[0.47, 10], [0.48, 5]], [[0.52, 3], [0.53, 4]]), "h0"));
  assert.deepEqual(JSON.parse(shadow.sent.at(-1)), { assets_ids: [A], operation: "unsubscribe" });
  assert.equal(main.closed, false, "the main connection is never touched");
  const d = pool.health().drift;
  assert.equal(d.checks, 1);
  assert.equal(d.ok, 1);
  assert.equal(d.driftDetected, 0);
  // next check one interval later
  clock.advance(49_000);
  main.msg("PONG");
  t.mock.timers.tick(500);
  assert.equal(shadow.sent.filter((x) => x.includes('"subscribe"')).length, 0);
  clock.advance(1_500);
  main.msg("PONG");
  t.mock.timers.tick(500);
  assert.deepEqual(JSON.parse(shadow.sent.at(-1)), { assets_ids: [A], operation: "subscribe" });
  pool.close();
});

test("shadow resync: a drift is fixed to the snapshot plus later changes, as resync level events", (t) => {
  const { pool, main, shadow, levels } = poolWith(t);
  main.msg(pc(A, 0.48, 7, "BUY", "h1", 0.48, 0.52));
  // the exchange's book at h1 has no 0.53 ask (we never heard it go) and 0.52 is 1, not 3
  main.msg(pc(A, 0.49, 2, "BUY", "h2", 0.49, 0.52));
  levels.length = 0;
  shadow.msg(withHash(book(A, [[0.47, 10], [0.48, 7]], [[0.52, 1]]), "h1"));
  const b = pool.book(A);
  assert.deepEqual([...b.asks], [[0.52, 1]]);
  assert.deepEqual([...b.bids].sort(), [[0.47, 10], [0.48, 7], [0.49, 2]], "the change after h1 is kept");
  assert.deepEqual(
    levels.map((e) => [e.side, e.price, e.prevSize, e.newSize, e.source]).sort(),
    [
      ["ask", 0.52, 3, 1, "resync"],
      ["ask", 0.53, 4, 0, "resync"],
    ],
  );
  const d = pool.health().drift;
  assert.equal(d.driftDetected, 1);
  assert.equal(d.maxDriftAgeSec, 5);
  assert.ok(d.driftPerTokenHour > 0);
  pool.close();
});

test("shadow resync: a snapshot ahead of the main connection waits for its hash", (t) => {
  const { pool, main, shadow } = poolWith(t);
  shadow.msg(withHash(book(A, [[0.47, 10], [0.48, 6]], [[0.52, 3], [0.53, 4]]), "h1"));
  assert.equal(pool.health().drift.checks, 0, "h1 not seen on the main connection yet");
  main.msg(pc(A, 0.48, 6, "BUY", "h1", 0.48, 0.52));
  t.mock.timers.tick(500);
  const d = pool.health().drift;
  assert.deepEqual([d.checks, d.ok, d.hashLate, d.driftDetected], [1, 1, 1, 0]);
  pool.close();
});

test("shadow resync: a hash that never shows up is replayed by exchange time", (t) => {
  const { pool, main, shadow } = poolWith(t);
  main.msg(pc(A, 0.49, 2, "BUY", "h2", 0.49, 0.52, 3000));
  shadow.msg(withHash(book(A, [[0.47, 10], [0.48, 5]], [[0.52, 3]], 2500), "hX"));
  for (let i = 0; i < 3; i++) t.mock.timers.tick(500);
  const b = pool.book(A);
  assert.deepEqual([...b.asks], [[0.52, 3]]);
  assert.equal(b.bids.get(0.49), 2, "the change at t=3000 is after the snapshot at 2500");
  const d = pool.health().drift;
  assert.deepEqual([d.hashMissing, d.driftDetected], [1, 1]);
  pool.close();
});

test("shadow resync: tokens with orders are checked every 15 s", (t) => {
  const { pool, shadow, clock } = poolWith(t);
  shadow.msg(withHash(book(A, [[0.47, 10], [0.48, 5]], [[0.52, 3], [0.53, 4]]), "h0"));
  pool.setPriority([A]);
  clock.advance(15_500);
  t.mock.timers.tick(500);
  assert.deepEqual(JSON.parse(shadow.sent.at(-1)), { assets_ids: [A], operation: "subscribe" });
  pool.close();
});

test("REST sample: lined up by hash, top of book compared", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  FakeWS.all = [];
  let rest = { hash: "h1", bids: [{ price: "0.48", size: "7" }], asks: [{ price: "0.52", size: "3" }] };
  const pool = new FeedPool({ size: 1, WebSocketImpl: FakeWS, shadowMs: 0, restSampleMs: 0, restBook: async () => rest });
  pool.add([A]);
  const main = FakeWS.all[0];
  main.open();
  main.msg(withHash(book(A, [[0.47, 10], [0.48, 5]], [[0.52, 3]]), "h0"));
  main.msg(pc(A, 0.48, 7, "BUY", "h1", 0.48, 0.52));
  main.msg(pc(A, 0.49, 1, "BUY", "h2", 0.49, 0.52));
  assert.equal(await pool.restSample(A), true, "REST was at h1; our book has moved on since, which is fine");
  rest = { hash: "h2", bids: [{ price: "0.49", size: "4" }], asks: [{ price: "0.52", size: "3" }] };
  assert.equal(await pool.restSample(A), false);
  const r = pool.health().restSample;
  assert.deepEqual([r.checks, r.match, r.hashFound, r.matchPct], [2, 1, 2, 50]);
  pool.close();
});

test("topOfBook reads REST books in either order", () => {
  const top = topOfBook({ bids: [{ price: "0.01", size: "9" }, { price: "0.48", size: "5" }], asks: [{ price: "0.99", size: "9" }, { price: "0.52", size: "3" }] });
  assert.ok(sameTop(top, { bid: 0.48, bidSize: 5, ask: 0.52, askSize: 3 }));
  const b = new OrderBook("x");
  assert.deepEqual(b.bbo(), { bid: null, bidSize: null, ask: null, askSize: null });
});

test("FeedPool: tokens spread over connections, a market's pair together, events forwarded", () => {
  FakeWS.all = [];
  const pool = new FeedPool({ size: 3, WebSocketImpl: FakeWS });
  pool.add(["a1", "a2"]);
  pool.add(["b1", "b2"]);
  pool.add(["c1", "c2"]);
  pool.add(["d1", "d2"]);
  assert.deepEqual(pool.feeds.map((f) => f.books.size), [4, 2, 2]);
  assert.equal(pool.where.get("a1"), pool.where.get("a2"));
  const got = [];
  pool.on("fresh", (e) => got.push(e.assetId));
  const ws = FakeWS.all[0];
  ws.open();
  ws.msg(book("a1", [[0.4, 1]], [[0.6, 1]]));
  assert.deepEqual(got, ["a1"]);
  assert.equal(pool.isStale("a1"), false);
  assert.equal(pool.isStale("a2"), true);
  pool.remove(["a1", "a2"]);
  assert.equal(pool.where.size, 6);
  const h = pool.health();
  assert.equal(h.connections.length, 3);
  assert.equal(h.tokens, 6);
  pool.close();
});

test("RawLog: newline-free JSON lines, one gzip member per flush, readable as one file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-raw-"));
  const log = new RawLog({ dir, flushMs: 1e9 });
  const ts = Date.UTC(2026, 9, 24, 7, 15, 0);
  log.write(ts, 0, '{"event_type":"book",\n"asset_id":"1"}');
  await log.flush();
  log.write(ts + 1, 3, '[{"event_type":"price_change"}]');
  log.write(ts + 2, 3, "weird text");
  log.close();
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ["2026-10-24-07.jsonl.gz"]);
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(dir, files[0]))).toString().trim().split("\n");
  assert.equal(lines.length, 3);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepEqual(parsed[0], { r: ts, c: 0, m: { event_type: "book", asset_id: "1" } });
  assert.deepEqual(parsed[1].m, [{ event_type: "price_change" }]);
  assert.equal(parsed[2].m, "weird text");
});

test("RawLog: a new hour starts a new file; the rolling limit deletes the oldest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-raw-"));
  for (const h of ["2026-10-24-01", "2026-10-24-02"]) fs.writeFileSync(path.join(dir, `${h}.jsonl.gz`), Buffer.alloc(600));
  const log = new RawLog({ dir, maxBytes: 1000, flushMs: 1e9 });
  log.write(Date.UTC(2026, 9, 24, 3, 59, 59), 0, '{"a":1}');
  log.write(Date.UTC(2026, 9, 24, 4, 0, 0), 0, '{"a":2}');
  await log.flush();
  log.enforceLimit(true);
  const left = fs.readdirSync(dir).sort();
  assert.ok(!left.includes("2026-10-24-01.jsonl.gz"));
  assert.ok(left.includes("2026-10-24-04.jsonl.gz"));
  assert.ok(left.includes("2026-10-24-03.jsonl.gz"));
  log.close();
});

test("rotator: every coin × 5m/15m, current + next window; ended ones dropped after 60 s grace", async () => {
  let t = Date.UTC(2026, 9, 24, 7, 1, 0); // 07:01:00
  const asked = [];
  const r = new MarketRotator({
    coins: ["btc"],
    now: () => t,
    fetchMarket: async (slug) => (asked.push(slug), { conditionId: "0x" + slug, tokens: [{ outcome: "Up", assetId: slug + ":up" }, { outcome: "Down", assetId: slug + ":down" }], fd: { r: 0.07, e: 1, to: true } }),
  });
  const added = [];
  const removed = [];
  r.on("add", (m) => added.push(m.slug));
  r.on("remove", (m) => removed.push(m.slug));
  await r.tick();
  const s = (m, hh, mm) => `btc-updown-${m}m-${Date.UTC(2026, 9, 24, hh, mm) / 1000}`;
  assert.deepEqual(added.sort(), [s(5, 7, 0), s(5, 7, 5), s(15, 7, 0), s(15, 7, 15)].sort());
  t = Date.UTC(2026, 9, 24, 7, 5, 30); // 5m window 07:00 ended 30 s ago: still in grace
  await r.tick();
  assert.deepEqual(removed, []);
  assert.ok(added.includes(s(5, 7, 10)));
  t = Date.UTC(2026, 9, 24, 7, 6, 1);
  await r.tick();
  assert.deepEqual(removed, [s(5, 7, 0)]);
  const before = asked.length;
  await r.tick();
  assert.equal(asked.length, before, "known markets aren't fetched again");
});

test("rotator: a market Gamma doesn't list yet is retried later, not every tick", async () => {
  let t = Date.UTC(2026, 9, 24, 7, 1, 0);
  let calls = 0;
  const r = new MarketRotator({ coins: ["btc"], windows: [5], retrySec: 20, now: () => t, fetchMarket: async () => (calls++, null) });
  await r.tick();
  assert.equal(calls, 2);
  t += 5_000;
  await r.tick();
  assert.equal(calls, 2);
  t += 20_000;
  await r.tick();
  assert.equal(calls, 4);
});

test("instance lock: a live pid blocks, a dead pid's lock is taken over", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-lock-"));
  assert.equal(lock.acquire(dir).ok, true);
  lock.update(dir, { port: 3797 });
  assert.equal(lock.readLock(dir).port, 3797);
  // the same live pid written by "another" process: blocked
  fs.writeFileSync(path.join(dir, ".lock"), JSON.stringify({ pid: process.ppid, port: 1 }));
  const blocked = lock.acquire(dir);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.holder.port, 1);
  // a pid that has exited
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
  fs.writeFileSync(path.join(dir, ".lock"), JSON.stringify({ pid: Number(dead), port: 2 }));
  assert.equal(lock.acquire(dir).ok, true);
  assert.equal(lock.readLock(dir).pid, process.pid);
  lock.release(dir);
  assert.equal(fs.existsSync(path.join(dir, ".lock")), false);
});

test("feed env options", () => {
  assert.deepEqual(options({}), { disabled: false, coins: ["btc", "eth", "sol", "xrp", "doge"], conns: 8, rawLogMaxGB: 2 });
  const o = options({ BOTXRAY_NO_FEED: "1", BOTXRAY_FEED_COINS: "eth, BTC,nope", BOTXRAY_RAWLOG_MAX_GB: "0.5" });
  assert.deepEqual(o, { disabled: true, coins: ["eth", "btc"], conns: 8, rawLogMaxGB: 0.5 });
  assert.equal(options({ BOTXRAY_RAWLOG_MAX_GB: "0" }).rawLogMaxGB, 0);
});
