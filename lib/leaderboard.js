// Who's winning now: the top crypto earners on Polymarket for a period, each tagged by strategy from its last few
// hours of trades, with the skill-or-luck check on its daily P&L, its profit per dollar by month and its fees.
import * as pm from "./polymarket.js";
import { seconds } from "./prices.js";
import { pool } from "./net.js";
import { analyseSeries } from "./xray/series.js";
import { skillOrLuck, edgeClass, EDGE_LABEL } from "./xray/luck.js";
import {
  marketsAndSides,
  binanceReaction,
  priceWindows,
} from "./xray/behaviour.js";
import { classify, TAGS } from "./xray/index.js";

export const PERIODS = {
  WEEK: "This week",
  MONTH: "This month",
  ALL: "All time",
};
const runs = new Map(); // `${period}:${limit}` -> the run in flight or the last finished one

const keyOf = (timePeriod, limit) => `${timePeriod}:${limit}`;

export function state({ limit = 15, timePeriod = "MONTH" } = {}) {
  const r = runs.get(keyOf(timePeriod, limit));
  return r
    ? {
        ...r,
        promise: undefined,
        rows: [...r.rows].sort((a, b) => a.rank - b.rank),
      }
    : null;
}

// Starts a refresh (or returns the one in flight). Results fill in wallet by wallet; state() reads them.
export function refresh({ limit = 15, timePeriod = "MONTH" } = {}) {
  if (!PERIODS[timePeriod]) timePeriod = "MONTH";
  limit = Math.min(Math.max(Number(limit) || 15, 5), 50);
  const key = keyOf(timePeriod, limit);
  const cur = runs.get(key);
  if (cur && !cur.finishedAt) return cur.promise;
  const now = Math.floor(Date.now() / 1000);
  const run = {
    startedAt: new Date().toISOString(),
    timePeriod,
    period: PERIODS[timePeriod],
    limit,
    done: 0,
    total: limit,
    rows: [],
    status: "Reading the leaderboard",
    error: null,
    finishedAt: null,
  };
  runs.set(key, run);
  run.promise = (async () => {
    try {
      const top = await pm.leaderboard({
        category: "CRYPTO",
        timePeriod,
        limit,
      });
      run.total = top.length;
      run.status = "Reading each wallet's latest trades";
      const samples = await pool(top, 5, async (w) => {
        let rows = await pm
          .activity(w.wallet, now - 3 * 3600, now, { maxRows: 1500 })
          .catch(() => []);
        // Quiet in the last few hours: tag it from its latest 500 trades instead.
        if (!rows.length)
          rows = await pm
            .activity(w.wallet, now - 30 * 86400, now, { maxRows: 500 })
            .catch(() => []);
        return { w, rows };
      });
      // One Binance fetch per coin covers every wallet's sample.
      const need = {};
      for (const { rows } of samples)
        for (const [coin, win] of Object.entries(priceWindows(rows))) {
          const a = (need[coin] ||= { t0: Infinity, t1: -Infinity });
          a.t0 = Math.min(a.t0, win.t0);
          a.t1 = Math.max(a.t1, win.t1);
        }
      run.status = "Lining their buys up against Binance";
      const px = {};
      for (const [coin, win] of Object.entries(need))
        px[coin] = await seconds(
          coin,
          Math.max(win.t0, now - 4 * 3600),
          Math.min(win.t1, now),
        ).catch(() => null);
      const usable = Object.fromEntries(
        Object.entries(px).filter(([, m]) => m),
      );
      run.status = "Checking each wallet's daily P&L for skill or luck";
      await pool(samples, 5, async ({ w, rows }) => {
        const row = { ...w, tag: "other", tagLabel: TAGS.other };
        try {
          const series = analyseSeries(await pm.pnlSeries(w.wallet), { now });
          const b = marketsAndSides(rows);
          const rx = Object.keys(usable).length
            ? binanceReaction(rows, usable)
            : {};
          b.reaction = Object.fromEntries(
            Object.entries(rx).filter(
              ([, x]) => (x.byLag.find((g) => g.lag === 10)?.buys ?? 0) >= 20,
            ),
          );
          if (!Object.keys(b.reaction).length) b.reaction = null;
          row.tag = classify(b, series);
          row.tagLabel = TAGS[row.tag];
          const r10 =
            b.reaction &&
            (b.reaction.btc || Object.values(b.reaction)[0])?.byLag.find(
              (g) => g.lag === 10,
            );
          const l = skillOrLuck(series);
          const edge = edgeClass(l);
          Object.assign(row, {
            started: series.first,
            lifetimePnl: series.lifetime.pnl,
            lifetimeFees: series.lifetime.fees,
            feeRate: series.lifetime.volume
              ? series.lifetime.fees / series.lifetime.volume
              : null,
            feeShare: series.lifetime.feeShare,
            trend: series.trend.slice(-4),
            followsBinance: r10?.share ?? null,
            sampleTrades: b.trades,
            topKind: b.kinds[0]?.label ?? null,
            // Skill or luck, on the daily P&L of its main run.
            luck: {
              days: l.days,
              green: l.green,
              greenShare: l.greenShare,
              log10Chance: l.log10GreenChance,
              chance: l.greenChance,
              tStat: l.tStat,
              sharpe: l.sharpe,
              psr: l.psr,
              worstDay: l.worstDay,
            },
            edge,
            edgeLabel: EDGE_LABEL[edge],
          });
        } catch (e) {
          row.error = e.message;
          row.edge = "few";
          row.edgeLabel = EDGE_LABEL.few;
        }
        run.rows.push(row);
        run.done++;
      });
      run.status = "Done";
    } catch (e) {
      run.error = e.message;
      run.status = "Failed";
    } finally {
      run.finishedAt = new Date().toISOString();
    }
    return state({ limit, timePeriod });
  })();
  return run.promise;
}
