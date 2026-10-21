// The pricing behind coinman2's loop: "will the price be above K on this date?" is a digital option. Its fair
// price is the chance the price ends above K, worked out from today's price and how much it usually moves.
import { Phi } from "../xray/luck.js";
import { fiveMinute } from "../prices.js";

export const YEAR = 365 * 86400;

// Chance the price ends above K: a lognormal with no drift, volatility sigma (a year), t years to go.
export function probAbove(S, K, sigma, t) {
  if (t <= 0 || sigma <= 0) return S > K ? 1 : 0;
  const v = sigma * Math.sqrt(t);
  return Phi((Math.log(S / K) - 0.5 * v * v) / v);
}

// Black-Scholes call and put with zero rates (fine for weeks-long options).
export function call(S, K, sigma, t) {
  if (t <= 0 || sigma <= 0) return Math.max(S - K, 0);
  const v = sigma * Math.sqrt(t);
  const d1 = (Math.log(S / K) + 0.5 * v * v) / v;
  return S * Phi(d1) - K * Phi(d1 - v);
}
export const put = (S, K, sigma, t) => call(S, K, sigma, t) - S + K;

// A call spread K..K+w per $1 of width: pays 1 if the price ends above K+w, 0 below K, a straight line between.
export const spreadAbove = (S, K, w, sigma, t) =>
  (call(S, K, sigma, t) - call(S, K + w, sigma, t)) / w;

// The single volatility that best explains a ladder of prices: [{ K, price }] -> sigma, by golden-section search.
// This is what the market itself is pricing, so the model can be checked against it.
export function fitVol(points, priceFn, { lo = 0.05, hi = 4 } = {}) {
  if (points.length < 3) return null;
  const err = (s) =>
    points.reduce((e, p) => e + (priceFn(p, s) - p.price) ** 2, 0);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo,
    b = hi,
    c = b - g * (b - a),
    d = a + g * (b - a);
  for (let i = 0; i < 80; i++) {
    if (err(c) < err(d)) b = d;
    else a = c;
    c = b - g * (b - a);
    d = a + g * (b - a);
  }
  return (a + b) / 2;
}

// How much the coin usually moves, as a yearly volatility: 5-minute returns over the last 2 and 7 days, blended.
export async function realisedVol(coin) {
  const k = await fiveMinute(coin, 2016);
  const r = k.slice(1).map(([, c], i) => Math.log(c / k[i][1]));
  const sd = (a) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(
      a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(a.length - 1, 1),
    );
  };
  const per = Math.sqrt(365 * 288);
  const s2 = sd(r.slice(-576)) * per,
    s7 = sd(r) * per;
  return {
    sigma: Math.sqrt((s2 * s2 + s7 * s7) / 2),
    twoDay: s2,
    sevenDay: s7,
    bars: k.length,
  };
}
