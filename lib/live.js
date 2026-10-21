// The live gap monitor, in paper mode. Once a second it reads Bitcoin on Binance and the order book of
// Polymarket's current 15-minute "Bitcoin Up or Down" market, works out a fair price the simple way the X threads
// describe, and logs the "bargains" that model sees. Each bargain becomes a $10 paper trade, settled when the
// market ends, so you can watch whether the bargains were real. Nothing is ever sent to Polymarket.
import fs from "node:fs";
import path from "node:path";
import { DATA, getJSON } from "./net.js";
import * as pm from "./polymarket.js";
import { spot } from "./prices.js";
import { Phi } from "./xray/luck.js";

const WINDOW = 900;
const STAKE = 10;
const KEEP = 1200; // seconds kept in memory for the screen (20 minutes)

let S = null; // the running session

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const corr = (a, b) => {
  const n = a.length;
  if (n < 10) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n,
    mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
};
// Inverse of the normal CDF (Acklam), for reading the market's volatility back out of its price.
export function invPhi(p) {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771811, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pl) return -invPhi(1 - p);
  const q = p - 0.5,
    r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

async function binance1s(limit, startMs) {
  const q = `symbol=BTCUSDT&interval=1s&limit=${limit}${startMs ? `&startTime=${startMs}` : ""}`;
  for (const base of [
    "https://api.binance.com",
    "https://data-api.binance.vision",
  ]) {
    try {
      return await getJSON(`${base}/api/v3/klines?${q}`, {
        timeout: 8000,
        retries: 1,
      });
    } catch {
      /* next */
    }
  }
  return null;
}

async function openWindow(start) {
  const m = await pm.upDownMarket("btc", start, 15);
  const k = await binance1s(1, start * 1000);
  let open = k?.[0] ? Number(k[0][1]) : null;
  let approx = false;
  if (!open) {
    open = (await spot("btc", { prefer: "binance" })).price;
    approx = true;
  }
  const hist = await binance1s(1000);
  let sig = null;
  if (hist?.length > 10) {
    const c = hist.map((r) => Number(r[4]));
    const rets = c.slice(1).map((v, i) => Math.log(v / c[i]));
    const mu = rets.reduce((s, v) => s + v, 0) / rets.length;
    sig = Math.sqrt(rets.reduce((s, v) => s + (v - mu) ** 2, 0) / rets.length);
  }
  return {
    start,
    slug: m.slug,
    title: m.title,
    tokens: m.tokens,
    open,
    openApprox: approx,
    sig: sig || 1.5e-4,
  };
}

async function tick() {
  const now = Date.now() / 1000;
  const start = Math.floor(now / WINDOW) * WINDOW;
  if (!S.win || S.win.start !== start) {
    S.win = await openWindow(start);
    S.windows.push({
      start,
      slug: S.win.slug,
      title: S.win.title,
      open: S.win.open,
    });
  }
  const w = S.win;
  const [px, up, down] = await Promise.all([
    spot("btc", { prefer: "binance" }),
    pm.book(w.tokens.Up),
    pm.book(w.tokens.Down),
  ]);
  const left = Math.max(start + WINDOW - now, 1);
  const fairUp = Phi(Math.log(px.price / w.open) / (w.sig * Math.sqrt(left)));
  const fee = (p) => pm.takerFee(p, now);
  const side = (b, fair) => ({
    ask: b.ask,
    bid: b.bid,
    gap: b.ask !== null ? fair - b.ask - fee(b.ask) : null,
  });
  const row = {
    t: Math.round(now * 100) / 100,
    start,
    left: Math.round(left),
    btc: px.price,
    src: px.source,
    fairUp: Math.round(fairUp * 1e4) / 1e4,
    Up: side(up, fairUp),
    Down: side(down, 1 - fairUp),
  };
  if (up.ask !== null && down.ask !== null)
    row.pair = up.ask + down.ask + fee(up.ask) + fee(down.ask);
  S.rows.push(row);
  if (S.rows.length > KEEP) S.rows.shift();
  S.count++;
  S.agg.push(row);
  try {
    fs.appendFileSync(S.file, JSON.stringify(row) + "\n");
  } catch {
    /* a read-only folder still shows the screen */
  }

  // The naive model's "bargains", as $10 paper trades: at most one per side a minute.
  for (const o of ["Up", "Down"]) {
    const s = row[o];
    if (
      s.gap === null ||
      s.gap <= 0.02 ||
      s.ask < 0.05 ||
      s.ask > 0.95 ||
      left < 30
    )
      continue;
    const lastBuy = S.paper
      .filter((p) => p.start === start && p.side === o)
      .at(-1);
    if (lastBuy && now - lastBuy.t < 60) continue;
    S.paper.push({
      t: now,
      start,
      slug: w.slug,
      side: o,
      price: s.ask,
      fee: fee(s.ask),
      fair: o === "Up" ? fairUp : 1 - fairUp,
      shares: STAKE / (s.ask + fee(s.ask)),
      stake: STAKE,
      result: null,
    });
  }
}

// Settle paper trades once Polymarket has a result (usually a few minutes after the window ends).
async function settle() {
  const open = [
    ...new Set(
      S.paper
        .filter(
          (p) => p.result === null && p.start + WINDOW < Date.now() / 1000 - 30,
        )
        .map((p) => p.slug),
    ),
  ];
  for (const slug of open) {
    const r = await pm.endedWinner(slug).catch(() => null);
    if (!r) continue;
    for (const p of S.paper.filter((x) => x.slug === slug)) {
      p.result = p.side === r.winner ? "won" : "lost";
      p.pnl = p.side === r.winner ? p.shares - p.stake : -p.stake;
      p.final = r.final;
    }
  }
}

