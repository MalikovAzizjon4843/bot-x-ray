#!/usr/bin/env node
// Bot X-Ray as an MCP server, so your own Claude can reverse engineer any Polymarket wallet, read this month's
// leaderboard, run the live gap check and see the paper strategy. Stdio JSON-RPC 2.0, no dependencies. It runs
// the same code as the app in this process, so the app doesn't need to be open. It can't arm live trading.
//   claude mcp add --scope user bot-x-ray -- node /path/to/bot-x-ray/scripts/mcp.js
//   node scripts/mcp.js --help      prints that line for this folder
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { relaunchForProxy } from "../lib/proxy.js";
import { xray, toText } from "../lib/xray/index.js";
import { toText as convertText, TARGETS } from "../lib/convert.js";
import { usd, signed, pct, nice } from "../lib/xray/series.js";
import * as leaderboard from "../lib/leaderboard.js";
import * as live from "../lib/live.js";
import * as engine from "../lib/strategy/engine.js";
import * as brokers from "../lib/brokers/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
export const mcpCommand = (dir = ROOT) => {
  const file = path.join(dir, "scripts", "mcp.js");
  return `claude mcp add --scope user bot-x-ray -- node ${/\s/.test(file) ? `"${file}"` : file}`;
};

const closeStr = (t) =>
  new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export const TOOLS = {
  reverse_engineer_wallet: {
    title: "Reverse engineer a Polymarket wallet",
    description:
      "X-ray any Polymarket wallet or username from public data: what the bot actually does (markets, both sides, pair cost, sells, the Binance reaction test, P&L by price paid), its lifetime and monthly P&L with Polymarket's rule-change dates, skill or luck (green days, streak odds, Sharpe), and whether it still works (last 30/60/90 days against lifetime, fees against profit). Lead your answer with the verdict line. Takes a few seconds; a slow bot can take 30 seconds the first time.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: {
          type: "string",
          description:
            "A wallet address (0x…), a username like 0x8dxd or gabagool22, or a polymarket.com profile link",
        },
        sample: {
          type: "string",
          enum: ["auto", "recent"],
          description:
            "Which trades to read for 'what it does'. auto (default): for the three wallets in the video, the same sample as the video; otherwise its busiest recent stretch. recent: its latest trades.",
        },
      },
      required: ["wallet"],
    },
    async run(a) {
      return toText(
        await xray(a.wallet, {
          sample: a.sample === "recent" ? "recent" : "auto",
        }),
      );
    },
  },

  convert_to_broker: {
    title: "Convert a Polymarket bot into a strategy for a broker",
    description:
      "Every bot Bot X-Ray x-rays traded Polymarket's yes-or-no markets, which the user doesn't trade. This converts one into rules for markets a broker offers: options spreads, Kalshi, a crypto exchange, a stock broker or futures. For each it says whether it's built in (runs on paper in the app), whether Claude builds it (and gives the exact rules, the numbers from the wallet's own trades, what's lost in the conversion and the build prompt), or why it doesn't convert. When the user asks to build one, follow lib/strategy/custom/README.md in the bot-x-ray folder and keep it on paper.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: {
          type: "string",
          description: "A wallet address or username, e.g. coinman2",
        },
        target: {
          type: "string",
          enum: Object.keys(TARGETS),
          description:
            "Where the user trades: options, kalshi, crypto, stocks or futures. Leave out for the best fit.",
        },
      },
      required: ["wallet"],
    },
    async run(a) {
      return convertText(await xray(a.wallet), a.target);
    },
  },

  whos_winning: {
    title: "Who's winning Polymarket's crypto markets now",
    description:
      "The top crypto earners on Polymarket (this week, this month or all time), each tagged by strategy from its latest trades (speed trade, pair trade, resting orders, prices it like an option...) and checked for skill or luck on its daily P&L: green days, how often a coin flip would give that many, and a label (real edge, probably real, could be luck). Can filter to the ones that beat a coin flip and sort by least likely to be luck. Takes 20 to 60 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["WEEK", "MONTH", "ALL"],
          description: "Leaderboard period (default MONTH)",
        },
        top: {
          type: "number",
          enum: [15, 50],
          description: "How many wallets (default 15)",
        },
        show: {
          type: "string",
          enum: ["all", "better", "edge"],
          description:
            "all (default); better = beats a coin flip (probably real or real edge); edge = only edges luck can't explain",
        },
        sort: {
          type: "string",
          enum: ["pnl", "skill"],
          description: "pnl (default) or skill = least likely to be luck first",
        },
      },
    },
    async run(a) {
      const period = ["WEEK", "MONTH", "ALL"].includes(a.period)
        ? a.period
        : "MONTH";
      const s = await leaderboard.refresh({
        timePeriod: period,
        limit: Number(a.top) === 50 ? 50 : 15,
      });
      if (s.error) throw new Error(s.error);
      let rows = s.rows.filter((x) =>
        a.show === "edge"
          ? x.edge === "edge"
          : a.show === "better"
            ? ["edge", "probably"].includes(x.edge)
            : true,
      );
      if (a.sort === "skill")
        rows = [...rows].sort(
          (x, y) => (x.luck?.log10Chance ?? 0) - (y.luck?.log10Chance ?? 0),
        );
      const lines = [
        "| # | Wallet | P&L | Looks like | Skill or luck | Green days | A coin flip gets that | Buys after a Binance move, on its side | Fees % of traded | Profit per $ by month |",
        "|---|---|---|---|---|---|---|---|---|---|",
      ];
      for (const x of rows)
        lines.push(
          `| ${x.rank} | ${x.name} | ${signed(x.pnl)} | ${x.tagLabel} | ${x.edgeLabel} | ${x.luck ? `${x.luck.green} of ${x.luck.days}` : "–"} | ${x.luck ? x.luck.chance : "–"} | ${x.followsBinance == null ? "–" : pct(x.followsBinance, 0)} | ${pct(x.feeRate, 2)} | ${(x.trend || []).map((t) => `${t.month.slice(5)}: ${pct(t.perDollar)}`).join(", ")} |`,
        );
      const edges = s.rows.filter((x) => x.edge === "edge").length;
      const better = s.rows.filter((x) =>
        ["edge", "probably"].includes(x.edge),
      ).length;
      lines.push(
        "",
        `${edges} of ${s.rows.length} show an edge luck can't explain (a coin flip gives that many green days less than once in a million tries, and the average day is far from zero); ${better} beat a coin flip at least once in a hundred. Lots of green days can still hide big red ones: reverse_engineer_wallet gives the evidence for one wallet. Tags are a guess from a few hours of trades. Source: Polymarket's crypto leaderboard (${s.period}, by P&L), fetched ${s.finishedAt}.`,
      );
      if (!rows.length)
        lines.unshift(
          `No wallet in the top ${s.rows.length} passes that filter.`,
        );
      return lines.join("\n");
    },
  },

  live_gap_check: {
    title: "Live gap check (paper)",
    description:
      "Watch Bitcoin on Binance and Polymarket's current 15-minute Bitcoin Up or Down order book once a second, for 30 to 180 seconds. Reports whether Polymarket still trails Binance (correlation of moves 0 to 5 seconds later), the cheapest Up + Down pair after taker fees, how much more movement the market prices than a simple Binance model, and how often that simple model sees a 'bargain'. Nothing is sent to Polymarket.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: {
          type: "number",
          description: "How long to watch, 30 to 180 (default 60)",
        },
      },
    },
    async run(a) {
      const secs = Math.min(Math.max(Number(a.seconds) || 60, 30), 180);
      live.start({ minutes: secs / 60 });
      await new Promise((r) => setTimeout(r, secs * 1000 + 1500));
      live.stop();
      const st = live.state();
      const s = st.summary;
      if (!s?.seconds)
        throw new Error(
          `No live data came back${st.error ? `: ${st.error}` : ""}. Polymarket or Binance may be blocked on this connection.`,
        );
      return [
        `Watched ${s.seconds} seconds of ${st.window?.title ?? "the 15-minute Bitcoin market"}.`,
        `- Polymarket's move against Binance's, 0/1/2/3 seconds later: ${s.lag
          .slice(0, 4)
          .map((x) => (x.corr == null ? "–" : x.corr.toFixed(2)))
          .join(" / ")}. The biggest number shows the delay.`,
        `- Cheapest Up + Down: ${s.pair.minRaw ?? "–"} before fees, ${s.pair.minAfterFees ? s.pair.minAfterFees.toFixed(3) : "–"} after taker fees. Seconds under $1 after fees: ${s.pair.underOneAfterFees}.`,
        `- The market prices ${s.marketVolVsModel ? `${s.marketVolVsModel.toFixed(2)}×` : "–"} the movement a simple Binance model expects.`,
        `- That simple model saw a "bargain" after fees in ${pct(s.bargainShare.any, 0)} of seconds (more than 2¢ in ${pct(s.bargainShare.c2, 0)}). When it sees one nearly all the time, the model is wrong, not the market.`,
        `Paper "bargain" trades logged: ${s.paper.trades} (they settle when the market ends; the app shows the results).`,
        "Caveat: one short spot check at 1-second polling. Polymarket settles on Chainlink, not Binance.",
      ].join("\n");
    },
  },

  strategy_scan: {
    title: "Scan the paper strategy's markets now",
    description:
      "Run one scan of the strategy (coinman2's loop: price 'above K by this date' contracts from the live price and realised volatility, buy the side priced too low after fees, hold to the end) on Kalshi's Bitcoin and Ether price markets and the Bitcoin and Ether ETF option spreads. Lists what it would buy and why each market was skipped. This scan doesn't place paper trades; the running app does that.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const r = await engine.scan({ trade: false });
      const sig = r.ladders
        .flatMap((l) =>
          l.contracts.filter((c) => c.signal).map((c) => ({ l, c })),
        )
        .sort((a, b) => b.c.best.edge - a.c.best.edge);
      const lines = [
        `Scan at ${r.at}: ${r.ladders.length} markets, ${r.ladders.reduce((n, l) => n + l.contracts.length, 0)} contracts.`,
      ];
      for (const [coin, v] of Object.entries(r.vol))
        lines.push(
          `${coin.toUpperCase()} realised volatility ${pct(v.sigma, 0)} a year (2-day ${pct(v.twoDay, 0)}, 7-day ${pct(v.sevenDay, 0)}).`,
        );
      lines.push(...r.notes);
      lines.push(
        "",
        sig.length
          ? "| Contract | Where | Closes | Buy | Cost with fees | Model's fair price | Edge |"
          : "Nothing priced too low by the minimum edge right now.",
      );
      if (sig.length)
        lines.push(
          "|---|---|---|---|---|---|---|",
          ...sig
            .slice(0, 15)
            .map(
              ({ l, c }) =>
                `| ${c.label} | ${l.venue === "kalshi" ? "Kalshi" : "ETF options"} | ${closeStr(l.closes)} | ${c.best.side} | ${(100 * c.best.cost).toFixed(1)}¢ | ${(100 * c.best.fair).toFixed(1)}¢ | ${(100 * c.best.edge).toFixed(1)}¢ |`,
            ),
        );
      const skipped = r.ladders.filter((l) => !l.volOk);
      if (skipped.length)
        lines.push(
          "",
          `Skipped ${skipped.length} market(s) where the model's volatility disagreed with the market's by too much: ${skipped.map((l) => `${l.symbol || `Kalshi ${l.coin.toUpperCase()}`} ${closeStr(l.closes)} (${l.ratio ? `${l.ratio.toFixed(2)}×` : "unreadable"})`).join("; ")}.`,
        );
      lines.push("", "Paper only. Nothing here promises a profit.");
      return lines.join("\n");
    },
  },

  strategy_status: {
    title: "Paper strategy status",
    description:
      "What the paper strategy holds, what has settled and its paper P&L, the settings, and whether a broker is connected or armed. Read-only.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const st = engine.stats(),
        b = engine.book(),
        c = engine.config(),
        br = await brokers.status();
      const lines = [
        `Mode: ${br.armed ? `ARMED for live orders until ${br.armedUntil}` : "paper"}. Scanning ${c.running ? `every ${c.everyMinutes} minutes while the app is open` : "is paused"}. Markets: ${
          Object.entries(c.markets)
            .filter(([, v]) => v)
            .map(([k]) => (k === "kalshi" ? "Kalshi" : "ETF options"))
            .join(", ") || "none"
        }. $${c.stake} a trade, minimum edge ${Math.round(100 * c.minEdge)}¢, sides priced ${Math.round(100 * c.band[0])}–${Math.round(100 * c.band[1])}¢.`,
        `Open: ${st.open} (${usd(st.atRisk)} at risk). Settled: ${st.closed}, won ${st.won}, paper P&L ${signed(st.pnl)} on ${usd(st.staked)} (the model expected ${signed(st.expectedPnl)}).`,
        `Broker: ${br.note}`,
      ];
      if (b.open.length)
        lines.push(
          "",
          "Open positions:",
          ...b.open.map(
            (p) =>
              `- ${p.side} ${p.label}: paid ${(100 * p.cost).toFixed(1)}¢, fair then ${(100 * p.fair).toFixed(1)}¢, $${p.stake}, closes ${closeStr(p.closes)}`,
          ),
        );
      if (b.closed.length)
        lines.push(
          "",
          "Last settled:",
          ...b.closed
            .slice(-10)
            .reverse()
            .map(
              (p) =>
                `- ${p.side} ${p.label}: ${signed(p.pnl)} (${nice(p.settledAt.slice(0, 10))})`,
            ),
        );
      return lines.join("\n");
    },
  },
};

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export async function handle(msg) {
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(handle))).filter(Boolean);
    return out.length ? out : null;
  }
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string")
    return msg && "id" in msg
      ? fail(msg.id ?? null, -32600, "Invalid request")
      : null;
  const notification = !("id" in msg);
  const { id, method, params = {} } = msg;
  try {
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOLS.includes(params.protocolVersion)
            ? params.protocolVersion
            : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "bot-x-ray",
            title: "Bot X-Ray",
            version: VERSION,
          },
          instructions:
            "Bot X-Ray reverse engineers Polymarket trading bots from public data. For 'reverse engineer wallet X' or 'what does this bot do', call reverse_engineer_wallet and lead with its verdict line, then the evidence. The user can't trade on Polymarket: to turn a bot into something they can trade with their own broker, call convert_to_broker and say plainly which parts are built in and which you (Claude) write. Say where each number comes from. Past P&L of someone else's wallet is history, not a promise: never tell the user what they would make.",
        });
      case "ping":
        return notification ? null : ok(id, {});
      case "tools/list":
        return ok(id, {
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      case "tools/call": {
        const t = TOOLS[params.name];
        if (!t)
          return fail(
            id,
            -32602,
            `Unknown tool: ${params.name}. Tools: ${Object.keys(TOOLS).join(", ")}`,
          );
        try {
          return ok(id, {
            content: [
              { type: "text", text: await t.run(params.arguments || {}) },
            ],
          });
        } catch (e) {
          return ok(id, {
            content: [{ type: "text", text: e.message || String(e) }],
            isError: true,
          });
        }
      }
      default:
        return notification
          ? null
          : fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return notification
      ? null
      : fail(id, -32603, e.message || "Internal error");
  }
}

