// Crypto prices from public exchange APIs: Binance 1-second candles for the reaction test, live spot prices
// and recent candles for volatility. Binance blocks some countries (the US among them), so every call has a
// fallback: Binance's market-data mirror, then Coinbase, then Kraken.
import { getJSON, cached, pool } from "./net.js";

const BINANCE = ["https://api.binance.com", "https://data-api.binance.vision"];
const PAIR = { btc: "BTCUSDT", eth: "ETHUSDT", sol: "SOLUSDT", xrp: "XRPUSDT" };
const COINBASE = {
  btc: "BTC-USD",
  eth: "ETH-USD",
  sol: "SOL-USD",
  xrp: "XRP-USD",
};
const KRAKEN = { btc: "XBTUSD", eth: "ETHUSD", sol: "SOLUSD", xrp: "XRPUSD" };
export const COINS = Object.keys(PAIR);

async function binance(pathAndQuery, opts) {
  let last;
  for (const base of BINANCE) {
    try {
      return await getJSON(base + pathAndQuery, opts);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// Binance 1-second closes for [t0, t1] (unix seconds) as a Map second -> price. Past windows are cached for good.
export async function seconds(coin, t0, t1) {
  const sym = PAIR[coin];
  if (!sym) throw new Error(`No 1-second prices for ${coin}`);
  const ttl = t1 < Date.now() / 1000 - 120 ? Infinity : 0;
  const rows = await cached(`k1s:${sym}:${t0}:${t1}`, ttl, async () => {
    const starts = [];
    for (let s = t0; s <= t1; s += 1000) starts.push(s);
    const pages = await pool(starts, 4, (s) =>
      binance(`/api/v3/klines?symbol=${sym}&interval=1s&startTime=${s * 1000}&endTime=${Math.min(s + 999, t1) * 1000}&limit=1000`, { timeout: 30000 }),
    );
    return pages.flat().map((r) => [Math.floor(r[0] / 1000), Number(r[4])]);
  });
  return new Map(rows);
}

// Price at second t: that second's close, or the last one before it.
export function priceAt(map, t) {
  if (map.has(t)) return map.get(t);
  for (let s = t - 1; s > t - 120; s--) if (map.has(s)) return map.get(s);
  return null;
}

// Live spot price in US dollars. Kalshi settles on a dollar index, so Coinbase and Kraken come first for USD.
export async function spot(coin, { prefer = "usd" } = {}) {
  const tries = [
    async () => ({
      price: Number(
        (
          await getJSON(
            `https://api.exchange.coinbase.com/products/${COINBASE[coin]}/ticker`,
            { timeout: 5000, retries: 0 },
          )
        ).price,
      ),
      source: "Coinbase",
    }),
    async () => {
      const j = await getJSON(
        `https://api.kraken.com/0/public/Ticker?pair=${KRAKEN[coin]}`,
        { timeout: 5000, retries: 0 },
      );
      const v = Object.values(j.result || {})[0];
      return { price: Number(v?.c?.[0]), source: "Kraken" };
    },
    async () => ({
      price: Number(
        (
          await binance(`/api/v3/ticker/price?symbol=${PAIR[coin]}`, {
            timeout: 5000,
            retries: 0,
          })
        ).price,
      ),
      source: "Binance",
    }),
  ];
  if (prefer === "binance") tries.unshift(tries.pop());
  let last;
  for (const t of tries) {
    try {
      const r = await t();
      if (Number.isFinite(r.price) && r.price > 0) return r;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error(`No price for ${coin}`);
}

// Recent 5-minute closes, newest last: Binance, then Coinbase. Used for realised volatility.
export async function fiveMinute(coin, bars = 2016) {
  return cached(`k5m:${coin}:${bars}`, 4 * 60e3, async () => {
    try {
      const out = [];
      let end = Date.now();
      while (out.length < bars) {
        const k = await binance(
          `/api/v3/klines?symbol=${PAIR[coin]}&interval=5m&endTime=${end}&limit=1000`,
          { timeout: 20000 },
        );
        if (!k.length) break;
        out.unshift(...k.map((r) => [Math.floor(r[0] / 1000), Number(r[4])]));
        end = k[0][0] - 1;
        if (k.length < 1000) break;
      }
      return out.slice(-bars);
    } catch {
      const out = [];
      let end = Math.floor(Date.now() / 1000);
      while (out.length < bars) {
        const start = end - 300 * 300;
        const k = await getJSON(
          `https://api.exchange.coinbase.com/products/${COINBASE[coin]}/candles?granularity=300&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`,
          { timeout: 20000 },
        );
        if (!k.length) break;
        out.unshift(
          ...k.map((r) => [r[0], Number(r[4])]).sort((a, b) => a[0] - b[0]),
        );
        end = start;
      }
      return out.slice(-bars);
    }
  });
}

// Which public price sources this connection can reach (for the doctor).
export async function probe() {
  const t = async (name, fn) => {
    const s = Date.now();
    try {
      await fn();
      return [name, { ok: true, ms: Date.now() - s }];
    } catch (e) {
      return [name, { ok: false, error: e.message }];
    }
  };
  return Object.fromEntries(
    await Promise.all([
      t("Binance (1-second prices)", () =>
        binance("/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=1", {
          timeout: 8000,
          retries: 0,
        }),
      ),
      t("Coinbase (spot)", () =>
        getJSON("https://api.exchange.coinbase.com/products/BTC-USD/ticker", {
          timeout: 8000,
          retries: 0,
        }),
      ),
      t("Kraken (spot)", () =>
        getJSON("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", {
          timeout: 8000,
          retries: 0,
        }),
      ),
    ]),
  );
}