export function summary(rows = S?.agg ?? []) {
  const mid = rows.filter(
    (r) =>
      r.left > 30 &&
      r.Up.ask &&
      r.Down.ask &&
      r.Up.ask > 0.05 &&
      r.Up.ask < 0.95 &&
      r.Down.ask > 0.05 &&
      r.Down.ask < 0.95,
  );
  const gaps = mid.map((r) => Math.max(r.Up.gap, r.Down.gap));
  const pairs = rows.filter((r) => r.pair).map((r) => r.pair);
  const raw = rows
    .filter((r) => r.Up.ask && r.Down.ask)
    .map((r) => r.Up.ask + r.Down.ask);
  // How many seconds Polymarket's price trails Binance: correlation of 1-second changes at each lag (live_lag.py).
  const seq = rows
    .filter((r) => r.Up.ask && r.Up.bid && r.left > 30)
    .map((r) => ({
      t: Math.round(r.t),
      f: r.fairUp,
      m: (r.Up.ask + r.Up.bid) / 2,
      s: r.start,
    }));
  const lag = [];
  for (let k = 0; k <= 5; k++) {
    const a = [],
      b = [];
    for (let i = 1; i + k < seq.length; i++) {
      if (
        seq[i].s !== seq[i - 1].s ||
        seq[i + k].s !== seq[i].s ||
        seq[i + k].t - seq[i].t !== k
      )
        continue;
      a.push(seq[i].f - seq[i - 1].f);
      b.push(seq[i + k].m - (seq[i + k - 1] ?? seq[i]).m);
    }
    lag.push({ seconds: k, corr: corr(a, b), n: a.length });
  }
  // How much movement the market prices, against the model's volatility.
  const ratio = [];
  for (const r of rows) {
    if (!(r.Up.ask && r.Up.bid) || r.left <= 30) continue;
    const m = (r.Up.ask + r.Up.bid) / 2;
    if (m > 0.1 && m < 0.9 && r.fairUp > 0.02 && r.fairUp < 0.98) {
      const zm = invPhi(m),
        zf = invPhi(r.fairUp);
      if (Math.abs(zm) > 0.1 && zf * zm > 0) ratio.push(zf / zm);
    }
  }
  const paper = S?.paper ?? [];
  const settled = paper.filter((p) => p.result);
  const share = (th) =>
    gaps.length ? gaps.filter((g) => g > th).length / gaps.length : null;
  return {
    seconds: rows.length,
    windows: new Set(rows.map((r) => r.start)).size,
    usable: mid.length,
    bargainShare: {
      any: share(0),
      c1: share(0.01),
      c2: share(0.02),
      c5: share(0.05),
    },
    pair: {
      minRaw: raw.length ? Math.min(...raw) : null,
      medianRaw: median(raw),
      minAfterFees: pairs.length ? Math.min(...pairs) : null,
      underOneAfterFees: pairs.filter((p) => p < 1).length,
    },
    lag,
    marketVolVsModel: median(ratio),
    paper: {
      trades: paper.length,
      settled: settled.length,
      won: settled.filter((p) => p.result === "won").length,
      pnl: settled.reduce((s, p) => s + p.pnl, 0),
      staked: settled.reduce((s, p) => s + p.stake, 0),
    },
  };
}

export function start({ minutes = 20 } = {}) {
  if (S?.running) {
    S.endsAt = Math.max(S.endsAt, Date.now() + minutes * 60e3);
    return state();
  }
  const dir = path.join(DATA, "live");
  fs.mkdirSync(dir, { recursive: true });
  S = {
    running: true,
    startedAt: Date.now(),
    endsAt: Date.now() + minutes * 60e3,
    rows: [],
    agg: [],
    count: 0,
    windows: [],
    paper: S?.paper ?? [],
    file: path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    error: null,
    errors: 0,
  };
  const session = S;
  (async () => {
    let lastSettle = 0;
    while (session.running && Date.now() < session.endsAt) {
      try {
        await tick();
        session.error = null;
      } catch (e) {
        session.error = e.message;
        session.errors++;
      }
      if (Date.now() - lastSettle > 20e3) {
        lastSettle = Date.now();
        settle().catch(() => {});
      }
      await new Promise((r) =>
        setTimeout(r, Math.max(50, 1000 - (Date.now() % 1000))),
      );
    }
    session.running = false;
    // Keep settling the last window's paper trades for a few minutes after the monitor stops.
    for (let i = 0; i < 10 && session.paper.some((p) => !p.result); i++) {
      await new Promise((r) => setTimeout(r, 30e3));
      await settle().catch(() => {});
    }
  })();
  return state();
}

export function stop() {
  if (S) S.running = false;
  return state();
}

export function state() {
  if (!S) return { running: false, rows: [], paper: [], summary: null };
  return {
    running: S.running,
    startedAt: S.startedAt,
    endsAt: S.endsAt,
    error: S.error,
    window: S.win
      ? {
          slug: S.win.slug,
          title: S.win.title,
          start: S.win.start,
          open: S.win.open,
          openApprox: S.win.openApprox,
          volPerSecondBps: S.win.sig * 1e4,
        }
      : null,
    rows: S.rows.slice(-300),
    paper: S.paper.slice(-50).reverse(),
    summary: summary(),
  };
}
