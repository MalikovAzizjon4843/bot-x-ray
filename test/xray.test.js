// The x-ray maths on the three wallets from the video, from their real P&L series (saved 15 Oct 2026).
// Expected numbers come from the video's research (FINDINGS.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyseSeries, stillWorking, usd, pct } from "../lib/xray/series.js";
import {
  skillOrLuck,
  log10BinomTail,
  oneIn,
  lottoRuns,
} from "../lib/xray/luck.js";
import {
  marketsAndSides,
  byPricePaid,
  binanceReaction,
  kindOf,
} from "../lib/xray/behaviour.js";
import { classify } from "../lib/xray/index.js";

const NOW = Date.parse("2026-10-15T22:00:00Z") / 1000;
const load = (n) =>
  analyseSeries(
    JSON.parse(
      fs.readFileSync(new URL(`./fixtures/pnl_${n}.json`, import.meta.url)),
    ),
    { now: NOW },
  );
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("0x8dxd: $2.17M on $90.8M, the four months, stopped 25 Mar, lost $1,468 on the August comeback", () => {
  const s = load("0x8dxd");
  near(s.lifetime.pnl, 2.17e6, 5e3, "lifetime");
  near(s.lifetime.volume, 90.8e6, 0.1e6, "volume");
  near(s.lifetime.fees, 322e3, 1e3, "fees");
  const m = Object.fromEntries(s.months.map((x) => [x.month, x.pnl]));
  near(m["2025-12"], 322e3, 1e3, "Dec");
  near(m["2026-01"], 536e3, 1e3, "Jan");
  near(m["2026-02"], 772e3, 1e3, "Feb");
  near(m["2026-03"], 503e3, 1e3, "Mar");
  assert.equal(s.main.start, "2025-12-05");
  assert.equal(s.main.end, "2026-03-25");
  assert.ok(s.stopped);
  const cb = s.comebacks.at(-1);
  assert.equal(cb.start, "2026-08-10");
  near(cb.pnl, -1468, 2, "comeback P&L");
  near(cb.volume, 567e3, 1e3, "comeback volume");
  assert.match(stillWorking(s), /Stopped on 25 Mar 2026.*lost \$1,468/);
});

test("0x8dxd: 103 of 109 full trading days green", () => {
  const l = skillOrLuck(load("0x8dxd"));
  assert.equal(l.days, 109);
  assert.equal(l.green, 103);
  assert.ok(l.verdict.startsWith("A real edge"));
});

test("gabagool22: $865k on $71.4M, green every full day, profit per dollar falling each month", () => {
  const s = load("gabagool22");
  near(s.lifetime.pnl, 865e3, 1e3, "lifetime");
  near(s.lifetime.volume, 71.4e6, 0.1e6, "volume");
  const pd = s.months
    .filter((m) => m.perDollar !== null)
    .map((m) => Math.round(1000 * m.perDollar) / 10);
  assert.deepEqual(pd, [2.1, 1.9, 1.6, 1.0, 0.8]);
  const l = skillOrLuck(s);
  assert.equal(l.green, l.days);
  // The research quotes 111 days (31 Oct to 18 Feb, before the rule change); the full run is two days longer.
  assert.equal(l.streak.days, 113);
  assert.equal(l.streak.from, "2025-10-31");
  assert.equal(l.worstDay.pnl < 0 && l.worstDay.day, "2026-02-21");
  assert.equal(oneIn(-111 * Math.log10(2)), "1 in 2.6 × 10^33");
  assert.equal(Math.floor(lottoRuns(-111 * Math.log10(2))), 4);
});

test("coinman2: $1.47M, worst day −$145,694 on 25 May 2025, down $40k since 1 Sep, still trading", () => {
  const s = load("coinman2");
  near(s.lifetime.pnl, 1.47e6, 5e3, "lifetime");
  near(s.lifetime.volume, 43.4e6, 0.1e6, "volume");
  assert.ok(!s.stopped);
  const l = skillOrLuck(s);
  assert.equal(l.worstDay.day, "2025-05-25");
  near(l.worstDay.pnl, -145694, 1, "worst day");
  const m = Object.fromEntries(s.months.map((x) => [x.month, x.pnl]));
  near(m["2026-09"] + m["2026-10"], -40e3, 1e3, "since 1 Sep");
  near(
    ["2025-11", "2025-12", "2026-01", "2026-02"].reduce((a, k) => a + m[k], 0),
    -322e3,
    1e3,
    "Nov to Feb",
  );
});

