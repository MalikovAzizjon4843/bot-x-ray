// What a bot actually does, from a sample of its trades: which markets, whether it buys both sides, what a
// pair costs it, whether it ever sells, how each price it paid worked out, and whether its buys follow Binance.
import { Phi } from "./luck.js";

const UPDOWN = /^(btc|eth|sol|xrp)-updown-(5m|15m|4h|1h)-(\d+)$/;
const WINDOW = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };

export function kindOf(r) {
  const slug = r.slug || "";
  const m = slug.match(UPDOWN);
  if (m)
    return {
      kind: "updown",
      coin: m[1],
      tf: m[2],
      start: Number(m[3]),
      len: WINDOW[m[2]],
    };
  const t = `${r.title || ""} ${slug}`.toLowerCase();
  if (/up or down/.test(t)) return { kind: "updown-other" };
  if (
    /(bitcoin|ethereum|solana|\bxrp\b|\bbtc\b|\beth\b|crypto|doge|bnb)/.test(
      t,
    ) &&
    /(above|below|reach|dip|hit|between|price|less than|greater than)/.test(t)
  )
    return { kind: "price-level" };
  if (
    /( vs\.? | v | win |nba|nfl|mlb|nhl|ufc|premier league|champions league|match|game \d)/.test(
      t,
    )
  )
    return { kind: "sports" };
  return { kind: "other" };
}

export const KIND_LABEL = {
  updown: "5- and 15-minute crypto Up or Down",
  "updown-other": "hourly and daily crypto Up or Down",
  "price-level": 'crypto price levels ("will X be above K on date")',
  sports: "sports",
  other: "other markets",
};

