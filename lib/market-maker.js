// Market-Maker paper-trading engine: SPLIT/MERGE + Maker Rebate Simulator.
// Connects to live Polymarket Gamma & CLOB APIs, scans Crypto (BTC, ETH, SOL) & Sports markets,
// simulates two strategies:
//   Strategy A: Buy-Both-and-Merge (Instant Arbitrage: Best_Ask(YES) + Best_Ask(NO) < $0.992)
//   Strategy B: Split-and-Sell (Maker Spread Capture + 0.15% Rebates)
// with live orderbook fill sim, anti-legging emergency scratch, and zero maker fees.
// 100% paper/test mode — no real funds or orders ever touched.
import fs from "node:fs";
import path from "node:path";
import { getJSON, DATA } from "./net.js";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB  = "https://clob.polymarket.com";

const MM_FILE  = () => path.join(DATA, "mm-paper.json");
const CFG_FILE = () => path.join(DATA, "mm-config.json");

// ── Defaults ──
const DEFAULT_STATE = () => ({
  virtualBalance: 1000,
  lockedInventory: [],
  realizedPnL: 0,
  rebatesEarned: 0,
  totalSplits: 0,
  totalMerges: 0,
  winRate: 0,
  leggingScratches: 0,
  activeQuotes: [],
  tradeHistory: [],
  totalWins: 0,
  totalTrades: 0,
});

const DEFAULT_CONFIG = () => ({
  running: false,
  orderSizeUsd: 50,
  minSpreadCents: 1.5,
  maxOpenMarkets: 5,
  categories: ["crypto", "sports"],
  maxHoldSeconds: 180,
  stopLossCents: 3,
  mergeThreshold: 0.992,
  minLiquidity: 1000,
  minSpreadForSplit: 1.5,
  makerRebatePct: 0.0015,
});

let _state = null;
let _config = null;
let _lastScan = null;
let _timer = null;
let _running = false;

// ── Persistence ──
function ensureDataDir() {
  try { fs.mkdirSync(DATA, { recursive: true }); } catch { /* ok */ }
}

function loadState() {
  if (_state) return _state;
  try {
    _state = JSON.parse(fs.readFileSync(MM_FILE(), "utf8"));
    const d = DEFAULT_STATE();
    for (const k of Object.keys(d)) {
      if (_state[k] === undefined) _state[k] = d[k];
    }
  } catch {
    _state = DEFAULT_STATE();
  }
  return _state;
}

function saveState() {
  ensureDataDir();
  const s = loadState();
  if (s.tradeHistory.length > 200) s.tradeHistory = s.tradeHistory.slice(-200);
  s.lockedInventory = s.activeQuotes.map((q) => ({
    id: q.id,
    market: q.question,
    shares: q.shares,
    cost: q.cost,
    placedAt: q.placedAt,
    yesLimitSell: q.yesLimitSell,
    noLimitSell: q.noLimitSell,
    yesFilled: q.yesFilled,
    noFilled: q.noFilled,
  }));
  const tmp = MM_FILE() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, MM_FILE());
}

function loadConfig() {
  if (_config) return _config;
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_FILE(), "utf8"));
    _config = { ...DEFAULT_CONFIG(), ...raw };
  } catch {
    _config = DEFAULT_CONFIG();
  }
  return _config;
}

function saveConfig() {
  ensureDataDir();
  const tmp = CFG_FILE() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(_config, null, 2));
  fs.renameSync(tmp, CFG_FILE());
}

// ── Public API ──
export function state() {
  const s = loadState();
  const cfg = loadConfig();
  return {
    ...s,
    config: cfg,
    lastScan: _lastScan,
    running: cfg.running,
  };
}

export function config() {
  return loadConfig();
}

export function setConfig(patch) {
  const cfg = loadConfig();
  const allowed = Object.keys(DEFAULT_CONFIG());
  for (const [k, v] of Object.entries(patch || {})) {
    if (allowed.includes(k)) cfg[k] = v;
  }
  _config = cfg;
  saveConfig();
  return cfg;
}

export function toggle() {
  const cfg = loadConfig();
  cfg.running = !cfg.running;
  _config = cfg;
  saveConfig();
  return { running: cfg.running };
}

