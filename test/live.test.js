// Live: x-ray the three wallets from the video over the network and check the numbers the video quotes.
//   node --test test/live.test.js       (needs internet; not part of the offline suite)
import { test } from "node:test";
import assert from "node:assert/strict";
import { xray } from "../lib/xray/index.js";

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const lag10 = (r, coin = "btc") =>
  r.behaviour.reaction?.[coin]?.byLag.find((g) => g.lag === 10);

test(
  "0x8dxd: speed bot, 79% of 1,484 buys on the side of a 10-second Binance move, +$5,748 in the sample hour",
  { timeout: 180000 },
  async () => {
    const r = await xray("0x8dxd");
    assert.equal(r.tag, "speed");
    assert.equal(r.behaviour.trades, 3697);
    assert.equal(r.behaviour.bothSides, 12);
    near(r.behaviour.settled.pnl, 5748, 5, "sample P&L");
    const g = lag10(r);
    assert.equal(g.buys, 1484);
    near(g.share, 0.79, 0.005, "follows Binance");
    near(r.behaviour.reaction.btc.edgeCents, 1.4, 0.05, "cents below fair");
    assert.equal(r.luck.green, 103);
    assert.equal(r.luck.days, 109);
    near(r.series.lifetime.pnl, 2.17e6, 10e3, "lifetime");
  },
);

test(
  "gabagool22: pair bot, 96–99¢ a pair, +1.9% in the sample hour, ignores Binance",
  { timeout: 180000 },
  async () => {
    const r = await xray("gabagool22");
    assert.equal(r.tag, "pair");
    assert.equal(Math.round(100 * r.behaviour.pair.lo), 96);
    assert.equal(Math.round(100 * r.behaviour.pair.hi), 99);
    near(r.behaviour.settled.ret, 0.019, 0.001, "sample return");
    near(lag10(r).share, 0.51, 0.01, "follows Binance");
    assert.equal(r.series.main.end, "2026-02-21");
  },
);

test(
  "coinman2: prices it like an option, 7,900 buys and 0 sells, both sides in 204 of 385 markets",
  { timeout: 300000 },
  async () => {
    const r = await xray("coinman2");
    assert.equal(r.tag, "options");
    assert.equal(r.behaviour.buys, 7900);
    assert.equal(r.behaviour.sells, 0);
    assert.equal(r.behaviour.bothSides, 204);
    assert.equal(r.behaviour.markets, 385);
    const b = Object.fromEntries(r.byPrice.map((x) => [x.key, x]));
    assert.ok(
      b["20-80"].pnl > 50e3 && b["80-95"].pnl > 30e3,
      "profit comes from 20–95¢",
    );
    assert.ok(b["<5"].pnl < 0 && b["5-20"].pnl < 0, "loses below 20¢");
    near(b["80-95"].won, 0.96, 0.01, "80–95¢ win rate");
    assert.equal(r.luck.worstDay.day, "2025-05-25");
  },
);