// rows: slim activity rows (lib/polymarket.js). winners: slug -> winning outcome (or null).
export function marketsAndSides(rows, winners = {}) {
  const trades = rows.filter((r) => r.type === "TRADE");
  const buys = trades.filter((r) => r.side === "BUY");
  const sells = trades.filter((r) => r.side === "SELL");
  const mk = new Map();
  for (const r of trades) {
    const k = r.cid || r.slug;
    const m = mk.get(k) || {
      slug: r.slug,
      title: r.title,
      n: 0,
      buy: {},
      cost: {},
      sell: {},
      proceeds: {},
      kind: kindOf(r).kind,
    };
    m.n++;
    const side = r.outcome || "?";
    if (r.side === "BUY") {
      m.buy[side] = (m.buy[side] || 0) + r.size;
      m.cost[side] = (m.cost[side] || 0) + r.usdc;
    } else {
      m.sell[side] = (m.sell[side] || 0) + r.size;
      m.proceeds[side] = (m.proceeds[side] || 0) + r.usdc;
    }
    mk.set(k, m);
  }
  const markets = [...mk.values()];
  const kinds = {};
  for (const r of buys) {
    const k = kindOf(r).kind;
    kinds[k] = (kinds[k] || 0) + r.usdc;
  }
  const spent = buys.reduce((s, r) => s + r.usdc, 0);
  // Which coins it traded, by dollars bought.
  const coinUsd = {};
  for (const r of buys) {
    const t = `${r.slug || ""} ${r.title || ""}`.toLowerCase();
    const coin = /\b(btc|bitcoin)\b/.test(t) ? "btc" : /\b(eth|ether|ethereum)\b/.test(t) ? "eth" : /\b(sol|solana)\b/.test(t) ? "sol" : /\bxrp\b/.test(t) ? "xrp" : null;
    if (coin) coinUsd[coin] = (coinUsd[coin] || 0) + r.usdc;
  }

  // Per market: what it paid, what the winner paid back (shares held of the winning side), both sides or one.
  let bothN = 0,
    cost = 0,
    payout = 0,
    settledN = 0;
  const pairs = [],
    balance = [],
    table = [];
  for (const m of markets) {
    const sides = Object.keys(m.buy);
    if (!sides.length) continue;
    const avg = Object.fromEntries(sides.map((s) => [s, m.cost[s] / m.buy[s]]));
    const both = sides.length === 2;
    if (both) {
      bothN++;
      pairs.push(avg[sides[0]] + avg[sides[1]]);
      const [a, b] = sides.map((s) => m.buy[s]);
      balance.push(Math.min(a, b) / Math.max(a, b));
    }
    const net =
      Object.values(m.cost).reduce((s, v) => s + v, 0) -
      Object.values(m.proceeds).reduce((s, v) => s + v, 0);
    const w = winners[m.slug];
    const held = w ? (m.buy[w] || 0) - (m.sell[w] || 0) : null;
    if (w) {
      settledN++;
      cost += net;
      payout += held;
    }
    table.push({
      title: m.title,
      slug: m.slug,
      trades: m.n,
      sides: sides.map((s) => ({ side: s, shares: m.buy[s], avg: avg[s] })),
      pair: both ? avg[sides[0]] + avg[sides[1]] : null,
      winner: w || null,
      cost: net,
      payout: held,
      pnl: held === null ? null : held - net,
    });
  }
  table.sort((a, b) => b.trades - a.trades);
  const withBuys = table.length;
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const q = (a, p) =>
    a.length
      ? sorted(a)[Math.min(a.length - 1, Math.floor(p * a.length))]
      : null;

  return {
    trades: trades.length,
    buys: buys.length,
    sells: sells.length,
    merges: rows.filter((r) => r.type === "MERGE").length,
    redeems: rows.filter((r) => r.type === "REDEEM").length,
    spent,
    coins: Object.entries(coinUsd).sort((a, b) => b[1] - a[1]).map(([coin, usd]) => ({ coin, share: spent ? usd / spent : 0 })),
    kinds: Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, usd]) => ({
        kind,
        label: KIND_LABEL[kind],
        share: spent ? usd / spent : 0,
      })),
    markets: withBuys,
    bothSides: bothN,
    bothShare: withBuys ? bothN / withBuys : 0,
    pair: pairs.length
      ? {
          median: q(pairs, 0.5),
          lo: q(pairs, 0.1),
          hi: q(pairs, 0.9),
          min: Math.min(...pairs),
          max: Math.max(...pairs),
        }
      : null,
    balance: balance.length ? q(balance, 0.5) : null,
    settled: {
      markets: settledN,
      cost,
      payout,
      pnl: payout - cost,
      ret: cost > 0 ? (payout - cost) / cost : null,
    },
    table: table.slice(0, 40),
  };
}

// P&L by the price it paid, for every buy in a market that has settled (coinman_edge.py).
export const BUCKETS = [
  { key: "<5", lo: 0, hi: 0.05, label: "Under 5¢" },
  { key: "5-20", lo: 0.05, hi: 0.2, label: "5–20¢" },
  { key: "20-80", lo: 0.2, hi: 0.8, label: "20–80¢" },
  { key: "80-95", lo: 0.8, hi: 0.95, label: "80–95¢" },
  { key: "95-99", lo: 0.95, hi: 0.99, label: "95–99¢" },
  { key: "99+", lo: 0.99, hi: 1.01, label: "99¢ and up" },
];
export function byPricePaid(rows, winners) {
  const B = BUCKETS.map((b) => ({
    ...b,
    buys: 0,
    cost: 0,
    shares: 0,
    payout: 0,
  }));
  for (const r of rows) {
    if (r.type !== "TRADE" || r.side !== "BUY") continue;
    const w = winners[r.slug];
    if (!w) continue;
    const b = B.find((x) => r.price >= x.lo && r.price < x.hi);
    if (!b) continue;
    b.buys++;
    b.cost += r.usdc;
    b.shares += r.size;
    b.payout += r.outcome === w ? r.size : 0;
  }
  return B.filter((b) => b.buys).map((b) => ({
    label: b.label,
    key: b.key,
    buys: b.buys,
    spent: b.cost,
    avgPrice: b.cost / b.shares,
    won: b.payout / b.shares,
    pnl: b.payout - b.cost,
    ret: (b.payout - b.cost) / b.cost,
  }));
}

