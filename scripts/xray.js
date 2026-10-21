#!/usr/bin/env node
// Reverse engineer a Polymarket wallet in the terminal.
//   node scripts/xray.js 0x8dxd            node scripts/xray.js gabagool22 --json
//   node scripts/xray.js <wallet> --recent  (sample its latest trades instead of the video's window)
import { relaunchForProxy } from "../lib/proxy.js";
import { xray, toText } from "../lib/xray/index.js";

const relaunched = relaunchForProxy();
if (relaunched) process.exit(await relaunched);

const args = process.argv.slice(2);
const who = args.find((a) => !a.startsWith("--"));
if (!who) {
  console.log(
    "Usage: node scripts/xray.js <wallet or username> [--json] [--recent]\nTry: node scripts/xray.js 0x8dxd",
  );
  process.exit(1);
}
try {
  const r = await xray(who, {
    sample: args.includes("--recent") ? "recent" : "auto",
    progress: (step, msg) => process.stderr.write(`  ${msg}\n`),
  });
  console.log(args.includes("--json") ? JSON.stringify(r, null, 1) : toText(r));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
