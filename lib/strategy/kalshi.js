// Kalshi's Bitcoin and Ether price markets ("Bitcoin above $X at 5pm?"), read from Kalshi's public market data.
// Kalshi is a US-regulated exchange: who can open an account there is Kalshi's call (US residents, and some other
// countries; the UK isn't one). Reading prices needs no account. Bot X-Ray never places an order here itself.
import { getJSON } from "../net.js";

const API = "https://api.elections.kalshi.com/trade-api/v2";
export const SERIES = { btc: "KXBTCD", eth: "KXETHD" };
export const VENUE = {
  id: "kalshi",
  name: "Kalshi",
  who: "US residents and the other countries Kalshi accepts",
  settles: "CF Benchmarks real-time index, 60-second average before the close",
};

// Kalshi's taker fee for an order of n contracts at price p: 7% of n × p × (1 − p), rounded up to the cent.
export const fee = (p, n = 1) =>
  Math.ceil(0.07 * n * p * (1 - p) * 100 - 1e-9) / 100;
export const feePerContract = (p) => 0.07 * p * (1 - p);

const num = (v) =>
  v === undefined || v === null || v === "" ? null : Number(v);

// Open "above K" contracts closing between minMinutes and maxHours from now, grouped by close time.
export async function ladders(coin, { minMinutes = 30, maxHours = 30 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const j = await getJSON(
      `${API}/markets?series_ticker=${SERIES[coin]}&status=open&limit=1000&min_close_ts=${now + minMinutes * 60}&max_close_ts=${now + maxHours * 3600}${cursor ? `&cursor=${cursor}` : ""}`,
      { timeout: 20000 },
    );
    for (const m of j.markets || []) {
      if (m.strike_type !== "greater" || m.floor_strike === undefined) continue;
      out.push({
        venue: "kalshi",
        coin,
        ticker: m.ticker,
        event: m.event_ticker,
        title: m.title,
        K: Number(m.floor_strike),
        closes: Math.floor(Date.parse(m.close_time) / 1000),
        yesAsk: num(m.yes_ask_dollars),
        yesBid: num(m.yes_bid_dollars),
        noAsk: num(m.no_ask_dollars),
        noBid: num(m.no_bid_dollars),
        label: `${coin.toUpperCase()} above $${Math.round(Number(m.floor_strike)).toLocaleString("en-US")}`,
      });
    }
    cursor = j.cursor;
    if (!cursor || !(j.markets || []).length) break;
  }
  const by = new Map();
  for (const c of out) {
    const g = by.get(c.closes) || [];
    g.push(c);
    by.set(c.closes, g);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([closes, contracts]) => ({
      venue: "kalshi",
      coin,
      closes,
      contracts: contracts.sort((a, b) => a.K - b.K),
    }));
}

// "yes", "no" or null while it hasn't settled.
export async function result(ticker) {
  const j = await getJSON(`${API}/markets/${ticker}`, { timeout: 15000 });
  const m = j.market || j;
  return m.result === "yes" || m.result === "no" ? m.result : null;
}

export async function probe() {
  const s = Date.now();
  await getJSON(`${API}/markets?series_ticker=KXBTCD&status=open&limit=1`, {
    timeout: 8000,
    retries: 0,
  });
  return Date.now() - s;
}
