#!/usr/bin/env node
// Starts the app on a spare port, x-rays one real wallet through the API, checks the screens load, then stops it.
//   node scripts/smoke.js
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3990 + Math.floor(Math.random() * 9);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), BOTXRAY_NO_STRATEGY: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => {
  failed++;
  console.log(`FAIL  ${m}`);
};
const get = async (p) =>
  (await fetch(base + p, { signal: AbortSignal.timeout(20000) })).json();
const post = async (p, b) =>
  (
    await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bx": "1" },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(20000),
    })
  ).json();

try {
  let h = null;
  for (let i = 0; i < 40 && !h; i++) {
    await sleep(250);
    h = await get("/api/health").catch(() => null);
  }
  if (!h || h.app !== "bot-x-ray")
    throw new Error(`The app didn't start:\n${log}`);
  pass(`app starts (Bot X-Ray ${h.version})`);
  const page = await (await fetch(base + "/")).text();
  page.includes("Bot X-Ray")
    ? pass("screens load")
    : fail("the page didn't load");

  const { job } = await post("/api/xray", { wallet: "gabagool22" });
  let j = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    j = await get(`/api/xray/${job}`);
    if (j.done) break;
    await sleep(800);
  }
  if (!j?.done) fail("x-ray of gabagool22 didn't finish in 2 minutes");
  else if (j.error) fail(`x-ray of gabagool22: ${j.error.message}`);
  else {
    const r = j.report;
    r.series.lifetime.pnl > 800000
      ? pass(
          `x-ray reads gabagool22's P&L ($${Math.round(r.series.lifetime.pnl / 1000)}k)`,
        )
      : fail("gabagool22's P&L looks wrong");
    r.behaviour.trades > 1000
      ? pass(
          `x-ray reads its trades (${r.behaviour.trades.toLocaleString("en-GB")} in the sample)`,
        )
      : fail("no trades came back");
    r.tag === "pair"
      ? pass("x-ray tags it as a pair bot")
      : fail(`x-ray tagged it "${r.tag}", expected "pair"`);
    if (r.behaviour.reaction) pass("Binance reaction test ran");
    else
      console.log(
        `SKIP  Binance reaction test: ${r.behaviour.reactionError || "no Binance data"}`,
      );
  }
  const st = await get("/api/strategy");
  st.config && st.broker
    ? pass(`strategy screen loads (${st.broker.armed ? "ARMED" : "paper"})`)
    : fail("strategy screen didn't load");
} catch (e) {
  fail(e.message);
} finally {
  await post("/api/shutdown", {}).catch(() => child.kill());
  await sleep(300);
  child.kill();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nSmoke test passed");
process.exit(failed ? 1 : 0);
