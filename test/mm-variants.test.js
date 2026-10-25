// Variants: N independent v2 engines on one fake feed; join vs penny quotes; stop off.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { OrderBook } from "../lib/clob-ws.js";
import { Variants, loadVariants, DEFAULT_VARIANTS } from "../lib/mm-variants.js";

const UP = "1000";
const DOWN = "2000";
const T0 = Date.UTC(2026, 9, 25, 10, 1, 0);

function feed() {
  let t = T0;
  const books = { [UP]: new OrderBook(UP), [DOWN]: new OrderBook(DOWN) };
  for (const b of Object.values(books)) {
    b.tickSize = 0.01;
    b.hasSnapshot = true;
  }
  const pool = new EventEmitter();
  pool.setMaxListeners(50);
  pool.book = (id) => books[id];
  pool.isStale = () => false;
  pool.setPriority = () => {};
  const start = Math.floor(T0 / 1000 / 900) * 900;
  const market = { slug: `btc-updown-15m-${start}`, coin: "btc", minutes: 15, start, end: start + 900, fd: { r: 0.07, e: 1, to: true }, minOrderSize: 5, tickSize: 0.01, tokens: [{ outcome: "Up", assetId: UP }, { outcome: "Down", assetId: DOWN }] };
  const set = (id, side, price, size) => {
    const m = side === "bid" ? books[id].bids : books[id].asks;
    const prev = m.get(price) || 0;
    size > 0 ? m.set(price, size) : m.delete(price);
    pool.emit("level", { assetId: id, side, price, newSize: size, prevSize: prev, recvTs: t, source: "price_change" });
  };
  const level = (side, price, size) => {
    set(UP, side, price, size);
    set(DOWN, side === "ask" ? "bid" : "ask", Math.round((1 - price) * 100) / 100, size);
  };
  return { pool, market, set, level, now: () => t, go: (ms) => (t = T0 + ms) };
}

test("data/variants.json is written with the 6 defaults the first time", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-var-"));
  const v = loadVariants(dir);
  assert.deepEqual(v.map((x) => x.id), ["V1", "V2", "V3", "V4", "V5", "V6"]);
  assert.ok(fs.existsSync(path.join(dir, "variants.json")));
  assert.equal(DEFAULT_VARIANTS[5].config.exitMode, "hold_to_resolution");
});

test("each variant: its own folder, $50, FillModel and config; penny vs join quotes; stop off", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-var-"));
  const f = feed();
  f.level("bid", 0.47, 200);
  f.level("ask", 0.52, 200);
  const vs = new Variants({ pool: f.pool, markets: () => [f.market], dataDir: dir, now: f.now, timers: false, variants: DEFAULT_VARIANTS });
  vs.startAll();
  vs.tick(f.now());
  const cy = (id) => [...vs.get(id).engine.cycles.values()][0];
  assert.deepEqual(cy("V1").legs.map((l) => l.price), [0.51, 0.52], "penny: one tick inside");
  assert.deepEqual(cy("V3").legs.map((l) => l.price), [0.52, 0.53], "join: at the best ask");
  assert.notEqual(vs.get("V1").engine.fm, vs.get("V3").engine.fm);
  assert.equal(vs.get("V1").engine.s.cash, 40);
  assert.equal(vs.get("V2").engine.config.crossFill, "through_only");
  assert.equal(vs.get("V4").engine.config.stopEnabled, false);
  assert.ok(fs.existsSync(path.join(dir, "variants", "V6", "mm-paper-v2.json")));
  // V1 (stop on) and V5 (stop off, both penny): fill Up, then Down's bid falls 3¢
  f.go(500);
  vs.tick(f.now());
  f.pool.emit("trade", { assetId: UP, price: 0.51, size: 10, side: "BUY", ts: f.now(), recvTs: f.now() });
  f.go(1000);
  f.set(DOWN, "bid", 0.48, 0);
  f.set(DOWN, "bid", 0.45, 300);
  f.go(6000);
  vs.tick(f.now());
  assert.equal(cy("V1").exit?.reason, "stop");
  assert.equal(cy("V5").exiting, false, "no stop");
  const st = vs.status();
  assert.equal(st.variants.length, 6);
  assert.equal(st.minCycles, 300);
  assert.equal(st.variants[0].enoughData, false);
  vs.stopAll();
});

test("variants.json wins over a variant's saved config; reset clears each one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-var-"));
  const f = feed();
  const defs = [{ id: "X", config: { quoteMode: "join", minSpreadCents: 4 } }];
  let vs = new Variants({ pool: f.pool, markets: () => [f.market], dataDir: dir, now: f.now, timers: false, variants: defs });
  assert.equal(vs.get("X").engine.config.minSpreadCents, 4);
  vs = new Variants({ pool: f.pool, markets: () => [f.market], dataDir: dir, now: f.now, timers: false, variants: [{ id: "X", config: { quoteMode: "join", minSpreadCents: 3 } }] });
  assert.equal(vs.get("X").engine.config.minSpreadCents, 3);
  assert.equal(vs.resetAll().variants[0].stats.cycles, 0);
});
