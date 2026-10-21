// The pricing model, fees, the vol guard and the paper book, without the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BOTXRAY_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bx-test-"));
const { probAbove, call, put, spreadAbove, fitVol } =
  await import("../lib/strategy/model.js");
const kalshi = await import("../lib/strategy/kalshi.js");
const options = await import("../lib/strategy/options.js");
const { priceLadder, DEFAULTS, config, setConfig } =
  await import("../lib/strategy/engine.js");
const { takerFee } = await import("../lib/polymarket.js");

const near = (a, b, tol, msg = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const DAY = 1 / 365;

test("digital price: 50/50 at the money, near 1 deep in, falls as the strike rises", () => {
  near(probAbove(100, 100, 0.5, DAY), 0.5, 0.01);
  assert.ok(probAbove(100, 80, 0.5, DAY) > 0.99);
  assert.ok(probAbove(100, 101, 0.5, DAY) < probAbove(100, 100.5, 0.5, DAY));
  assert.equal(probAbove(100, 90, 0.5, 0), 1);
});

test("call spread per $1 of width sits between 0 and 1, and put-call parity holds", () => {
  const v = spreadAbove(46.5, 46, 1, 0.4, 7 * DAY);
  assert.ok(v > 0 && v < 1);
  near(call(46.5, 46, 0.4, 7 * DAY) - put(46.5, 46, 0.4, 7 * DAY), 0.5, 1e-9);
});

test("fitVol recovers the volatility a ladder was priced with", () => {
  const pts = [95, 98, 100, 102, 105].map((K) => ({
    K,
    price: probAbove(100, K, 0.55, 2 * DAY),
  }));
  near(
    fitVol(pts, (c, s) => probAbove(100, c.K, s, 2 * DAY)),
    0.55,
    0.005,
  );
});

test("fees: Kalshi 7% of p(1−p) rounded up to the cent; Polymarket's crypto curve before and after 30 Mar 2026", () => {
  assert.equal(kalshi.fee(0.5, 100), 1.75);
  assert.equal(kalshi.fee(0.5, 1), 0.02);
  near(takerFee(0.5, Date.parse("2026-02-01") / 1000), 0.015625, 1e-9);
  near(takerFee(0.5, Date.parse("2026-04-01") / 1000), 0.0175, 1e-9);
  near(
    takerFee(0.1, Date.parse("2026-04-01") / 1000) / 0.1,
    0.063,
    1e-9,
    "6.3% of a 10¢ trade",
  );
});

test("option spread payout", () => {
  assert.equal(options.payout("yes", 46, 1, 48), 1);
  assert.equal(options.payout("yes", 46, 1, 46.5), 0.5);
  assert.equal(options.payout("no", 46, 1, 45), 1);
  assert.equal(options.payout("no", 46, 1, 47.2), 0);
});

const now = Date.now() / 1000;
const ladder = (sigmaMkt, quote) => ({
  venue: "kalshi",
  coin: "btc",
  closes: now + 6 * 3600,
  contracts: Array.from({ length: 21 }, (_, i) => 77500 + 250 * i).map((K) => {
    const p = probAbove(80000, K, sigmaMkt, 6 / 24 / 365);
    const q = quote(K, p);
    return {
      ticker: `T${K}`,
      K,
      label: `BTC above ${K}`,
      yesBid: q.yesBid,
      yesAsk: q.yesAsk,
      noAsk: q.noAsk,
      noBid: null,
    };
  }),
});

test("the strategy buys a side priced too low, inside the band", () => {
  const l = ladder(0.4, (K, p) =>
    K === 80250
      ? { yesBid: p - 0.08, yesAsk: p - 0.06, noAsk: 1 - p + 0.01 }
      : { yesBid: p - 0.01, yesAsk: p + 0.01, noAsk: 1 - p + 0.01 },
  );
  const r = priceLadder(l, { S: 80000, sigma: 0.4, now, cfg: DEFAULTS });
  assert.ok(r.volOk);
  const sig = r.contracts.filter((c) => c.signal);
  assert.equal(sig.length, 1);
  assert.equal(sig[0].K, 80250);
  assert.equal(sig[0].best.side, "yes");
});

test("the vol guard skips a market when the model's volatility is far from the market's (the trap)", () => {
  const l = ladder(0.8, (K, p) => ({
    yesBid: p - 0.01,
    yesAsk: p + 0.01,
    noAsk: 1 - p + 0.01,
  }));
  const r = priceLadder(l, { S: 80000, sigma: 0.3, now, cfg: DEFAULTS });
  assert.ok(!r.volOk);
  assert.equal(r.contracts.filter((c) => c.signal).length, 0);
  assert.ok(r.contracts.some((c) => /probably wrong/.test(c.why)));
});

test("settings: the screen can change paper settings, and unknown keys are ignored", () => {
  setConfig({ stake: 40, armed: true, running: false });
  const c = config();
  assert.equal(c.stake, 40);
  assert.equal(c.running, false);
  assert.equal(c.armed, undefined);
});
