#!/usr/bin/env node
// CPU of the feed alone, then the feed + every variant in data/variants.json, on the live feed:
//   node scripts/variants-bench.js [--seconds 120]
// Paper only, in a temporary folder; it doesn't touch data/ or a running server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { FeedPool } from "../lib/clob-ws.js";
import { MarketRotator } from "../lib/market-rotator.js";
import { Variants, DEFAULT_VARIANTS } from "../lib/mm-variants.js";

const i = process.argv.indexOf("--seconds");
const seconds = i > 0 ? Number(process.argv[i + 1]) : 120;
const half = (seconds * 1000) / 2;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-bench-"));
const pool = new FeedPool({ size: 8 });
const rotator = new MarketRotator({});
rotator.on("add", (m) => pool.add(m.tokens.map((t) => t.assetId)));
rotator.on("remove", (m) => pool.remove(m.tokens.map((t) => t.assetId)));
await rotator.tick();
rotator.start();
await new Promise((r) => setTimeout(r, 5_000)); // snapshots in

const measure = async (ms) => {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const c0 = process.cpuUsage();
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, ms));
  const c = process.cpuUsage(c0);
  h.disable();
  return { cpuPct: +(((c.user + c.system) / 1000 / (Date.now() - t0)) * 100).toFixed(1), lagP99Ms: +(h.percentile(99) / 1e6).toFixed(1), msgPerSec: pool.health().msgPerSec, rssMB: Math.round(process.memoryUsage().rss / 1e6) };
};

const feedOnly = await measure(half);
const vs = new Variants({ pool, markets: () => rotator.markets(), dataDir: dir, variants: DEFAULT_VARIANTS });
vs.startAll();
const withVariants = await measure(half);
const st = vs.status();
vs.stopAll();
console.log(JSON.stringify({ seconds, tokens: pool.where.size, feedOnly, withVariants: { ...withVariants, variants: st.variants.length, cycles: st.variants.map((v) => `${v.id}:${v.stats.cycles}`).join(" ") } }, null, 1));
pool.close();
rotator.stop();
process.exit(0);
