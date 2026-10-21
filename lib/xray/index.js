// Reverse engineer a Polymarket wallet from public data: the P&L series, a sample of its trades, the markets'
// results and Binance's 1-second prices. Returns one report the screens, the CLI and the MCP all read.
import * as pm from "../polymarket.js";
import { convertAll } from "../convert.js";
import { seconds } from "../prices.js";
import {
  analyseSeries,
  stillWorking,
  nice,
  usd,
  signed,
  pct,
  day,
  DAY,
  RULE_CHANGES,
} from "./series.js";
import { skillOrLuck, streakLine } from "./luck.js";
import {
  marketsAndSides,
  byPricePaid,
  binanceReaction,
  priceWindows,
  KIND_LABEL,
} from "./behaviour.js";

// The sample windows used in the video, so the tool reproduces its numbers for these three wallets.
export const VIDEO_SAMPLES = {
  "0x63ce342161250d705dc0b16df89036c8e5f9ba9a": {
    name: "0x8dxd",
    start: "2026-02-10T14:00:00Z",
    end: "2026-02-10T15:00:00Z",
  },
  "0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d": {
    name: "gabagool22",
    start: "2025-12-10T14:00:00Z",
    end: "2025-12-10T15:00:00Z",
  },
  "0x55be7aa03ecfbe37aa5460db791205f7ac9ddca3": {
    name: "coinman2",
    start: "2026-03-01T00:00:00Z",
    end: "2026-04-21T00:00:00Z",
  },
};

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

// Which slice of trades to read. A busy bot makes thousands of trades an hour, a slow one a few a day, so the
// window stretches until it holds about 3,000 trades: an hour for a speed bot, a few weeks for a slow one.
export function pickSample(series, wallet, mode = "auto") {
  if (mode && typeof mode === "object")
    return { start: mode.start, end: mode.end, why: "the window you picked" };
  const preset = VIDEO_SAMPLES[wallet];
  if (preset && mode !== "recent")
    return {
      start: sec(preset.start),
      end: sec(preset.end),
      why: "the same sample as the video",
    };
  const tr = series.trading;
  if (!tr.length) return null;
  const pool =
    series.stopped && series.main
      ? tr
          .filter((d) => d.day >= series.main.start && d.day <= series.main.end)
          .slice(-30)
      : tr.slice(-7, -1).length
        ? tr.slice(-7, -1)
        : tr.slice(-1);
  const anchor = pool.reduce((a, b) => (b.trades > a.trades ? b : a), pool[0]);
  const perDay = Math.max(anchor.trades, 1);
  const hours = Math.min(Math.max((3000 / perDay) * 24, 1), 24 * 45);
  const dayStart = Date.parse(anchor.day + "T00:00:00Z") / 1000;
  if (hours <= 1)
    return {
      start: dayStart + 14 * 3600,
      end: dayStart + 15 * 3600,
      why: `one hour on its busiest recent day (${nice(anchor.day)})`,
    };
  const end = dayStart + DAY;
  return {
    start: Math.round(end - hours * 3600),
    end,
    why:
      hours <= 24
        ? `${Math.round(hours)} hours up to ${nice(anchor.day)}`
        : `${Math.round(hours / 24)} days up to ${nice(anchor.day)}`,
  };
}

