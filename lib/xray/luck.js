// Skill or luck? Checks on a wallet's daily P&L: green days, the longest winning streak and its coin-flip
// odds, Sharpe, the chance a coin flip gives this many green days, and the probabilistic Sharpe ratio.
import { nice } from "./series.js";

export const UK_LOTTO_JACKPOT = 45057474; // 1 in 45,057,474 (59 balls, pick 6)
const LN10 = Math.log(10);

export const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
function logGamma(x) {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of c) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
const logChoose = (n, k) =>
  logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

// log10 of P(X >= k) for X ~ Binomial(n, 1/2): how likely a coin flip gives at least k green days out of n.
export function log10BinomTail(n, k) {
  if (k <= 0) return 0;
  let m = -Infinity;
  const terms = [];
  for (let i = k; i <= n; i++) {
    const t = logChoose(n, i) - n * Math.LN2;
    terms.push(t);
    if (t > m) m = t;
  }
  return (m + Math.log(terms.reduce((s, t) => s + Math.exp(t - m), 0))) / LN10;
}

// "1 in 2.6 × 10^33" from log10 of a probability (negative).
export function oneIn(log10p) {
  const e = -log10p;
  if (e < 6) return `1 in ${Math.round(10 ** e).toLocaleString("en-GB")}`;
  const k = Math.floor(e);
  return `1 in ${(10 ** (e - k)).toFixed(1)} × 10^${k}`;
}

// How many UK Lotto jackpots in a row are as unlikely as this.
export const lottoRuns = (log10p) => -log10p / Math.log10(UK_LOTTO_JACKPOT);

// Full days of the main run only (its biggest stretch of trading). The first and last day of a run are
// usually part days, because the bot started or stopped part way through them.
export function fullDays(series) {
  const m = series.main;
  const run = series.trading.filter(
    (d) => !m || (d.day >= m.start && d.day <= m.end),
  );
  return run.length >= 7 ? run.slice(1, -1) : run;
}

export function skillOrLuck(series) {
  const days = fullDays(series);
  const n = days.length;
  const pnl = days.map((d) => d.pnl);
  const green = pnl.filter((v) => v > 0).length;
  const mean = pnl.reduce((s, v) => s + v, 0) / (n || 1);
  const sd = Math.sqrt(
    pnl.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1),
  );
  const sharpeDaily = sd > 0 ? mean / sd : 0;
  const sharpe = sharpeDaily * Math.sqrt(365); // crypto markets trade every day
  const tStat = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;

  // Longest run of green days in a row (calendar days in a row, each with a trade and a profit).
  let best = { len: 0 },
    cur = null;
  for (const d of days) {
    const contiguous =
      cur && (Date.parse(d.day) - Date.parse(cur.to)) / 864e5 === 1;
    if (d.pnl > 0) {
      cur =
        contiguous && cur.green
          ? {
              ...cur,
              to: d.day,
              len: cur.len + 1,
              worst: Math.min(cur.worst, d.pnl),
            }
          : { from: d.day, to: d.day, len: 1, worst: d.pnl, green: true };
      if (cur.len > best.len) best = cur;
    } else cur = { to: d.day, green: false };
  }

  // Probabilistic Sharpe ratio: the chance the true Sharpe is above zero, allowing for skew and fat tails.
  const m3 =
    pnl.reduce((s, v) => s + (v - mean) ** 3, 0) / (n || 1) / (sd ** 3 || 1);
  const m4 =
    pnl.reduce((s, v) => s + (v - mean) ** 4, 0) / (n || 1) / (sd ** 4 || 1);
  const psrDen = Math.sqrt(
    Math.max(1e-9, 1 - m3 * sharpeDaily + ((m4 - 1) / 4) * sharpeDaily ** 2),
  );
  const psr = n > 2 ? Phi((sharpeDaily * Math.sqrt(n - 1)) / psrDen) : null;

  // Drawdown on the cumulative curve over the trading period.
  let peak = -Infinity,
    dd = 0,
    ddAt = null;
  for (const d of series.daily) {
    if (d.day < (days[0]?.day ?? "") || d.day > (days.at(-1)?.day ?? ""))
      continue;
    peak = Math.max(peak, d.cum);
    if (peak - d.cum > dd) {
      dd = peak - d.cum;
      ddAt = d.day;
    }
  }

  const all = series.trading;
  const worst = all.reduce(
    (a, b) => (b.pnl < (a?.pnl ?? Infinity) ? b : a),
    null,
  );
  const bestDay = all.reduce(
    (a, b) => (b.pnl > (a?.pnl ?? -Infinity) ? b : a),
    null,
  );
  const log10Green = n ? log10BinomTail(n, green) : 0;
  const log10Streak = -best.len * Math.log10(2);

  let verdict;
  if (n < 20) verdict = "Too few trading days to tell skill from luck.";
  else if (log10Green < -6 && tStat > 4)
    verdict = `A real edge. A coin flip gives ${green} green days out of ${n} about ${oneIn(log10Green).replace("1 in ", "once in ")} tries.`;
  else if (log10Green < -2 || tStat > 2.5)
    verdict = "Probably a real edge, but luck can't be ruled out.";
  else verdict = "Can't tell this apart from luck.";

  return {
    days: n,
    from: days[0]?.day ?? null,
    to: days.at(-1)?.day ?? null,
    green,
    red: n - green,
    greenShare: n ? green / n : null,
    streak: best.len
      ? {
          days: best.len,
          from: best.from,
          to: best.to,
          worstDay: best.worst,
          log10Odds: log10Streak,
          odds: oneIn(log10Streak),
          lotto: lottoRuns(log10Streak),
        }
      : null,
    meanDay: mean,
    sdDay: sd,
    sharpe,
    tStat,
    psr,
    log10GreenChance: log10Green,
    greenChance: oneIn(log10Green),
    maxDrawdown: dd,
    maxDrawdownDay: ddAt,
    worstDay: worst && { day: worst.day, pnl: worst.pnl },
    bestDay: bestDay && { day: bestDay.day, pnl: bestDay.pnl },
    verdict,
    note: days.length
      ? `Counts full trading days of its main run (${nice(days[0].day)} to ${nice(days.at(-1).day)}). The first and last day are left out because they are part days.`
      : "",
  };
}

// One word for a list: "edge" (luck can't explain it), "probably" (likely real), "luck" (a coin flip could do
// this) or "few" (too few days to tell). Same thresholds as the verdict.
export function edgeClass(l) {
  if (!l || l.days < 20) return "few";
  if (l.log10GreenChance < -6 && l.tStat > 4) return "edge";
  if (l.log10GreenChance < -2 || l.tStat > 2.5) return "probably";
  return "luck";
}
export const EDGE_LABEL = { edge: "Real edge", probably: "Probably real", luck: "Could be luck", few: "Too new to tell" };

export const lottoLine = (lotto) =>
  lotto >= 2
    ? `, rarer than winning the UK Lotto jackpot ${Math.floor(lotto)} times running`
    : lotto >= 1
      ? ", rarer than winning the UK Lotto jackpot"
      : "";
export const streakLine = (s) =>
  s.streak
    ? `${s.streak.days} green days in a row (${nice(s.streak.from)} to ${nice(s.streak.to)}). The chance of ${s.streak.days} heads in a row is ${s.streak.odds}${lottoLine(s.streak.lotto)}. Its worst day in that run was ${s.streak.worstDay >= 0 ? "+" : "−"}$${Math.round(Math.abs(s.streak.worstDay)).toLocaleString("en-GB")}.`
    : "";
