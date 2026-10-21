// The same question on listed options: "will the Bitcoin ETF (IBIT) close above K on this date?" is a call spread
// from K to the next strike up, and "below" is the matching put spread. Both are bought for a debit, so the most
// you can lose is what you paid. Quotes are CBOE's free 15-minute-delayed ones. Trading them needs an options
// account with a broker that offers US-listed options where you live.
import { getJSON } from "../net.js";

const CBOE = "https://cdn.cboe.com/api/global/delayed_quotes/options/";
export const UNDERLYINGS = { btc: "IBIT", eth: "ETHA" };
export const VENUE = {
  id: "options",
  name: "US-listed ETF options",
  who: "anyone whose broker offers US-listed options where they live",
  settles: "the ETF's closing price on expiry day",
};
export const COMMISSION = 0.65; // a typical per-contract commission; set your own in the strategy settings

const OCC = /^(.+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

export async function chain(coin) {
  const sym = UNDERLYINGS[coin];
  const j = await getJSON(`${CBOE}${sym}.json`, { timeout: 20000 });
  const d = j.data || {};
  const quotes = new Map();
  for (const o of d.options || []) {
    const m = String(o.option).match(OCC);
    if (!m || m[1] !== sym) continue; // skip adjusted contracts like ETHA1
    const expiry = `20${m[2]}-${m[3]}-${m[4]}`;
    const K = Number(m[6]) / 1000;
    const key = `${expiry}|${K}`;
    const q = quotes.get(key) || { expiry, K };
    q[m[5]] = {
      bid: Number(o.bid) || 0,
      ask: Number(o.ask) || 0,
      iv: Number(o.iv) || null,
      oi: Number(o.open_interest) || 0,
    };
    quotes.set(key, q);
  }
  // Delayed quotes are only live while the US market is open; outside that they're yesterday's.
  const stamp = Date.parse(String(j.timestamp).replace(" ", "T") + "Z");
  const lastTrade = Date.parse(
    String(d.last_trade_time) +
      (String(d.last_trade_time).endsWith("Z") ? "" : "-04:00"),
  );
  return {
    coin,
    symbol: sym,
    S: Number(d.current_price),
    close: Number(d.close),
    prevClose: Number(d.prev_day_close),
    lastTrade: d.last_trade_time,
    stamp: j.timestamp,
    open:
      Number.isFinite(stamp) &&
      Number.isFinite(lastTrade) &&
      stamp - lastTrade < 20 * 60e3,
    iv30: Number(d.iv30) / 100 || null,
    quotes: [...quotes.values()],
  };
}

// Expiry dates as ladders of one-strike-wide spreads within ±band of the price.
export function ladders(c, { minDays = 1, maxDays = 45, band = 0.12 } = {}) {
  const now = Date.now() / 1000;
  const byExp = new Map();
  for (const q of c.quotes) {
    if (!q.C || !q.P) continue;
    const closes = Math.floor(Date.parse(`${q.expiry}T20:00:00Z`) / 1000); // 4pm New York (EDT); within an hour in winter
    const days = (closes - now) / 86400;
    if (days < minDays || days > maxDays) continue;
    const g = byExp.get(q.expiry) || [];
    g.push({ ...q, closes });
    byExp.set(q.expiry, g);
  }
  const out = [];
  for (const [expiry, qs] of byExp) {
    qs.sort((a, b) => a.K - b.K);
    const contracts = [];
    for (let i = 0; i + 1 < qs.length; i++) {
      const lo = qs[i],
        hi = qs[i + 1];
      if (Math.abs(lo.K / c.S - 1) > band) continue;
      const w = hi.K - lo.K;
      if (!(w > 0) || !lo.C.ask || !hi.P.ask) continue;
      contracts.push({
        venue: "options",
        coin: c.coin,
        symbol: c.symbol,
        expiry,
        closes: lo.closes,
        K: lo.K,
        w,
        ticker: `${c.symbol} ${expiry} ${lo.K}/${hi.K}`,
        label: `${c.symbol} above $${lo.K} → $${hi.K} by ${expiry}`,
        // Per $1 of width: "yes" = buy the K call, sell the K+w call. "no" = buy the K+w put, sell the K put.
        yesAsk: (lo.C.ask - hi.C.bid) / w,
        yesBid: (lo.C.bid - hi.C.ask) / w,
        noAsk: (hi.P.ask - lo.P.bid) / w,
        noBid: (hi.P.bid - lo.P.ask) / w,
        legs: {
          yes: [
            `buy ${c.symbol} ${expiry} ${lo.K} call`,
            `sell ${c.symbol} ${expiry} ${hi.K} call`,
          ],
          no: [
            `buy ${c.symbol} ${expiry} ${hi.K} put`,
            `sell ${c.symbol} ${expiry} ${lo.K} put`,
          ],
        },
      });
    }
    if (contracts.length >= 3)
      out.push({
        venue: "options",
        coin: c.coin,
        symbol: c.symbol,
        expiry,
        closes: contracts[0].closes,
        S: c.S,
        contracts,
      });
  }
  return out.sort((a, b) => a.closes - b.closes);
}

// What a spread paid per $1 of width, from the ETF's close on expiry day.
export const payout = (side, K, w, close) =>
  side === "yes"
    ? Math.min(Math.max(close - K, 0), w) / w
    : Math.min(Math.max(K + w - close, 0), w) / w;

// The ETF's closing price on a date: CBOE's quote if it's that day (or the day after), otherwise Nasdaq's history.
export async function closeOn(coin, date) {
  const c = await chain(coin);
  if (String(c.lastTrade).startsWith(date) && !c.open) return c.close || c.S;
  try {
    const sym = UNDERLYINGS[coin];
    const j = await getJSON(
      `https://api.nasdaq.com/api/quote/${sym}/historical?assetclass=etf&fromdate=${date}&todate=${date}&limit=5`,
      {
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      },
    );
    const row = j?.data?.tradesTable?.rows?.[0];
    if (row && new Date(row.date).toISOString().slice(0, 10) === date)
      return Number(String(row.close).replace(/[$,]/g, ""));
  } catch {
    /* try again later */
  }
  return null;
}

export async function probe() {
  const s = Date.now();
  await getJSON(`${CBOE}IBIT.json`, { timeout: 10000, retries: 0 });
  return Date.now() - s;
}