// Strategy tag from what the trades show.
export function classify(b, series) {
  const share = (k) => b.kinds.find((x) => x.kind === k)?.share ?? 0;
  const ud = share("updown") + share("updown-other");
  const r = mainReaction(b.reaction);
  const r10 = r?.byLag.find((x) => x.lag === 10);
  // Fee rate over the last 30 days, for a wallet still trading. Before 30 Mar 2026 fees were tiny for everyone,
  // so a stopped bot's lifetime rate says nothing about how it traded.
  const recent = series.recent[0];
  const feeRate = !series.stopped && recent.volume > 0 ? recent.fees / recent.volume : null;
  if (!b.trades) return "quiet";
  if (ud >= 0.6) {
    // Taking liquidity costs about 2% of volume in fees now; under 0.8% means most of its fills are resting orders.
    if (feeRate !== null && feeRate < 0.008) return "maker";
    if (r10 && r10.buys >= 20 && r10.share >= 0.6) return "speed";
    if (b.bothShare >= 0.8 && b.pair && b.pair.median < 1 && (b.balance ?? 0) >= 0.85) return "pair";
    return "updown";
  }
  if (share("price-level") >= 0.5) return b.buys && b.sells / b.buys < 0.02 ? "options" : "levels";
  if (share("sports") >= 0.5) return "sports";
  return "other";
}

export const TAGS = {
  speed: "Speed trade",
  pair: "Pair trade",
  maker: "Resting orders",
  options: "Prices it like an option",
  updown: "Up or Down, mixed",
  levels: "Price levels, in and out",
  quiet: "No recent trades",
  sports: "Sports",
  other: "Other",
};

function mainReaction(reaction) {
  if (!reaction) return null;
  if (reaction.btc?.buys) return { coin: "btc", ...reaction.btc };
  const best = Object.entries(reaction).sort(
    (a, b) => b[1].buys - a[1].buys,
  )[0];
  return best ? { coin: best[0], ...best[1] } : null;
}
const COIN = { btc: "Bitcoin", eth: "Ether", sol: "Solana", xrp: "XRP" };

function statusTail(series) {
  const { stopped, main, comebacks, lastTrade } = series;
  if (stopped) {
    const cb = comebacks.at(-1);
    if (main && cb)
      return ` It stopped on ${nice(main.end)}, came back from ${nice(cb.start)} to ${nice(cb.end)}, ${cb.pnl >= 0 ? "made" : "lost"} ${usd(Math.abs(cb.pnl))} and stopped again.`;
    return ` It stopped on ${nice(main?.end ?? lastTrade)}.`;
  }
  const since = series.months.slice(-2);
  const tot = since.reduce((s, m) => s + m.pnl, 0);
  return ` It's still trading, and it's ${tot >= 0 ? "up" : "down"} ${usd(Math.abs(tot))} since 1 ${nice(since[0].month + "-01").slice(2)}.`;
}

export function verdictLine(r) {
  const { name, tag, series, behaviour: b } = r;
  const life = `It made ${usd(series.lifetime.pnl)} on ${usd(series.lifetime.volume)} traded (${pct(series.lifetime.perDollar)} a dollar).`;
  const rx = mainReaction(b.reaction);
  const r10 = rx?.byLag.find((x) => x.lag === 10);
  const best = [...(r.byPrice || [])].sort((x, y) => y.pnl - x.pnl)[0];
  switch (tag) {
    case "speed":
      return `${name} is a speed bot. It doesn't predict anything: after ${COIN[rx.coin]} moved on Binance in the previous 10 seconds, ${pct(r10.share, 0)} of its buys were on the side of the move, so it bought before Polymarket's price caught up. ${life}${statusTail(series)}`;
    case "pair":
      return `${name} is a pair bot. It bought Up and Down in near-equal amounts for ${Math.round(100 * b.pair.lo)}–${Math.round(100 * b.pair.hi)}¢ a pair, so one side always paid $1 and it kept the difference. It ignored Binance (${rx && r10?.share !== null ? `${pct(r10.share, 0)} of its buys followed a move, a coin flip` : "no link to Binance moves"}). ${life}${statusTail(series)}`;
    case "options":
      return `${name} prices "will the price be above K on this date" markets like options: it works out the real chance from the live price and how much it usually moves, buys the side priced too low and holds to the end (${b.sells} sells against ${b.buys.toLocaleString("en-GB")} buys). ${best ? `Most of its profit came from sides priced ${best.label}. ` : ""}${life}${statusTail(series)}`;
    case "maker":
      return `${name} mostly posts resting orders and earns rebates instead of chasing Binance (fees are a small share of what it trades). ${life}${statusTail(series)}`;
    case "updown":
      return `${name} trades the short crypto Up or Down markets, with no single clear trick in this sample. ${life}${statusTail(series)}`;
    default:
      return `${name} mostly trades ${b.kinds[0]?.label ?? "a mix of markets"}. ${life}${statusTail(series)}`;
  }
}

