#!/usr/bin/env node
// Arm, disarm or stop live trading. Arming happens only here, in your own terminal, after you type the
// confirmation. It needs a connected broker adapter and live keys in .env, and it lasts 24 hours.
//   node scripts/arm.js            show the status, then arm if you confirm
//   node scripts/arm.js --disarm   back to paper
//   node scripts/arm.js --stop     disarm and block new orders until you arm again
import readline from "node:readline/promises";
import * as brokers from "../lib/brokers/index.js";
import * as engine from "../lib/strategy/engine.js";

const st = await brokers.status();
if (process.argv.includes("--disarm")) {
  brokers.disarm();
  console.log("Disarmed. Bot X-Ray is back on paper.");
  process.exit(0);
}
if (process.argv.includes("--stop")) {
  brokers.engageStop();
  console.log("Stopped. Disarmed, and no new orders until you arm again.");
  process.exit(0);
}
const c = engine.config();
console.log(`Broker: ${st.broker} (adapter: ${st.adapter})\nKeys found: ${st.keysFound ? `yes, marked ${st.keyMode || "with no BOTXRAY_KEY_MODE"}` : "no"}\nNow: ${st.armed ? `ARMED until ${st.armedUntil}` : "paper"}${st.stopped ? " (stop is on)" : ""}\n`);
if (!st.adapterLive) {
  console.log(st.note);
  process.exit(1);
}
if (process.argv.includes("--status")) process.exit(0);
console.log(`Arming lets Bot X-Ray send real limit orders to ${st.broker} for 24 hours, inside these limits:
  $${c.stake} a trade, at most $${c.maxOpen} at risk at once and $${c.maxPerClose} on one expiry,
  at most ${c.maxNewPerScan} new trades a scan, and no new trades after losing $${c.dailyLossStop} in a day.
Every trade can lose the whole amount paid. Nothing in Bot X-Ray promises a profit.\n`);
const want = `ARM ${st.adapter.toUpperCase()} FOR LIVE ORDERS`;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const typed = (await rl.question(`To arm, type exactly: ${want}\n> `)).trim();
rl.close();
try {
  const rec = await brokers.arm({ confirm: typed });
  console.log(`Armed until ${rec.expiresAt}. Stop any time with: node scripts/arm.js --stop`);
} catch (e) {
  console.log(`Not armed: ${e.message}`);
  process.exit(1);
}
