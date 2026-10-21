// Converting a Polymarket bot into a broker strategy, and the plug-in path Claude's conversions run through.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BOTXRAY_DATA = fs.mkdtempSync(
  path.join(os.tmpdir(), "bx-convert-"),
);
const { convert, convertAll, toText } = await import("../lib/convert.js");
const engine = await import("../lib/strategy/engine.js");

const report = (tag, extra = {}) => ({
  wallet: "0xabc",
  name: "testbot",
  tag,
  behaviour: {
    trades: 100,
    buys: 100,
    sells: 0,
    coins: [
      { coin: "btc", share: 0.8 },
      { coin: "eth", share: 0.2 },
    ],
    kinds: [{ kind: tag === "options" ? "price-level" : "updown" }],
    table: [],
    pair: { lo: 0.96, hi: 0.99 },
    balance: 0.99,
    reaction: {
      btc: {
        buys: 500,
        byLag: [
          { lag: 2, share: 0.54 },
          { lag: 10, share: 0.79 },
        ],
      },
    },
  },
  byPrice: [
    { key: "<5", pnl: -5 },
    { key: "20-80", pnl: 80 },
    { key: "80-95", pnl: 40 },
  ],
  series: { lifetime: { volume: 1000, fees: 5, perDollar: 0.024 } },
  ...extra,
});

test("price-it-like-an-option converts to options and Kalshi, built in; spot can't copy a yes-or-no payoff", () => {
  const v = convertAll(report("options"));
  assert.equal(v.targets.options.status, "built");
  assert.equal(v.targets.kalshi.status, "built");
  assert.equal(v.targets.crypto.status, "no");
  assert.equal(v.best, "options");
  assert.match(v.targets.options.rules.join(" "), /IBIT \(Bitcoin\) and ETHA \(Ether\)/);
  assert.deepEqual(v.evidence.priceBand, [0.2, 0.95]); // the buckets where its own trades made money
});

test("the speed trade converts through Claude, with the lag and threshold from its own trades", () => {
  const v = convert(report("speed"), "crypto");
  assert.equal(v.spec.status, "claude");
  assert.match(v.spec.rules.join(" "), /0\.03% in 10 seconds/);
  assert.match(v.prompt, /lib\/strategy\/custom\/README\.md/);
  assert.match(v.prompt, /Keep it on paper/);
  assert.equal(convert(report("speed"), "options").spec.status, "no");
});

test("the pair trade only converts on Kalshi", () => {
  const v = convertAll(report("pair"));
  assert.deepEqual(
    Object.entries(v.targets)
      .filter(([, t]) => t.status !== "no")
      .map(([k]) => k),
    ["kalshi"],
  );
});

test("the text says which conversions Claude writes", () => {
  const t = toText(report("speed"));
  assert.match(t, /Claude builds it/);
  assert.match(t, /converted by Claude from these rules/);
});

test("a plug-in in lib/strategy/custom is scanned, opens a paper position inside the limits, and settles", async () => {
  const dir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "lib",
    "strategy",
    "custom",
  );
  const file = path.join(dir, "zz-test-plugin.js");
  fs.writeFileSync(
    file,
    `export default { name: "zz-test", title: "Test plug-in", from: "testbot", target: "crypto",
    async scan({ now }) { return [{ ticker: "T1", label: "test", side: "yes", cost: 0.5, fair: 0.6, edge: 0.1, closes: now - 300 }, { ticker: "T2", label: "small edge", cost: 0.5, fair: 0.51, edge: 0.01, closes: now - 300 }]; },
    async settle(p) { return p.ticker === "T1" ? 1 : null; } };`,
  );
  try {
    engine.setConfig({ coins: [], running: true });
    const r = await engine.scan();
    const m = r.custom.find((x) => x.name === "zz-test");
    assert.ok(m && !m.error, m?.error);
    assert.equal(
      r.opened.length,
      1,
      "only the signal above the minimum edge opens",
    );
    assert.equal(r.opened[0].venue, "custom:zz-test");
    await engine.settle();
    const b = engine.book();
    assert.equal(b.closed.length, 1);
    assert.equal(b.closed[0].paid, 1);
    assert.equal(Math.round(b.closed[0].pnl), 25); // $25 at 50¢ pays $50
  } finally {
    fs.rmSync(file);
  }
});
