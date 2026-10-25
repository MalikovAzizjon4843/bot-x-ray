// Fill model: queue position, the double-count rule, cancels, unified YES/NO trades. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderBook } from "../lib/clob-ws.js";
import { FillModel, takerFee, roundToTick, sharesForUsd, sweep, MarkoutTracker } from "../lib/fill-model.js";

const Y = "1000"; // YES (lower id)
const N = "2000"; // NO
const FD = { r: 0.07, e: 1, to: true };

// A YES book with our level, its mirror on NO, and a fill model on top. Clock in ms, starting at 0.
function setup({ cancelMode = "pessimistic", crossFill = true, queue = 100, P = 0.52 } = {}) {
  let t = 0;
  const books = { [Y]: new OrderBook(Y), [N]: new OrderBook(N) };
  const fm = new FillModel({ book: (id) => books[id], complementOf: (id) => (id === Y ? N : id === N ? Y : null), cancelMode, crossFill, now: () => t });
  const fills = [];
  fm.on("fill", (f) => fills.push(f));
  const set = (id, side, price, size) => {
    const m = side === "bid" ? books[id].bids : books[id].asks;
    const prev = m.get(price) || 0;
    size > 0 ? m.set(price, size) : m.delete(price);
    return prev;
  };
  // a level change on a token, mirrored on the other one, as the feed would report it
  const level = (side, price, size, source = "price_change") => {
    const prevY = set(Y, side, price, size);
    const mside = side === "ask" ? "bid" : "ask";
    const mp = Math.round((1 - price) * 100) / 100;
    const prevN = set(N, mside, mp, size);
    fm.onLevel({ assetId: Y, side, price, newSize: size, prevSize: prevY, recvTs: t, source });
    fm.onLevel({ assetId: N, side: mside, price: mp, newSize: size, prevSize: prevN, recvTs: t, source });
  };
  level("bid", 0.5, 50);
  if (queue) level("ask", P, queue);
  level("ask", 0.55, 80);
  const trade = (assetId, price, size, side, dts = 0, txHash) => fm.onTrade({ assetId, price, size, side, ts: 1_000_000 + t + dts, recvTs: t, txHash });
  const at = (ms) => {
    t = ms;
    fm.tick(t);
  };
  const order = fm.place({ id: "o1", assetId: Y, side: "SELL", price: P, size: 30, placedAt: 0 });
  at(400); // active, queue taken from the level
  return { fm, books, fills, level, trade, at, order, get t() { return t; } };
}

const filled = (fills) => Math.round(fills.reduce((a, f) => a + f.qty, 0) * 1e6) / 1e6;

test("1. queue 100, trade 60 at our level → fill 0, queueAhead 40", () => {
  const s = setup();
  assert.equal(s.order.status, "active");
  assert.equal(s.order.queueAheadAtPlace, 100);
  s.at(500);
  s.trade(Y, 0.52, 60, "BUY");
  assert.equal(filled(s.fills), 0);
  assert.equal(s.order.queueAhead, 40);
});

test("2. then a trade of 70 → fill 30", () => {
  const s = setup();
  s.at(500);
  s.trade(Y, 0.52, 60, "BUY");
  s.at(600);
  s.trade(Y, 0.52, 70, "BUY");
  assert.equal(filled(s.fills), 30);
  assert.equal(s.fills[0].source, "trade_at_level");
  assert.equal(s.order.status, "filled");
});

test("3. cancel 50: pessimistic keeps queueAhead, proportional lowers it", () => {
  for (const [mode, want] of [["pessimistic", 100], ["proportional", 75]]) {
    const s = setup({ cancelMode: mode, queue: 100 });
    s.at(500);
    s.level("ask", 0.52, 200); // 100 more join behind us
    s.at(600);
    s.level("ask", 0.52, 150); // 50 cancelled somewhere in the level
    s.at(1000);
    // proportional: the cancel is spread over the level, our share ahead is 100/200 → 100 − 50 × ½
    assert.equal(s.order.queueAhead, want, mode);
  }
});

test("4. trade-through → filled at once", () => {
  const s = setup();
  s.at(500);
  s.trade(Y, 0.53, 5, "BUY");
  assert.equal(filled(s.fills), 30);
  assert.equal(s.fills[0].source, "trade_through");
  assert.equal(s.fills[0].price, 0.52, "a maker fills at its own price");
});

test("5. a trade inside the latency window is ignored", () => {
  const s = setup();
  const o2 = s.fm.place({ id: "o2", assetId: Y, side: "SELL", price: 0.52, size: 10, placedAt: 500 });
  s.at(600);
  s.trade(Y, 0.53, 50, "BUY"); // o2 isn't in the queue yet
  assert.equal(o2.status, "pending");
  assert.equal(o2.filled, 0);
  s.at(900);
  assert.equal(o2.status, "active");
});