function serve() {
  // stdout carries the protocol only; anything a library prints goes to stderr.
  for (const k of ["log", "info", "debug", "warn"])
    console[k] = (...a) => console.error(...a);
  const write = (m) => m && process.stdout.write(`${JSON.stringify(m)}\n`);
  let pending = 0,
    closed = false;
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return write(
        fail(
          null,
          -32700,
          "Parse error: each message must be one line of JSON",
        ),
      );
    }
    pending++;
    try {
      write(await handle(msg));
    } finally {
      pending--;
      if (closed && !pending) process.exit(0);
    }
  });
  rl.on("close", () => {
    closed = true;
    if (!pending) process.exit(0);
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      `Bot X-Ray MCP server ${VERSION}: lets your own Claude reverse engineer Polymarket bots.\n\nConnect Claude Code (run this once):\n\n  ${mcpCommand()}\n\nThen ask Claude things like "Reverse engineer the Polymarket wallet 0x8dxd."\nOther MCP clients: run "node ${path.join(ROOT, "scripts", "mcp.js")}" over stdio.\nTools: ${Object.keys(TOOLS).join(", ")}.`,
    );
    process.exit(0);
  }
  const relaunched = relaunchForProxy();
  if (relaunched) process.exit(await relaunched);
  serve();
}
