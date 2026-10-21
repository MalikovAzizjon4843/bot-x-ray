#!/usr/bin/env node
// Set the paper strategy up for where you live and how much paper money to use per trade.
//   node scripts/setup.js --country US             Kalshi and ETF options
//   node scripts/setup.js --country UK --stake 25  ETF options only (Kalshi doesn't take UK customers)
import * as engine from "../lib/strategy/engine.js";

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const country = String(arg("country") || "").trim().toUpperCase();
const stake = Number(arg("stake"));
const patch = {};
if (country) patch.markets = { kalshi: country === "US" || country === "USA", options: true };
if (stake > 0 && stake <= 1000) patch.stake = stake;
const c = engine.setConfig(patch);
const on = Object.entries(c.markets).filter(([, v]) => v).map(([k]) => (k === "kalshi" ? "Kalshi's Bitcoin and Ether price markets" : "Bitcoin and Ether ETF option spreads (IBIT, ETHA)"));
console.log(`Paper strategy set up${country ? ` for ${country}` : ""}:
  Markets:  ${on.join(" and ") || "none"}
  Stake:    $${c.stake} of paper money a trade, at most $${c.maxOpen} at risk at once
  Rules:    buy the side the model prices at least ${Math.round(100 * c.minEdge)}¢ too low after fees, only sides priced ${Math.round(100 * c.band[0])}–${Math.round(100 * c.band[1])}¢, hold to the end
It scans every ${c.everyMinutes} minutes while the app is open. Paper only until you connect a broker and arm it yourself.${country && country !== "US" && country !== "USA" ? "\nKalshi is left off: it takes US residents and some other countries. If yours is one, turn it on in the Strategy screen." : ""}`);