test("6. a level decrease with no trade → no fill", () => {
  const s = setup();
  s.at(500);
  s.level("ask", 0.52, 10);
  s.at(1000);
  assert.equal(filled(s.fills), 0);
});

test("7. takerFee: p=0.5 → 0.0175 a share; p=0.9 → 0.0063", () => {
  assert.equal(+takerFee(1, 0.5, FD).toFixed(6), 0.0175);
  assert.equal(+takerFee(1, 0.9, FD).toFixed(6), 0.0063);
  assert.equal(+takerFee(20, 0.5, FD).toFixed(6), 0.35);
  assert.throws(() => takerFee(1, 0.5, null), /fee data/);
});

test("M1. level 100→40 (t=0), trade 60 (t=+50ms) → fill 0, queueAhead 40", () => {
  const s = setup();
  s.at(500);
  s.level("ask", 0.52, 40);
  s.at(550);
  s.trade(Y, 0.52, 60, "BUY");
  s.at(1000);
  assert.equal(filled(s.fills), 0);
  assert.equal(s.order.queueAhead, 40);
});

test("M2. same, trade 130 → fill 30", () => {
  const s = setup();
  s.at(500);
  s.level("ask", 0.52, 40);
  s.at(550);
  s.trade(Y, 0.52, 130, "BUY");
  assert.equal(filled(s.fills), 30);
});

test("M3. level 100→40, 400 ms without a trade → cancel 60", () => {
  const p = setup({ cancelMode: "pessimistic" });
  p.at(500);
  p.level("ask", 0.52, 40);
  p.at(700);
  assert.equal(p.order.queueAhead, 100, "still inside the match window");
  p.at(900);
  assert.equal(p.order.queueAhead, 40, "pessimistic: unchanged, then clamped to the level");
  const q = setup({ cancelMode: "proportional", queue: 100 });
  q.at(500);
  q.level("ask", 0.52, 40);
  q.at(900);
  assert.equal(q.order.queueAhead, 40, "proportional: 100 − 60 × 100/100");
  assert.equal(filled(p.fills) + filled(q.fills), 0);
});

test("M4. trade first, level after (+80 ms) → same as M1", () => {
  const s = setup();
  s.at(500);
  s.trade(Y, 0.52, 60, "BUY");
  s.at(580);
  s.level("ask", 0.52, 40);
  s.at(1000);
  assert.equal(filled(s.fills), 0);
  assert.equal(s.order.queueAhead, 40);
  assert.equal(s.fm.stats.cancelsQty, 0, "the decrease was the trade, not a cancel");
});

test("M5. bbo_heal sweep + trade-through → filled once, not twice", () => {
  const s = setup();
  s.at(500);
  s.trade(Y, 0.52, 100, "BUY");
  s.trade(Y, 0.55, 80, "BUY");
  s.level("ask", 0.52, 0, "bbo_heal");
  s.level("ask", 0.55, 0, "bbo_heal");
  s.at(1000);
  assert.equal(filled(s.fills), 30);
  assert.equal(s.order.status, "filled");
});

test("M6. queue 0, NO SELL 10 @ 1−P → our YES ask P fills 10", () => {
  const s = setup({ queue: 0 });
  assert.equal(s.order.queueAheadAtPlace, 0);
  s.at(500);
  s.trade(N, 0.48, 10, "SELL");
  assert.equal(filled(s.fills), 10);
  assert.equal(s.fills[0].source, "trade_at_level");
});

test("M7. one match as YES BUY 10 @ P and NO SELL 10 @ 1−P, 20 ms apart → fill 10, not 20", () => {
  const s = setup({ queue: 0 });
  s.at(500);
  s.trade(Y, 0.52, 10, "BUY", 0, "0xmatch");
  s.at(520);
  s.trade(N, 0.48, 10, "SELL", 0, "0xmatch");
  assert.equal(filled(s.fills), 10);
  assert.equal(s.fm.stats.duplicates, 1);
  // two real matches of the same size on the same token are not merged
  s.at(530);
  s.trade(Y, 0.52, 10, "BUY", 0, "0xnext");
  assert.equal(filled(s.fills), 20);
});

test("M8. one txHash, two sizes (10 and 5) → fill 15: one transaction can carry several maker matches", () => {
  const s = setup({ queue: 0 });
  s.at(500);
  s.trade(Y, 0.52, 10, "BUY", 0, "0xtx");
  s.at(510);
  s.trade(N, 0.48, 5, "SELL", 0, "0xtx");
  assert.equal(filled(s.fills), 15);
  assert.equal(s.fm.stats.duplicates, 0);
});

