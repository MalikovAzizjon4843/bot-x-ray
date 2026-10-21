#!/usr/bin/env node
// Checks this machine can run Bot X-Ray and which public data sources it can reach from this connection.
// Exit code 0 = ready (Polymarket's data is reachable), 1 = something needs fixing.
import { getJSON } from "../lib/net.js";
import { probe as probePrices } from "../lib/prices.js";
import * as kalshi from "../lib/strategy/kalshi.js";
import * as options from "../lib/strategy/options.js";
import { relaunchForProxy, proxyNote } from "../lib/proxy.js";

const relaunched = relaunchForProxy();
if (relaunched) process.exit(await relaunched);

const major = Number(process.versions.node.split(".")[0]);
const lines = [
  `Node.js ${process.version} on ${process.platform} (${process.arch})  ${major >= 18 ? "OK" : "TOO OLD: install Node 18 or newer from https://nodejs.org"}`,
];
let ok = major >= 18;
if (proxyNote()) lines.push(proxyNote());

const t = async (name, fn) => {
  const s = Date.now();
  try {
    await fn();
    return [name, { ok: true, ms: Date.now() - s }];
  } catch (e) {
    return [name, { ok: false, error: e.message }];
  }
};
const res = Object.fromEntries([
  ...(await Promise.all([
    t("Polymarket trades and P&L (data-api)", () =>
      getJSON(
        "https://data-api.polymarket.com/v1/leaderboard?category=CRYPTO&timePeriod=MONTH&limit=1",
        { timeout: 10000, retries: 1 },
      ),
    ),
    t("Polymarket markets (gamma-api)", () =>
      getJSON("https://gamma-api.polymarket.com/markets?limit=1", {
        timeout: 10000,
        retries: 1,
      }),
    ),
    t("Polymarket order book (clob)", () =>
      getJSON("https://clob.polymarket.com/time", {
        timeout: 10000,
        retries: 1,
      }).catch(async () =>
        getJSON("https://clob.polymarket.com/markets?limit=1", {
          timeout: 10000,
          retries: 0,
        }),
      ),
    ),
    t("Kalshi prices (strategy, US market)", () => kalshi.probe()),
    t("CBOE option quotes (strategy, ETF options)", () => options.probe()),
  ])),
  ...Object.entries(await probePrices()),
]);
for (const [name, r] of Object.entries(res))
  lines.push(
    `${r.ok ? "OK  " : "FAIL"}  ${name}${r.ok ? ` (${r.ms} ms)` : `: ${r.error}`}`,
  );

const pm =
  res["Polymarket trades and P&L (data-api)"].ok &&
  res["Polymarket markets (gamma-api)"].ok;
if (!pm) {
  ok = false;
  lines.push(
    "Polymarket's public data isn't reachable from here. Check your internet connection, VPN or firewall. Reading it needs no account and isn't blocked by country.",
  );
}
if (!res["Binance (1-second prices)"].ok)
  lines.push(
    "Binance isn't reachable from here (it blocks some countries, the US among them): the Binance reaction test and the live gap check need it. Everything else works.",
  );
if (!res["Polymarket order book (clob)"].ok)
  lines.push(
    "Polymarket's order book isn't reachable: the live gap check needs it. Everything else works.",
  );
if (
  !res["Kalshi prices (strategy, US market)"].ok &&
  !res["CBOE option quotes (strategy, ETF options)"].ok
)
  lines.push(
    "Neither strategy market is reachable, so the paper strategy will wait. The x-ray works.",
  );
else if (!res["Kalshi prices (strategy, US market)"].ok)
  lines.push("Kalshi isn't reachable: the strategy runs on ETF options only.");
else if (!res["CBOE option quotes (strategy, ETF options)"].ok)
  lines.push("CBOE isn't reachable: the strategy runs on Kalshi only.");

console.log(
  `\nBot X-Ray doctor\n${"-".repeat(40)}\n${lines.join("\n")}\n\n${ok ? "READY" : "NOT READY: fix the FAIL lines above"}\n`,
);
process.exit(ok ? 0 : 1);