test("coin-flip maths", () => {
  near(log10BinomTail(10, 10), -10 * Math.log10(2), 1e-9, "all heads");
  near(log10BinomTail(2, 1), Math.log10(0.75), 1e-9, "at least one in two");
  assert.equal(log10BinomTail(5, 0), 0);
  assert.equal(usd(-1468), "−$1,468");
  assert.equal(usd(2171896), "$2.17M");
  assert.equal(pct(-0.0001), "0.0%");
});

const row = (o) => ({
  type: "TRADE",
  side: "BUY",
  size: 100,
  ...o,
  usdc: (o.price ?? 0.5) * (o.size ?? 100),
});

test("markets and sides: a pair bot that buys Up and Down for 98¢ and never sells", () => {
  const slug = "btc-updown-15m-1765375200";
  const rows = [
    row({ slug, cid: "a", outcome: "Up", price: 0.49 }),
    row({ slug, cid: "a", outcome: "Down", price: 0.49 }),
    row({
      slug: "eth-updown-15m-1765375200",
      cid: "b",
      outcome: "Up",
      price: 0.5,
    }),
    row({
      slug: "eth-updown-15m-1765375200",
      cid: "b",
      outcome: "Down",
      price: 0.48,
    }),
  ];
  const b = marketsAndSides(rows, {
    [slug]: "Up",
    "eth-updown-15m-1765375200": "Down",
  });
  assert.equal(b.bothSides, 2);
  assert.equal(b.sells, 0);
  near(b.pair.median, 0.98, 1e-9, "pair");
  near(b.settled.pnl, 200 - 196, 1e-9, "pair profit");
  assert.equal(kindOf({ slug }).kind, "updown");
  assert.equal(
    kindOf({
      title: "Will Ethereum be above $2,600 on October 14?",
      slug: "ethereum-above-2600-on-october-14",
    }).kind,
    "price-level",
  );
});

test("P&L by price paid", () => {
  const rows = [
    row({ slug: "m1", outcome: "Yes", price: 0.6 }),
    row({ slug: "m2", outcome: "Yes", price: 0.6 }),
    row({ slug: "m3", outcome: "Yes", price: 0.03 }),
  ];
  const t = byPricePaid(rows, { m1: "Yes", m2: "No", m3: "No" });
  const mid = t.find((x) => x.key === "20-80");
  assert.equal(mid.buys, 2);
  near(mid.won, 0.5, 1e-9, "won");
  near(mid.pnl, 100 - 120, 1e-9, "pnl");
  assert.equal(t.find((x) => x.key === "<5").won, 0);
});

test("Binance reaction test: a bot that buys the side Binance just moved toward scores 100%", () => {
  const start = 1770732000;
  const px = new Map();
  let p = 70000;
  for (let t = start - 1000; t < start + 900; t++) {
    p *= 1 + (Math.floor(t / 60) % 2 ? 1 : -1) * 0.0001; // alternating minute-long trends
    px.set(t, p);
  }
  const rows = [];
  for (let t = start + 30; t < start + 880; t += 7) {
    const up = px.get(t) > px.get(t - 10);
    rows.push(
      row({
        t,
        slug: `btc-updown-15m-${start}`,
        outcome: up ? "Up" : "Down",
        price: 0.5,
      }),
    );
  }
  const r = binanceReaction(rows, { btc: px });
  assert.equal(r.btc.byLag.find((g) => g.lag === 10).share, 1);
  const b = marketsAndSides(rows);
  b.reaction = r;
  assert.equal(
    classify(b, {
      recent: [{ volume: 0, fees: 0 }],
      stopped: true,
      lifetime: { rebates: 0 },
    }),
    "speed",
  );
});

test("edge labels for the leaderboard filter: 0x8dxd and gabagool22 a real edge, coinman2 probably real", async () => {
  const { edgeClass } = await import("../lib/xray/luck.js");
  assert.equal(edgeClass(skillOrLuck(load("0x8dxd"))), "edge");
  assert.equal(edgeClass(skillOrLuck(load("gabagool22"))), "edge");
  assert.equal(edgeClass(skillOrLuck(load("coinman2"))), "probably");
  assert.equal(edgeClass({ days: 5 }), "few");
});