test("M9. reported side disagrees with the book → the level that went down decides, and we fill", () => {
  // our SELL YES ask 0.52 sits behind 5; the level (and its mirror NO bid 0.48) drops by 5, then the trade
  // arrives on NO marked BUY — taken literally that would be a YES SELL, which can't touch our ask
  const s = setup({ queue: 5 });
  s.at(500);
  s.level("ask", 0.52, 0);
  s.at(520);
  s.trade(N, 0.48, 10, "BUY");
  assert.equal(filled(s.fills), 5, "5 ahead of us, then 5 for us");
  assert.equal(s.fm.stats.sideOverridden, 1);
  // the same on YES itself: marked SELL at 0.52 while the ask went down
  const y = setup({ queue: 5 });
  y.at(500);
  y.level("ask", 0.52, 0);
  y.at(520);
  y.trade(Y, 0.52, 10, "SELL");
  assert.equal(filled(y.fills), 5);
  // nothing in the buffer → the reported side stands (a YES SELL doesn't touch our ask)
  const z = setup({ queue: 5 });
  z.at(500);
  z.trade(Y, 0.52, 10, "SELL");
  assert.equal(filled(z.fills), 0);
  assert.equal(z.fm.stats.sideOverridden, 0);
});

// A cancel shows up twice: YES ask P and its mirror NO bid 1−P, at the same moment.
function mirroredCancel(cancelMode) {
  const s = setup({ cancelMode, queue: 100 });
  s.at(500);
  s.level("ask", 0.52, 200); // 100 join behind us (mirrored too)
  s.at(1000);
  const before = s.fm.stats.cancelsQty;
  s.level("ask", 0.52, 150); // cancel 50: one event on YES ask 0.52, one on NO bid 0.48
  s.at(1400);
  return { s, cancels: s.fm.stats.cancelsQty - before };
}

test("M10. proportional: a cancel on YES ask P and NO bid 1−P at once lowers queueAhead once", () => {
  const { s, cancels } = mirroredCancel("proportional");
  assert.equal(s.order.queueAhead, 75, "100 − 50 × 100/200, once (twice would be 50)");
  assert.equal(cancels, 50);
});

test("M11. pessimistic: the same mirrored cancel leaves queueAhead alone, cancelsQty = 50", () => {
  const { s, cancels } = mirroredCancel("pessimistic");
  assert.equal(s.order.queueAhead, 100);
  assert.equal(cancels, 50);
});

test("look-alike YES/NO trades with different transaction hashes are two matches", () => {
  const s = setup({ queue: 0 });
  s.at(500);
  s.trade(Y, 0.52, 10, "BUY", 0, "0xa");
  s.at(520);
  s.trade(N, 0.48, 10, "SELL", 0, "0xb");
  assert.equal(filled(s.fills), 20);
  assert.equal(s.fm.stats.duplicates, 0);
});

test("BUY orders are symmetric: NO BUY at 1−P is a YES SELL at P", () => {
  const s = setup();
  const b = s.fm.place({ id: "b1", assetId: Y, side: "BUY", price: 0.5, size: 20, placedAt: 500 });
  s.at(900);
  assert.equal(b.queueAheadAtPlace, 50);
  s.trade(N, 0.5, 60, "BUY"); // NO BUY at 0.50 = YES SELL at 0.50
  assert.equal(b.filled, 10);
  s.at(950);
  s.trade(Y, 0.49, 1, "SELL"); // through our bid
  assert.equal(b.filled, 20);
  assert.equal(b.fills.at(-1).source, "trade_through");
});

test("cross: bid = our ask is cross_eq, bid > our ask is cross_through; crossFill all | through_only | off", () => {
  const run = (crossFill, bid) => {
    const s = setup({ crossFill });
    s.at(500);
    s.level("bid", bid, 30);
    return s;
  };
  assert.equal(run("all", 0.52).fills[0].source, "cross_eq");
  assert.equal(run("all", 0.53).fills[0].source, "cross_through");
  assert.equal(filled(run("through_only", 0.52).fills), 0);
  assert.equal(run("through_only", 0.53).fills[0].source, "cross_through");
  assert.equal(filled(run("off", 0.53).fills), 0);
  assert.equal(filled(run(true, 0.52).fills), 30, "true = all");
  assert.equal(filled(run(false, 0.53).fills), 0, "false = off");
});

