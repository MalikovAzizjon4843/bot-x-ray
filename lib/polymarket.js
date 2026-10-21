// Polymarket's public data: every trade, every wallet's daily P&L, market results and the live order book.
// Reading it needs no account and works from anywhere. Nothing here places an order.
import { getJSON, cached, pool } from "./net.js";

const DATA_API = "https://data-api.polymarket.com";
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

const HOUR = 3600e3;
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);

// "0x8dxd", "gabagool22", "@coinman2", "https://polymarket.com/@coinman2", "polymarket.com/profile/0xabc..." or a wallet.
export function parseWalletInput(input) {
  let s = String(input ?? "").trim();
  if (!s)
    throw Object.assign(
      new Error(
        "Give me a Polymarket wallet address or a username, for example 0x8dxd or gabagool22.",
      ),
      { status: 400 },
    );
  const url = s.match(/polymarket\.com\/(?:profile\/)?@?([^/?#\s]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@/, "");
  return isAddress(s) ? { wallet: s.toLowerCase() } : { name: s };
}

// Resolve a username or address to the wallet and its leaderboard line (name, lifetime P&L, volume, rank).
export async function resolveWallet(input) {
  const p = parseWalletInput(input);
  if (p.wallet) {
    const rows = await cached(`lb-user:${p.wallet}`, 6 * HOUR, () =>
      getJSON(
        `${DATA_API}/v1/leaderboard?user=${p.wallet}&timePeriod=ALL`,
      ).catch(() => []),
    );
    const r = Array.isArray(rows) ? rows[0] : null;
    return {
      wallet: p.wallet,
      name: r?.userName || p.wallet.slice(0, 10),
      leaderboard: r ? lbLine(r) : null,
    };
  }
  const rows = await cached(`lb-name:${p.name.toLowerCase()}`, 6 * HOUR, () =>
    getJSON(
      `${DATA_API}/v1/leaderboard?userName=${encodeURIComponent(p.name)}&timePeriod=ALL`,
    ),
  );
  const list = Array.isArray(rows) ? rows : [];
  const exact = list.find(
    (r) => String(r.userName).toLowerCase() === p.name.toLowerCase(),
  );
  if (!exact) {
    const near = list
      .slice(0, 5)
      .map((r) => r.userName)
      .filter(Boolean);
    throw Object.assign(
      new Error(
        `No Polymarket profile is called "${p.name}".${near.length ? ` Close matches: ${near.join(", ")}.` : ""} Paste the wallet address (0x… from the profile page) instead.`,
      ),
      { status: 404 },
    );
  }
  return {
    wallet: exact.proxyWallet.toLowerCase(),
    name: exact.userName,
    leaderboard: lbLine(exact),
  };
}

const lbLine = (r) => ({
  rank: Number(r.rank) || null,
  pnl: Number(r.pnl) || 0,
  volume: Number(r.vol) || 0,
  name: r.userName || null,
});

// The wallet's daily cumulative P&L series (includes fees, rebates and rewards). One point a day, the last one live.
export async function pnlSeries(wallet) {
  const j = await cached(`pnl:${wallet}`, 1 * HOUR, () =>
    getJSON(
      `${DATA_API}/v2/user-pnl?user_address=${wallet}&interval=all&fidelity=1d`,
      { timeout: 40000 },
    ),
  );
  const pts = j?.data?.points;
  if (!Array.isArray(pts) || !pts.length)
    throw Object.assign(
      new Error(
        "Polymarket has no P&L history for this wallet. Is it the right address, and has it traded?",
      ),
      { status: 404 },
    );
  return pts;
}

// Every trade, merge and redeem a wallet made in [start, end] (unix seconds), newest first, paged by moving the end back.
// maxRows stops early for very busy wallets. A window that ended over a day ago can't change, so it's cached for good.
export async function activity(
  wallet,
  start,
  end,
  { maxRows = 25000, onPage } = {},
) {
  const key = `act:${wallet}:${start}:${end}:${maxRows}`;
  const ttl = end < Date.now() / 1000 - 86400 ? Infinity : 0.25 * HOUR;
  return cached(key, ttl, async () => {
    const out = [];
    const seen = new Set();
    let cur = end;
    while (cur > start && out.length < maxRows) {
      const rows = await getJSON(
        `${DATA_API}/activity?user=${wallet}&limit=500&start=${start}&end=${cur}&sortBy=TIMESTAMP&sortDirection=DESC`,
        { timeout: 60000, retries: 3 },
      );
      if (!Array.isArray(rows) || !rows.length) break;
      // Pages overlap at the boundary second, so drop rows an earlier page already gave. Identical rows within
      // one page are real: one transaction can fill several orders of the same size.
      const key = (r) =>
        `${r.transactionHash}|${r.asset}|${r.type}|${r.size}|${r.side}`;
      const fresh = rows.filter((r) => !seen.has(key(r)));
      for (const r of fresh) out.push(slim(r));
      for (const r of rows) seen.add(key(r));
      onPage?.(out.length);
      if (!fresh.length || rows.length < 500) break;
      const oldest = Math.min(...rows.map((r) => r.timestamp));
      cur =
        oldest === Math.max(...rows.map((r) => r.timestamp))
          ? oldest - 1
          : oldest;
    }
    return out;
  });
}

// Keep the fields the analysis uses, so the cache stays small.
const slim = (r) => ({
  t: r.timestamp,
  type: r.type,
  side: r.side || null,
  outcome: r.outcome || null,
  price: Number(r.price) || 0,
  size: Number(r.size) || 0,
  usdc: Number(r.usdcSize) || 0,
  cid: r.conditionId || null,
  slug: r.slug || null,
  title: r.title || null,
});

// Which outcome won a closed market ("Up", "Yes", a team...). null while it's open or unresolved.
export async function winner(slug) {
  if (!slug) return null;
  const tryOnce = async () => {
    const d = await getJSON(
      `${GAMMA}/markets?slug=${encodeURIComponent(slug)}&closed=true`,
      { timeout: 30000, retries: 4 },
    );
    const m = Array.isArray(d) ? d[0] : null;
    if (!m) return null;
    const o = JSON.parse(m.outcomes || "[]");
    const p = JSON.parse(m.outcomePrices || "[]").map(Number);
    const best = Math.max(...p);
    return best > 0.9 ? o[p.indexOf(best)] : null;
  };
  // Settled results never change, so they're cached for good. An open market is checked again next time.
  const key = `win:${slug}`;
  const hit = await cached(
    key,
    Infinity,
    async () => (await tryOnce()) ?? undefined,
  ).catch(() => undefined);
  return hit ?? null;
}

// For a market that has just ended: Polymarket can take a while to mark it closed, but its price already
// shows the result. Returns the winner once it's closed, or once it has ended and one side trades at 98¢+.
export async function endedWinner(slug) {
  const settled = await winner(slug).catch(() => null);
  if (settled) return { winner: settled, final: true };
  const d = await getJSON(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`, { timeout: 15000, retries: 1 });
  const m = Array.isArray(d) ? d[0] : null;
  if (!m || Date.parse(m.endDate) > Date.now() - 60e3) return null;
  const o = JSON.parse(m.outcomes || "[]");
  const p = JSON.parse(m.outcomePrices || "[]").map(Number);
  const best = Math.max(...p);
  return best >= 0.98 ? { winner: o[p.indexOf(best)], final: false } : null;
}

export async function winners(slugs, onProgress) {
  let done = 0;
  const res = await pool(slugs, 6, async (s) => {
    const w = await winner(s).catch(() => null);
    onProgress?.(++done, slugs.length);
    return [s, w];
  });
  return Object.fromEntries(res);
}

// This month's (or week's, or all-time) leaderboard for one category, e.g. CRYPTO.
export async function leaderboard({
  category = "CRYPTO",
  timePeriod = "MONTH",
  limit = 15,
} = {}) {
  const rows = await cached(
    `lb:${category}:${timePeriod}:${limit}`,
    0.5 * HOUR,
    () =>
      getJSON(
        `${DATA_API}/v1/leaderboard?category=${category}&timePeriod=${timePeriod}&orderBy=PNL&limit=${limit}`,
      ),
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    rank: Number(r.rank),
    wallet: String(r.proxyWallet).toLowerCase(),
    name: r.userName || r.proxyWallet,
    pnl: Number(r.pnl) || 0,
    volume: Number(r.vol) || 0,
  }));
}

// The live 15-minute Up/Down market for a coin, by its window start (unix seconds, a multiple of 900).
export async function upDownMarket(coin, start, minutes = 15) {
  const slug = `${coin}-updown-${minutes}m-${start}`;
  const d = await getJSON(`${GAMMA}/markets?slug=${slug}`, {
    timeout: 10000,
    retries: 1,
  });
  const m = Array.isArray(d) ? d[0] : null;
  if (!m) throw new Error(`Polymarket has no market ${slug} yet`);
  return {
    slug,
    title: m.question || m.title || slug,
    tokens: Object.fromEntries(
      JSON.parse(m.outcomes).map((o, i) => [o, JSON.parse(m.clobTokenIds)[i]]),
    ),
  };
}

export async function book(tokenId) {
  const b = await getJSON(`${CLOB}/book?token_id=${tokenId}`, {
    timeout: 5000,
    retries: 0,
  });
  const asks = (b.asks || []).map((a) => Number(a.price)).sort((x, y) => x - y);
  const bids = (b.bids || []).map((a) => Number(a.price)).sort((x, y) => y - x);
  return { ask: asks[0] ?? null, bid: bids[0] ?? null };
}

// Polymarket's crypto taker fee per share at price p. Before 30 Mar 2026: 0.25 × (p(1−p))². From 30 Mar: 0.07 × p(1−p).
export const takerFee = (p, when = Date.now() / 1000) =>
  when < 1774828800 ? 0.25 * (p * (1 - p)) ** 2 : 0.07 * p * (1 - p);