// What each rule change did: average day before and after, and whether it stopped soon after.
export function ruleEffects(series) {
  return RULE_CHANGES.filter(
    (c) =>
      series.first &&
      c.day >= series.first &&
      c.day <= (series.lastTrade ?? ""),
  ).map((c) => {
    const t = Date.parse(c.day);
    const near = (a, b) =>
      series.trading.filter(
        (d) =>
          Date.parse(d.day) >= t + a * 864e5 &&
          Date.parse(d.day) < t + b * 864e5,
      );
    const avg = (rows) =>
      rows.length ? rows.reduce((s, d) => s + d.pnl, 0) / rows.length : null;
    const stoppedWithin =
      series.main &&
      series.main.end >= c.day &&
      (Date.parse(series.main.end) - t) / 864e5 <= 7 &&
      series.stopped;
    return {
      ...c,
      before: avg(near(-14, 0)),
      after: avg(near(0, 14)),
      stoppedDaysAfter: stoppedWithin
        ? Math.round((Date.parse(series.main.end) - t) / 864e5)
        : null,
    };
  });
}

// The whole x-ray. progress(step, detail) is called as it goes, for the screens and the CLI.
export async function xray(
  input,
  { sample = "auto", progress = () => {}, now } = {},
) {
  progress("wallet", "Finding the wallet");
  const who = await pm.resolveWallet(input);
  progress("pnl", "Reading its daily P&L");
  const points = await pm.pnlSeries(who.wallet);
  const series = analyseSeries(points, now ? { now } : undefined);
  const luck = skillOrLuck(series);
  const win = pickSample(series, who.wallet, sample);
  let rows = [];
  if (win) {
    progress("activity", `Reading its trades (${win.why})`);
    rows = await pm.activity(who.wallet, win.start, win.end, {
      maxRows: 12000,
      onPage: (n) =>
        progress(
          "activity",
          `Reading its trades: ${n.toLocaleString("en-GB")} so far`,
        ),
    });
  }
  const slugs = [
    ...new Set(
      rows
        .filter((r) => r.type === "TRADE")
        .map((r) => r.slug)
        .filter(Boolean),
    ),
  ];
  progress("results", `Looking up how ${slugs.length} markets ended`);
  const winners = await pm.winners(
    slugs,
    (d, n) =>
      d % 25 === 0 && progress("results", `Market results: ${d} of ${n}`),
  );
  const behaviour = marketsAndSides(rows, winners);
  behaviour.resolved = Object.values(winners).filter(Boolean).length;
  const byPrice = byPricePaid(rows, winners);
  const need = priceWindows(rows);
  behaviour.reaction = null;
  if (Object.keys(need).length) {
    progress("binance", "Lining its buys up against Binance, second by second");
    const px = {};
    for (const [coin, w] of Object.entries(need)) {
      try {
        px[coin] = await seconds(coin, w.t0, w.t1);
      } catch (e) {
        behaviour.reactionError = `Binance prices weren't reachable (${e.message}), so the reaction test was skipped.`;
      }
    }
    if (Object.keys(px).length) {
      // A coin with under 20 buys after a move can't say anything, so it's left out.
      const rx = Object.entries(binanceReaction(rows, px)).filter(([, x]) => (x.byLag.find((g) => g.lag === 10)?.buys ?? 0) >= 20);
      behaviour.reaction = rx.length ? Object.fromEntries(rx) : null;
    }
  }
  if (!behaviour.reaction && !behaviour.reactionError) behaviour.reactionNote = "It barely trades the 5- and 15-minute markets, so the Binance reaction test doesn't apply.";
  const report = {
    wallet: who.wallet,
    name: who.name,
    leaderboard: who.leaderboard,
    generatedAt: new Date().toISOString(),
    series: { ...series, daily: undefined, trading: undefined },
    daily: series.trading.map((d) => [d.day, Math.round(d.pnl)]),
    luck,
    still: stillWorking(series),
    ruleEffects: ruleEffects(series),
    sample: win
      ? {
          start: new Date(win.start * 1000).toISOString(),
          end: new Date(win.end * 1000).toISOString(),
          why: win.why,
          rows: rows.length,
        }
      : null,
    behaviour,
    byPrice,
  };
  report.tag = classify(behaviour, series);
  report.tagLabel = TAGS[report.tag];
  report.verdict = verdictLine(report);
  report.convert = convertAll(report);
  progress("done", "Done");
  return report;
}