export function reset() {
  _state = DEFAULT_STATE();
  saveState();
  return _state;
}

// ── Strict Filtering for Crypto & Sports (excluding Politics / UMA) ──

function isPoliticsOrUma(txt) {
  const s = (txt || "").toLowerCase();
  return (
    s.includes("presiden") ||
    s.includes("election") ||
    s.includes("trump") ||
    s.includes("biden") ||
    s.includes("harris") ||
    s.includes("senate") ||
    s.includes("congress") ||
    s.includes("nomination") ||
    s.includes("putin") ||
    s.includes("xi jinping") ||
    s.includes("macron") ||
    s.includes("starmer") ||
    s.includes("governor") ||
    s.includes("cabinet") ||
    s.includes("politi") ||
    s.includes("war in") ||
    s.includes("ceasefire") ||
    s.includes("nato") ||
    s.includes("strike on") ||
    s.includes("white house") ||
    s.includes("prime minister")
  );
}

function isSportsMarket(m) {
  const q = (m.question || m.title || "").toLowerCase();
  const cat = (m.category || "").toLowerCase();
  if (isPoliticsOrUma(q) || isPoliticsOrUma(cat)) return false;
  return (
    cat.includes("sport") ||
    q.includes(" vs. ") ||
    q.includes(" vs ") ||
    q.includes(" fc") ||
    q.includes("fc ") ||
    q.includes("o/u ") ||
    q.includes("over/under") ||
    q.includes("nba") ||
    q.includes("nfl") ||
    q.includes("serie a") ||
    q.includes("premier league") ||
    q.includes("champions league") ||
    q.includes("la liga") ||
    q.includes("bundesliga") ||
    q.includes("ufc") ||
    q.includes("win on 202") ||
    q.includes("half o/u") ||
    q.includes("ballon d'or") ||
    q.includes("f1 ")
  );
}