test("cross diagnostics: both BBOs, crossed local book, a trade at our price within ±1 s, time since heal", () => {
  const s = setup();
  s.at(500);
  s.level("ask", 0.55, 0, "bbo_heal");
  s.at(700);
  s.trade(Y, 0.52, 1, "SELL"); // before the cross, at our price
  s.at(900);
  s.level("bid", 0.53, 30); // our ask 0.52 → cross_through
  const d = s.fills[0].diag;
  assert.equal(s.fills[0].source, "cross_through");
  assert.deepEqual(d.ownBbo, { bid: 0.53, bidSize: 30, ask: 0.52, askSize: 100 });
  assert.equal(d.crossedLocal, true, "bid 0.53 ≥ ask 0.52 on our own token");
  assert.equal(d.mirrorBbo.ask, 0.47);
  assert.equal(d.tradeBefore, true);
  assert.equal(d.tradeAfter, false);
  assert.equal(d.msSinceHeal, 400);
  s.at(1500);
  s.trade(Y, 0.52, 1, "BUY");
  assert.equal(d.tradeAfter, true, "filled in later, on the same object");
});

test("post-only: an order that would cross when it becomes active is rejected", () => {
  const s = setup();
  const o = s.fm.place({ id: "x", assetId: Y, side: "SELL", price: 0.5, size: 10, placedAt: 500 });
  s.at(900);
  assert.equal(o.status, "rejected");
});

test("a better price nobody quotes → queueAhead 0", () => {
  const s = setup();
  const o = s.fm.place({ id: "x", assetId: Y, side: "SELL", price: 0.51, size: 10, placedAt: 500 });
  s.at(900);
  assert.equal(o.queueAheadAtPlace, 0);
});

test("a resync decrease is a cancel, never a fill, even with a trade nearby", () => {
  const s = setup({ queue: 100 });
  s.at(500);
  s.level("ask", 0.52, 40, "resync");
  s.at(550);
  s.trade(Y, 0.52, 0.0001, "BUY"); // a trade at our level can't turn a resync decrease into a fill
  s.at(1000);
  assert.equal(filled(s.fills), 0);
  assert.equal(s.fm.stats.cancelsQty, 60, "60 on YES and its mirror on NO are one cancel");
  assert.equal(s.order.queueAhead, 40);
});

test("metrics: buffer size, event time, and the buffer empties once the window has passed", () => {
  const s = setup();
  s.at(500);
  s.level("ask", 0.52, 90);
  const m = s.fm.metrics();
  assert.equal(m.buffer.pending, 2, "the decrease and its mirror");
  assert.ok(m.eventUs.p99 >= 0);
  assert.ok(m.events > 0);
  s.at(900);
  assert.equal(s.fm.metrics().buffer.pending, 0);
  assert.equal(s.fm.metrics().buffer.pendingLevels, 0);
});

test("fills carry sideOverridden when the effective side decided them", () => {
  const s = setup({ queue: 5 });
  s.at(500);
  s.level("ask", 0.52, 0);
  s.at(520);
  s.trade(N, 0.48, 10, "BUY");
  assert.equal(s.fills.at(-1).sideOverridden, true);
  const t = setup({ queue: 0 });
  t.at(500);
  t.trade(Y, 0.52, 10, "BUY");
  assert.equal(t.fills.at(-1).sideOverridden, false);
});

test("helpers: roundToTick, sharesForUsd, sweep, markouts", () => {
  assert.equal(roundToTick(0.5049, 0.01, "SELL"), 0.51);
  assert.equal(roundToTick(0.5049, 0.01, "BUY"), 0.5);
  assert.equal(roundToTick(0.52, 0.01, "SELL"), 0.52);
  assert.equal(roundToTick(0.9612, 0.001, "SELL"), 0.962);
  assert.equal(sharesForUsd(10, 0.52), 19.23);
  assert.equal(sharesForUsd(1, 0.52), 5);
  const sw = sweep(new Map([[0.52, 10], [0.53, 20], [0.6, 100]]), 25, "BUY");
  assert.deepEqual(sw.levels, [[0.52, 10], [0.53, 15]]);
  assert.equal(+sw.avgPrice.toFixed(4), +((0.52 * 10 + 0.53 * 15) / 25).toFixed(4));
  const mk = new MarkoutTracker();
  mk.track({ id: "f", assetId: Y, side: "SELL", price: 0.52, at: 0 });
  assert.equal(mk.tick(5_000, () => 0.5).length, 0);
  const done = mk.tick(30_000, () => 0.55);
  assert.equal(+done[0].marks[5000].toFixed(4), 0.02);
  assert.equal(+done[0].marks[30000].toFixed(4), -0.03);
});
