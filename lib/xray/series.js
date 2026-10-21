// What a wallet's daily P&L series says: the lifetime curve, months, fees, profit per dollar, when it traded,
// whether it stopped, and how the last 30/60/90 days compare with its lifetime.

export const DAY = 86400;
export const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const nice = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MON[m - 1]} ${y}`;
};
export const niceMonth = (m) =>
  `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// The dates Polymarket changed the rules for crypto markets (sources in README).
export const RULE_CHANGES = [
  {
    day: "2026-01-05",
    label: "Taker fees on 15-minute crypto markets",
    short: "fees added",
  },
  {
    day: "2026-02-18",
    label: "Half-second taker delay removed (around 18 Feb, no announcement)",
    short: "delay removed",
  },
  {
    day: "2026-03-30",
    label: "New crypto fee curve, fees on nearly every category",
    short: "fees raised",
  },
];

const MIN_DAY_VOLUME = 100; // a day with under $100 traded doesn't count as a trading day

// points: Polymarket's /v2/user-pnl daily points (cumulative). Each point's date is the day it closes.
export function analyseSeries(points, { now = Date.now() / 1000 } = {}) {
  const pts = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const val = (p) => ({
    pnl: Number(p.economic_pnl) || 0,
    tradePnl: Number(p.trade_pnl) || 0,
    fees: Math.abs(Number(p.fees_paid) || 0),
    income: Number(p.wallet_income) || 0,
    rebates: (Number(p.maker_rebate) || 0) + (Number(p.taker_rebate) || 0),
    volume: Number(p.volume_usdc) || 0,
    trades: Number(p.trade_count) || 0,
  });
  const daily = [];
  let prev = {
    pnl: 0,
    tradePnl: 0,
    fees: 0,
    income: 0,
    rebates: 0,
    volume: 0,
    trades: 0,
  };
  for (const p of pts) {
    const v = val(p);
    const d = day(p.timestamp);
    const row = {
      day: d,
      cum: v.pnl,
      pnl: v.pnl - prev.pnl,
      fees: v.fees - prev.fees,
      volume: v.volume - prev.volume,
      trades: v.trades - prev.trades,
      income: v.income - prev.income,
    };
    // Two points can land on the same date (the live point); keep the later one.
    if (daily.length && daily.at(-1).day === d) {
      const a = daily.pop();
      row.pnl += a.pnl;
      row.fees += a.fees;
      row.volume += a.volume;
      row.trades += a.trades;
      row.income += a.income;
    }
    daily.push(row);
    prev = v;
  }
  const last = val(pts.at(-1));
  const trading = daily.filter(
    (r) => r.trades > 0 && r.volume >= MIN_DAY_VOLUME,
  );

  // Months: differences of month-end values.
  const byMonth = new Map();
  for (const r of daily) {
    const m = r.day.slice(0, 7);
    const a = byMonth.get(m) || {
      month: m,
      pnl: 0,
      volume: 0,
      fees: 0,
      trades: 0,
      days: 0,
    };
    a.pnl += r.pnl;
    a.volume += r.volume;
    a.fees += r.fees;
    a.trades += r.trades;
    if (r.trades > 0 && r.volume >= MIN_DAY_VOLUME) a.days++;
    byMonth.set(m, a);
  }
  const months = [...byMonth.values()];
  const maxVol = Math.max(0, ...months.map((m) => m.volume));
  for (const m of months)
    m.perDollar =
      m.volume >= Math.max(0.005 * maxVol, 10000) ? m.pnl / m.volume : null;

  // Runs: stretches of trading days with no gap of 14 days or more.
  const runs = [];
  for (const r of trading) {
    const cur = runs.at(-1);
    if (cur && (Date.parse(r.day) - Date.parse(cur.end)) / 864e5 < 14) {
      cur.end = r.day;
      cur.days.push(r);
    } else runs.push({ start: r.day, end: r.day, days: [r] });
  }
  const cumBefore = (d) => {
    let c = 0;
    for (const r of daily) if (r.day < d) c = r.cum;
    return c;
  };
  for (const run of runs) {
    run.pnl = run.days.at(-1).cum - cumBefore(run.start);
    run.volume = run.days.reduce((s, r) => s + r.volume, 0);
    run.trades = run.days.reduce((s, r) => s + r.trades, 0);
    run.tradingDays = run.days.length;
  }
  const main = runs.reduce(
    (a, b) => (b.volume > (a?.volume ?? -1) ? b : a),
    null,
  );
  const lastTrade = trading.at(-1)?.day ?? null;
  const idle = lastTrade
    ? Math.floor((now - Date.parse(lastTrade) / 1000) / DAY)
    : null;
  const stopped = idle !== null && idle >= 14;
  const after = main ? runs.filter((r) => r.start > main.end) : [];

  const window = (n) => {
    const since = day(now - n * DAY);
    const rows = daily.filter((r) => r.day > since);
    const pnl = rows.reduce((s, r) => s + r.pnl, 0);
    const volume = rows.reduce((s, r) => s + r.volume, 0);
    const fees = rows.reduce((s, r) => s + r.fees, 0);
    const trades = rows.reduce((s, r) => s + r.trades, 0);
    return {
      days: n,
      since,
      pnl,
      volume,
      fees,
      trades,
      perDollar: volume > 0 ? pnl / volume : null,
    };
  };

  const lifetime = {
    pnl: last.pnl,
    tradePnl: last.tradePnl,
    fees: last.fees,
    income: last.income,
    rebates: last.rebates,
    volume: last.volume,
    trades: last.trades,
    perDollar: last.volume > 0 ? last.pnl / last.volume : null,
    feeShare: last.tradePnl > 0 ? last.fees / last.tradePnl : null, // share of the pre-fee profit that fees took
  };
  const recent = [30, 60, 90].map(window);
  const active = months.filter((m) => m.perDollar !== null);
  const trend = active
    .slice(-5)
    .map((m) => ({ month: m.month, perDollar: m.perDollar }));

  return {
    first: daily[0]?.day ?? null,
    lastPoint: daily.at(-1)?.day ?? null,
    lastTrade,
    idleDays: idle,
    stopped,
    lifetime,
    daily,
    trading,
    months,
    runs: runs.map(({ days, ...r }) => r),
    main: main && (({ days, ...r }) => r)(main),
    comebacks: after.map(({ days, ...r }) => r),
    recent,
    trend,
    curve: daily.map((r) => [r.day, Math.round(r.cum * 100) / 100]),
    ruleChanges: RULE_CHANGES.filter(
      (c) => daily.length && c.day >= daily[0].day && c.day <= daily.at(-1).day,
    ),
  };
}