// The Binance reaction test (latency_check.py). For buys in short Up/Down markets: after a move bigger than 3 bps
// over the last `lag` seconds on Binance, how often did it buy the side of that move? A speed bot scores well above
// 50%; a bot that ignores Binance scores about 50%. prices: { coin: Map(second -> close) }.
export function binanceReaction(
  rows,
  prices,
  { lags = [2, 4, 10], threshold = 3e-4 } = {},
) {
  const out = {};
  for (const [coin, px] of Object.entries(prices)) {
    const buys = rows
      .filter(
        (r) =>
          r.type === "TRADE" &&
          r.side === "BUY" &&
          (r.outcome === "Up" || r.outcome === "Down"),
      )
      .map((r) => ({ r, k: kindOf(r) }))
      .filter(
        ({ k }) =>
          k.kind === "updown" &&
          k.coin === coin &&
          (k.tf === "15m" || k.tf === "5m"),
      );
    if (!buys.length || !px.size) continue;
    const secs = [...px.keys()].sort((a, b) => a - b);
    const P = (t) => {
      if (px.has(t)) return px.get(t);
      let lo = 0,
        hi = secs.length - 1,
        best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (secs[mid] <= t) {
          best = secs[mid];
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return best === null ? null : px.get(best);
    };
    const rets = [];
    for (let i = 1; i < secs.length; i++)
      if (secs[i] - secs[i - 1] === 1)
        rets.push(Math.log(px.get(secs[i]) / px.get(secs[i - 1])));
    const mu = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
    const sig = Math.sqrt(
      rets.reduce((s, v) => s + (v - mu) ** 2, 0) / (rets.length || 1),
    );
    let agree = 0,
      edgeSum = 0,
      edgeW = 0,
      n = 0;
    for (const { r, k } of buys) {
      const left = Math.max(k.start + k.len - r.t, 1);
      const p0 = P(k.start),
        p1 = P(r.t);
      if (!p0 || !p1) continue;
      const mv = Math.log(p1 / p0);
      const fairUp = Phi(mv / (sig * Math.sqrt(left)));
      const fair = r.outcome === "Up" ? fairUp : 1 - fairUp;
      n++;
      agree += mv > 0 === (r.outcome === "Up") ? 1 : 0;
      edgeSum += (fair - r.price) * r.size;
      edgeW += r.size;
    }
    const byLag = lags.map((lag) => {
      let hit = 0,
        tot = 0;
      for (const { r } of buys) {
        const a = P(r.t - lag),
          b = P(r.t);
        if (!a || !b) continue;
        const mv = Math.log(b / a);
        if (Math.abs(mv) > threshold) {
          tot++;
          hit += mv > 0 === (r.outcome === "Up") ? 1 : 0;
        }
      }
      return { lag, buys: tot, share: tot ? hit / tot : null };
    });
    out[coin] = {
      buys: n,
      withMove: agree / (n || 1),
      edgeCents: edgeW ? (100 * edgeSum) / edgeW : null,
      volBps: sig * 1e4,
      byLag,
    };
  }
  return out;
}

// Which Binance seconds the reaction test needs: one range per coin covering each market's window.
export function priceWindows(rows) {
  const need = {};
  for (const r of rows) {
    if (r.type !== "TRADE" || r.side !== "BUY") continue;
    const k = kindOf(r);
    if (k.kind !== "updown" || (k.tf !== "15m" && k.tf !== "5m")) continue;
    const w = (need[k.coin] ||= { t0: Infinity, t1: -Infinity });
    w.t0 = Math.min(w.t0, r.t - 960, k.start - 5);
    w.t1 = Math.max(w.t1, r.t + 5);
  }
  return need;
}