// Plain-text version for Claude and the terminal: the verdict first, then the evidence.
export function toText(r) {
  const s = r.series,
    l = r.luck,
    b = r.behaviour;
  const lines = [];
  lines.push(`# ${r.name} (${r.wallet})`, "", `**Verdict:** ${r.verdict}`, "");
  lines.push(`## Wallet`);
  lines.push(
    `Lifetime P&L ${usd(s.lifetime.pnl)} on ${usd(s.lifetime.volume)} traded, ${s.lifetime.trades.toLocaleString("en-GB")} trades. Fees paid ${usd(s.lifetime.fees)}; rebates and rewards ${usd(s.lifetime.income)}.${r.leaderboard ? ` Leaderboard P&L ${usd(r.leaderboard.pnl)} (rank ${r.leaderboard.rank?.toLocaleString("en-GB")}); it counts realised trades only.` : ""}`,
  );
  lines.push(
    `Active ${nice(s.first)} to ${nice(s.lastTrade ?? s.lastPoint)}${s.stopped ? ` (stopped, ${s.idleDays} days ago)` : " (still trading)"}.`,
  );
  lines.push(
    "",
    "| Month | P&L | Traded | Profit per $ | Fees |",
    "|---|---|---|---|---|",
  );
  for (const m of s.months.filter((m) => m.volume >= 1000))
    lines.push(
      `| ${m.month} | ${signed(m.pnl)} | ${usd(m.volume)} | ${pct(m.perDollar)} | ${usd(m.fees)} |`,
    );
  if (r.ruleEffects.length) {
    lines.push("", "Rule changes while it traded:");
    for (const e of r.ruleEffects)
      lines.push(
        `- ${nice(e.day)}, ${e.label}: average day ${e.before === null ? "–" : signed(e.before)} in the 2 weeks before, ${e.after === null ? "no trading" : signed(e.after)} after${e.stoppedDaysAfter !== null ? `. It stopped ${e.stoppedDaysAfter} days later` : ""}.`,
      );
  }
  lines.push(
    "",
    `## What it does (sample: ${r.sample ? `${r.sample.start.slice(0, 16).replace("T", " ")} to ${r.sample.end.slice(0, 16).replace("T", " ")} UTC, ${r.sample.why}` : "no trades found"})`,
  );
  if (b.trades) {
    lines.push(
      `${b.trades.toLocaleString("en-GB")} trades (${b.buys.toLocaleString("en-GB")} buys, ${b.sells.toLocaleString("en-GB")} sells, ${b.merges} merges) in ${b.markets} markets: ${b.kinds
        .slice(0, 3)
        .map((k) => `${pct(k.share, 0)} ${k.label}`)
        .join(", ")}.`,
    );
    lines.push(
      `Bought both sides in ${b.bothSides} of ${b.markets} markets${b.pair ? `; a pair cost it ${Math.round(100 * b.pair.lo)}–${Math.round(100 * b.pair.hi)}¢ (median ${Math.round(100 * b.pair.median)}¢), sides ${b.balance >= 0.85 ? "in near-equal amounts" : "in uneven amounts"}` : ""}.`,
    );
    lines.push(
      b.sells === 0
        ? `It never sold: every position was held to the end or merged back into $1.`
        : `Sold ${pct(b.sells / b.trades, 1)} of the time.`,
    );
    if (b.settled.markets)
      lines.push(
        `Markets in the sample that have settled (${b.settled.markets}): ${usd(b.settled.cost)} in, ${usd(b.settled.payout)} back (${signed(b.settled.pnl)}, ${pct(b.settled.ret)}).`,
      );
    const rx = b.reaction && Object.entries(b.reaction);
    if (rx?.length) {
      lines.push(
        "",
        "Binance reaction test (buys in 5- and 15-minute markets after a move over 0.03%):",
      );
      for (const [coin, x] of rx)
        lines.push(
          `- ${COIN[coin]}: ${x.byLag.map((g) => `last ${g.lag}s ${g.share === null ? "–" : pct(g.share, 0)} on the side of the move (${g.buys} buys)`).join("; ")}. Paid ${x.edgeCents === null ? "–" : `${Math.abs(x.edgeCents).toFixed(1)}¢ a share ${x.edgeCents >= 0 ? "below" : "above"}`} a fair price worked out from Binance.`,
        );
      lines.push(
        "Around 50% means it ignores Binance. Well above 50% after a 10-second move means it's trading the gap before Polymarket's price catches up.",
      );
    } else if (b.reactionError || b.reactionNote) lines.push(b.reactionError || b.reactionNote);
    if (r.byPrice.length) {
      lines.push(
        "",
        "| Price paid | Spent | Won | Avg price | P&L |",
        "|---|---|---|---|---|",
      );
      for (const x of r.byPrice)
        lines.push(
          `| ${x.label} | ${usd(x.spent)} | ${pct(x.won)} | ${Math.round(100 * x.avgPrice)}¢ | ${signed(x.pnl)} |`,
        );
    }
  }
  lines.push(
    "",
    "## Skill or luck",
    `${l.days} full trading days, ${l.green} green (${pct(l.greenShare, 0)}). A coin flip gives that many green days ${l.greenChance.replace("1 in", "once in")} tries. Sharpe ${l.sharpe.toFixed(1)} a year, t-stat ${l.tStat.toFixed(1)}, probabilistic Sharpe ${l.psr === null ? "–" : pct(l.psr, 2)}.`,
  );
  if (l.streak) lines.push(streakLine(l));
  lines.push(
    `Worst day ${l.worstDay ? `${signed(l.worstDay.pnl)} on ${nice(l.worstDay.day)}` : "–"}; biggest drop from a high ${usd(l.maxDrawdown)}.`,
    `**${l.verdict}**`,
    l.note,
  );
  lines.push("", "## Still working?", r.still);
  lines.push(
    "",
    "| Window | P&L | Traded | Profit per $ | Fees |",
    "|---|---|---|---|---|",
  );
  for (const w of s.recent)
    lines.push(
      `| Last ${w.days} days | ${signed(w.pnl)} | ${usd(w.volume)} | ${pct(w.perDollar)} | ${usd(w.fees)} |`,
    );
  lines.push(
    `| Lifetime | ${signed(s.lifetime.pnl)} | ${usd(s.lifetime.volume)} | ${pct(s.lifetime.perDollar)} | ${usd(s.lifetime.fees)} |`,
  );
  if (s.lifetime.feeShare !== null)
    lines.push(
      `Fees took ${pct(s.lifetime.feeShare, 0)} of what it made before fees.`,
    );
  lines.push(
    "",
    "Source: Polymarket's public data (data-api.polymarket.com, gamma-api.polymarket.com) and Binance 1-second prices. Past P&L of someone else's wallet says nothing about what you would make.",
  );
  return lines.filter((x) => x !== undefined).join("\n");
}

export { KIND_LABEL, day };