// One line on whether it still works, from the series alone.
export function stillWorking(s) {
  const {
    lifetime,
    recent,
    trend,
    stopped,
    lastTrade,
    idleDays,
    main,
    comebacks,
  } = s;
  const r30 = recent[0];
  let status;
  if (stopped) {
    const cb = comebacks.at(-1);
    status = `Stopped. Its last trade was on ${nice(lastTrade)}, ${idleDays} days ago.`;
    if (main && cb)
      status = `Stopped on ${nice(main.end)}. It came back from ${nice(cb.start)} to ${nice(cb.end)}, ${cb.pnl >= 0 ? "made" : "lost"} ${usd(Math.abs(cb.pnl))} on ${usd(cb.volume)} traded, and stopped again.`;
    else if (main)
      status = `Stopped on ${nice(main.end)}, ${idleDays} days ago.`;
  } else {
    const pd = trend.map((t) => t.perDollar);
    let falling = 0;
    for (let i = pd.length - 1; i > 0 && pd[i] < pd[i - 1]; i--) falling++;
    status = `Still trading. Last 30 days: ${signed(r30.pnl)} on ${usd(r30.volume)} traded${r30.perDollar !== null ? ` (${pct(r30.perDollar)} a dollar, against ${pct(lifetime.perDollar)} lifetime)` : ""}.`;
    if (falling >= 2) {
      const tail = trend.slice(-(falling + 1));
      status += ` Its profit per dollar has fallen ${falling} months in a row: ${tail.map((t) => `${pct(t.perDollar)} in ${niceMonth(t.month).slice(0, 3)}`).join(" → ")}.`;
    }
  }
  return status;
}

export const usd = (v) => {
  const a = Math.abs(v) < 0.5 ? 0 : Math.abs(v);
  const s =
    a >= 1e6
      ? `$${(a / 1e6).toFixed(2)}M`
      : a >= 1e4
        ? `$${Math.round(a / 1e3)}k`
        : `$${Math.round(a).toLocaleString("en-GB")}`;
  return v < 0 && a > 0 ? `−${s}` : s;
};
export const signed = (v) => (v >= 0 ? `+${usd(v)}` : usd(v));
export const pct = (v, dp = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = Math.abs(100 * v).toFixed(dp);
  return `${v < 0 && Number(s) !== 0 ? "−" : ""}${s}%`;
};