function safeJSON(str, fallback) {
  if (Array.isArray(str)) return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ── Fetch Crypto & Sports Markets ──
async function fetchMarkets(categories) {
  const markets = [];
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Live Crypto: 15-minute BTC, ETH, SOL up/down markets
  if (categories.includes("crypto")) {
    const start15 = Math.floor(nowSec / 900) * 900;
    const intervals = [start15, start15 + 900];
    for (const start of intervals) {
      for (const coin of ["btc", "eth", "sol"]) {
        const slug = `${coin}-updown-15m-${start}`;
        try {
          const res = await getJSON(`${GAMMA}/markets?slug=${slug}`, {
            timeout: 8000,
            retries: 1,
          });
          const m = Array.isArray(res) ? res[0] : null;
          if (m) {
            const outcomes = safeJSON(m.outcomes, []);
            const tokenIds = safeJSON(m.clobTokenIds, []);
            if (outcomes.length === 2 && tokenIds.length === 2) {
              markets.push({
                id: m.id || m.conditionId || slug,
                slug,
                question: m.question || m.title || `${coin.toUpperCase()} Up or Down (15m)`,
                category: "crypto",
                outcomes,
                tokenIds,
                volume: Number(m.volume) || 50000,
                liquidity: Number(m.liquidityClob) || Number(m.liquidity) || 10000,
                endDate: m.endDate,
              });
            }
          }
        } catch { /* skip if unavailable */ }
      }
    }
  }

  // 2. High-volume general liquid markets (Sports & Crypto)
  try {
    const rows = await getJSON(
      `${GAMMA}/markets?closed=false&order=volume&ascending=false&limit=60`,
      { timeout: 12000, retries: 1 }
    );
    if (Array.isArray(rows)) {
      for (const m of rows) {
        const outcomes = safeJSON(m.outcomes, []);
        if (outcomes.length !== 2) continue;
        const tokenIds = safeJSON(m.clobTokenIds, []);
        if (tokenIds.length !== 2) continue;

        const q = (m.question || m.title || "").toLowerCase();
        if (isPoliticsOrUma(q)) continue;

        let matchedCategory = null;
        if (categories.includes("sports") && isSportsMarket(m)) {
          matchedCategory = "sports";
        } else if (
          categories.includes("crypto") &&
          (q.includes("bitcoin") || q.includes("btc") || q.includes("ethereum") || q.includes("eth") || q.includes("solana") || q.includes("sol"))
        ) {
          matchedCategory = "crypto";
        }

        if (matchedCategory && !markets.some((x) => x.id === (m.id || m.conditionId))) {
          markets.push({
            id: m.id || m.conditionId,
            slug: m.slug,
            question: m.question || m.title || "Unknown Market",
            category: matchedCategory,
            outcomes,
            tokenIds,
            volume: Number(m.volume) || 0,
            liquidity: Number(m.liquidityClob) || Number(m.liquidity) || 0,
            endDate: m.endDate,
          });
        }
      }
    }
  } catch { /* proceed with whatever was found */ }

  return markets;
}

async function fetchBook(tokenId) {
  try {
    const b = await getJSON(`${CLOB}/book?token_id=${tokenId}`, {
      timeout: 8000,
      retries: 1,
    });
    const asks = (b.asks || [])
      .map((a) => ({ price: Number(a.price), size: Number(a.size) }))
      .sort((x, y) => x.price - y.price);
    const bids = (b.bids || [])
      .map((a) => ({ price: Number(a.price), size: Number(a.size) }))
      .sort((x, y) => y.price - x.price);
    const bestAsk = asks[0]?.price ?? null;
    const bestBid = bids[0]?.price ?? null;
    const totalAskLiq = asks.reduce((s, a) => s + a.price * a.size, 0);
    const totalBidLiq = bids.reduce((s, a) => s + a.price * a.size, 0);
    return { bestAsk, bestBid, asks, bids, totalLiquidity: totalAskLiq + totalBidLiq };
  } catch {
    return { bestAsk: null, bestBid: null, asks: [], bids: [], totalLiquidity: 0 };
  }
}

// ── Core Scan Logic ──
export async function scanOnce() {
  const cfg = loadConfig();
  const s = loadState();
  const opportunities = [];
  const now = Date.now();

  // 1. Process active quotes first (fill check + anti-legging protection)
  await processActiveQuotes(s, cfg);

  // 2. Fetch live Crypto & Sports markets
  const markets = await fetchMarkets(cfg.categories);

  for (const market of markets) {
    if (s.activeQuotes.length >= cfg.maxOpenMarkets) break;
    if (s.activeQuotes.some((q) => q.marketId === market.id)) continue;

    const [bookYes, bookNo] = await Promise.all([
      fetchBook(market.tokenIds[0]),
      fetchBook(market.tokenIds[1]),
    ]);

    if (bookYes.bestAsk === null || bookNo.bestAsk === null) continue;
    if (bookYes.bestBid === null || bookNo.bestBid === null) continue;

    const pairSumAsk = bookYes.bestAsk + bookNo.bestAsk;
    const spreadYes = bookYes.bestAsk - bookYes.bestBid;
    const spreadNo  = bookNo.bestAsk - bookNo.bestBid;
    const avgSpreadCents = ((spreadYes + spreadNo) / 2) * 100;
    const totalLiquidity = bookYes.totalLiquidity + bookNo.totalLiquidity;

    const opp = {
      marketId: market.id,
      slug: market.slug,
      question: market.question,
      category: market.category,
      yesAsk: round(bookYes.bestAsk),
      noAsk: round(bookNo.bestAsk),
      yesBid: round(bookYes.bestBid),
      noBid: round(bookNo.bestBid),
      pairSum: round(pairSumAsk),
      spreadCents: round(avgSpreadCents),
      liquidity: round(totalLiquidity || market.liquidity),
      action: "Waiting",
      tokenIds: market.tokenIds,
    };

    // ── Strategy A: Buy-Both-and-Merge (Instant Arbitrage) ──
    // Best_Ask(YES) + Best_Ask(NO) < 0.992
    if (pairSumAsk < cfg.mergeThreshold) {
      opp.action = "Instant Merge";
      opportunities.push(opp);
      if (s.virtualBalance >= cfg.orderSizeUsd) {
        const shares = round(cfg.orderSizeUsd / pairSumAsk);
        const cost = round(shares * pairSumAsk);
        const payout = round(shares * 1.0);
        const profit = round(payout - cost);
        s.virtualBalance = round(s.virtualBalance - cost + payout);
        s.realizedPnL = round(s.realizedPnL + profit);
        s.totalMerges++;
        s.totalTrades++;
        if (profit > 0) s.totalWins++;
        s.winRate = s.totalTrades > 0 ? round((s.totalWins / s.totalTrades) * 100) : 0;
        s.tradeHistory.push({
          id: genId(),
          timestamp: new Date().toISOString(),
          market: market.question,
          slug: market.slug,
          strategy: "BUY-MERGE",
          entryCost: cost,
          exitPayout: payout,
          rebate: 0,
          netProfit: profit,
          yesPrice: bookYes.bestAsk,
          noPrice: bookNo.bestAsk,
        });
      }
      continue;
    }

    // ── Strategy B: Split-and-Sell (Maker Spread Capture + Rebates) ──
    // Spread >= minSpreadCents (e.g. 1.5c-6c), liquidity >= minLiquidity
    if (
      avgSpreadCents >= cfg.minSpreadCents &&
      (totalLiquidity >= cfg.minLiquidity || market.liquidity >= cfg.minLiquidity) &&
      s.virtualBalance >= cfg.orderSizeUsd
    ) {
      // Limit sell price positioned to capture spread or at Best_Ask
      const sellYes = round(bookYes.bestBid + spreadYes * 0.4);
      const sellNo  = round(bookNo.bestBid + spreadNo * 0.4);
      const combinedSell = sellYes + sellNo;

      if (combinedSell >= 1.015) {
        opp.action = "Quoting Split";
        opportunities.push(opp);
        const shares = round(cfg.orderSizeUsd / 1.0);
        const cost = round(shares * 1.0);
        s.virtualBalance = round(s.virtualBalance - cost);
        s.totalSplits++;
        const quote = {
          id: genId(),
          marketId: market.id,
          slug: market.slug,
          question: market.question,
          category: market.category,
          tokenIds: market.tokenIds,
          shares,
          cost,
          yesLimitSell: sellYes,
          noLimitSell: sellNo,
          yesFilled: false,
          noFilled: false,
          yesFilledAt: null,
          noFilledAt: null,
          placedAt: now,
          maxHoldMs: cfg.maxHoldSeconds * 1000,
          stopLossCents: cfg.stopLossCents,
          yesBestBidAtPlace: bookYes.bestBid,
          noBestBidAtPlace: bookNo.bestBid,
        };
        s.activeQuotes.push(quote);
        continue;
      }
    }

    opp.action = "Waiting";
    opportunities.push(opp);
  }

  _lastScan = {
    at: new Date().toISOString(),
    opportunities: opportunities.slice(0, 30),
    marketsScanned: markets.length,
  };

  saveState();
  return _lastScan;
}

// ── Fill Simulation + Anti-Legging Risk Protection ──
async function processActiveQuotes(s, cfg) {
  const now = Date.now();
  const toRemove = [];

  for (const q of s.activeQuotes) {
    const [bookYes, bookNo] = await Promise.all([
      fetchBook(q.tokenIds[0]),
      fetchBook(q.tokenIds[1]),
    ]);

    // Check fills: live bid touches or crosses our limit sell
    if (!q.yesFilled && bookYes.bestBid !== null && bookYes.bestBid >= q.yesLimitSell) {
      q.yesFilled = true;
      q.yesFilledAt = now;
    }
    if (!q.noFilled && bookNo.bestBid !== null && bookNo.bestBid >= q.noLimitSell) {
      q.noFilled = true;
      q.noFilledAt = now;
    }

    // Both legs filled → Completed full cycle with maker rebate
    if (q.yesFilled && q.noFilled) {
      const revenue = round(q.shares * (q.yesLimitSell + q.noLimitSell));
      const rebate = round(revenue * cfg.makerRebatePct);
      const profit = round(revenue - q.cost + rebate);
      s.virtualBalance = round(s.virtualBalance + revenue + rebate);
      s.realizedPnL = round(s.realizedPnL + profit);
      s.rebatesEarned = round(s.rebatesEarned + rebate);
      s.totalTrades++;
      if (profit > 0) s.totalWins++;
      s.winRate = s.totalTrades > 0 ? round((s.totalWins / s.totalTrades) * 100) : 0;
      s.tradeHistory.push({
        id: q.id,
        timestamp: new Date().toISOString(),
        market: q.question,
        slug: q.slug,
        strategy: "SPLIT-SELL",
        entryCost: q.cost,
        exitPayout: revenue,
        rebate,
        netProfit: profit,
        yesPrice: q.yesLimitSell,
        noPrice: q.noLimitSell,
      });
      toRemove.push(q.id);
      continue;
    }

    // Legging Protection: If 1 leg filled & other unfilled for > maxHoldSeconds OR moved against by > stopLossCents
    const oneFilled = q.yesFilled || q.noFilled;
    if (oneFilled) {
      const filledAt = q.yesFilled ? q.yesFilledAt : q.noFilledAt;
      const elapsed = now - (filledAt || q.placedAt);
      const unfilledIsYes = !q.yesFilled;
      const timeExceeded = elapsed > q.maxHoldMs;
      let priceExceeded = false;
      if (unfilledIsYes) {
        if (bookYes.bestBid !== null) {
          const moveCents = (q.yesLimitSell - bookYes.bestBid) * 100;
          priceExceeded = moveCents >= q.stopLossCents;
        }
      } else {
        if (bookNo.bestBid !== null) {
          const moveCents = (q.noLimitSell - bookNo.bestBid) * 100;
          priceExceeded = moveCents >= q.stopLossCents;
        }
      }

      if (timeExceeded || priceExceeded) {
        const scratchPrice = unfilledIsYes
          ? (bookYes.bestBid || q.yesLimitSell * 0.95)
          : (bookNo.bestBid || q.noLimitSell * 0.95);
        const filledPrice = unfilledIsYes ? q.noLimitSell : q.yesLimitSell;
        const revenue = round(q.shares * (filledPrice + scratchPrice));
        const rebate = round(q.shares * filledPrice * cfg.makerRebatePct);
        const profit = round(revenue - q.cost + rebate);
        s.virtualBalance = round(s.virtualBalance + revenue + rebate);
        s.realizedPnL = round(s.realizedPnL + profit);
        s.rebatesEarned = round(s.rebatesEarned + rebate);
        s.leggingScratches++;
        s.totalTrades++;
        if (profit > 0) s.totalWins++;
        s.winRate = s.totalTrades > 0 ? round((s.totalWins / s.totalTrades) * 100) : 0;
        s.tradeHistory.push({
          id: q.id,
          timestamp: new Date().toISOString(),
          market: q.question,
          slug: q.slug,
          strategy: "SPLIT-SELL (SCRATCHED)",
          entryCost: q.cost,
          exitPayout: revenue,
          rebate,
          netProfit: profit,
          yesPrice: unfilledIsYes ? round(scratchPrice) : q.yesLimitSell,
          noPrice: unfilledIsYes ? q.noLimitSell : round(scratchPrice),
          scratched: true,
          scratchReason: timeExceeded ? "timeout" : "stop-loss",
        });
        toRemove.push(q.id);
      }
    }
  }

  s.activeQuotes = s.activeQuotes.filter((q) => !toRemove.includes(q.id));
}

// ── Background Autonomous Loop (runs every 20s when running is true) ──
export function startLoop(log = () => {}) {
  if (_timer) return;
  _running = true;

  const tick = async () => {
    if (!_running) return;
    const cfg = loadConfig();
    if (!cfg.running) {
      _timer = setTimeout(tick, 4000);
      _timer.unref?.();
      return;
    }
    try {
      const result = await scanOnce();
      const opps = result.opportunities?.filter((o) => o.action !== "Waiting") || [];
      if (opps.length > 0) {
        log(`MM: ${opps.length} action(s) — ${opps.map((o) => `${o.action} on ${o.question.slice(0, 35)}`).join("; ")}`);
      }
    } catch (e) {
      log(`MM scan tick error: ${e.message}`);
    }
    _timer = setTimeout(tick, 20000);
    _timer.unref?.();
  };

  _timer = setTimeout(tick, 2000);
  _timer.unref?.();
}

export function stopLoop() {
  _running = false;
  clearTimeout(_timer);
  _timer = null;
  const cfg = loadConfig();
  cfg.running = false;
  _config = cfg;
  saveConfig();
}

export function lastScan() {
  return _lastScan;
}

// ── Helpers ──
function genId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function round(n) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}
