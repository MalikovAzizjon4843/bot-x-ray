#!/usr/bin/env node
// Checks the feed against the real exchange, without starting the server:
//   node scripts/ws-probe.js [--seconds 600] [--coins btc,eth] [--conns 8]
// Acceptance (Etap 1):
//   - every drift fixed within 60 s     (max drift age; the shadow connection re-checks every book by hash)
//   - top of book = REST /book ≥ 99%    (REST lined up with our book by hash, every token every 10 s)
// Drifts per token-hour is printed as a metric only: the exchange sometimes drops a level without saying so.
// It also re-measures the facts the roadmap relies on, and prints anything that differs.
import { FeedPool } from "../lib/clob-ws.js";
import { MarketRotator, COINS } from "../lib/market-rotator.js";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const seconds = Number(arg("seconds", 600));
const coins = arg("coins", COINS.join(",")).split(",").filter((c) => COINS.includes(c));
const conns = Number(arg("conns", 8));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const share = (a, b) => (b ? +((100 * a) / b).toFixed(2) : null);

if (typeof WebSocket !== "function") {
  console.error(`Node ${process.version} has no built-in WebSocket. Use Node 22 or newer.`);
  process.exit(1);
}

const pool = new FeedPool({ size: conns, restSampleMs: 0 });
const rotator = new MarketRotator({ coins, log: (m) => console.log(`  ${m}`) });
const facts = { frames: 0, framesWithNewline: 0, bookOrderOk: 0, bookOrderBad: 0, bestBidAskInitial: 0, bestBidAskDynamic: 0, tickChanges: 0, fdMismatch: [], itodeFalse: [], mosNot5: [] };
const dynamicTokens = new Set();
const complement = new Map(); // assetId → the market's other token
let initialDone = false;

for (const f of pool.feeds)
  f.on("raw", (text) => {
    facts.frames++;
    if (/[\r\n]/.test(text)) facts.framesWithNewline++;
    if (!text.includes('"book"') && !text.includes("best_bid_ask")) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (m.event_type === "best_bid_ask") dynamicTokens.has(m.asset_id) ? facts.bestBidAskDynamic++ : facts.bestBidAskInitial++;
      if (m.event_type !== "book") continue;
      const b = (m.bids || []).map((l) => Number(l.price));
      const a = (m.asks || []).map((l) => Number(l.price));
      const ok = b.every((p, i) => !i || p > b[i - 1]) && a.every((p, i) => !i || p < a[i - 1]);
      ok ? facts.bookOrderOk++ : facts.bookOrderBad++;
    }
  });

rotator.on("add", (m) => {
  const ids = m.tokens.map((t) => t.assetId);
  complement.set(ids[0], ids[1]);
  complement.set(ids[1], ids[0]);
  if (initialDone) for (const id of ids) dynamicTokens.add(id);
  pool.add(ids);
  const fd = m.fd;
  if (!fd || fd.r !== 0.07 || fd.e !== 1 || fd.to !== true) facts.fdMismatch.push({ slug: m.slug, fd });
  if (m.itode !== true) facts.itodeFalse.push(m.slug);
  if (m.minOrderSize !== 5) facts.mosNot5.push({ slug: m.slug, mos: m.minOrderSize });
});
rotator.on("remove", (m) => pool.remove(m.tokens.map((t) => t.assetId)));
pool.on("tick", () => facts.tickChanges++);

// ── Level decreases vs trades ──
// A trade is matched to a decrease at its price on its own token within ±300 ms (the decrease carries
// the volume). The taker side is read off the book: an ask consumed → the taker bought.
// For trades whose reported side disagrees, the other token is checked at 1 − p (cross-token matching).
const WINDOW = 300;
const dec = new Map(); // assetId → [{ price, side, qty, left, recvTs, source }]
const all = { n: 0, qty: 0, bySource: {} };
pool.on("level", (e) => {
  if (e.source === "resync" || e.newSize >= e.prevSize) return;
  const qty = e.prevSize - e.newSize;
  all.n++;
  all.qty += qty;
  all.bySource[e.source] = (all.bySource[e.source] || 0) + 1;
  const list = dec.get(e.assetId) || [];
  list.push({ price: r6(e.price), side: e.side, qty, left: qty, recvTs: e.recvTs, source: e.source, traded: false });
  while (list.length && e.recvTs - list[0].recvTs > 3_000) list.shift();
  dec.set(e.assetId, list);
});
const trades = [];
pool.on("trade", (t) => trades.push(t));
const tr = { n: 0, matched: 0, levelFirst: 0, dts: [], matchedDecreases: 0, tradedQty: 0, sideOk: 0, sideBad: 0, bad: { compBid: 0, compAsk: 0, compNone: 0, sameOtherSide: 0, examples: [] }, ok: { compBid: 0, compAsk: 0, compNone: 0 } };
const near = (list, price, ts, side) => (list || []).filter((d) => d.price === price && Math.abs(d.recvTs - ts) <= WINDOW && (!side || d.side === side));

function matchTrades(upTo) {
  while (trades.length && trades[0].recvTs < upTo - WINDOW - 100) {
    const t = trades.shift();
    tr.n++;
    const p = r6(t.price);
    const own = dec.get(t.assetId);
    const cands = near(own, p, t.recvTs).sort((a, b) => Math.abs(a.recvTs - t.recvTs) - Math.abs(b.recvTs - t.recvTs));
    if (!cands.length) continue;
    tr.matched++;
    const first = cands[0];
    const dt = first.recvTs - t.recvTs;
    tr.dts.push(Math.abs(dt));
    if (dt <= 0) tr.levelFirst++;
    // volume: take the trade size out of the decreases at that price, nearest first
    let left = t.size;
    for (const d of cands) {
      if (left <= 0) break;
      if (d.left <= 0) continue;
      const q = Math.min(d.left, left);
      d.left -= q;
      left -= q;
      tr.tradedQty += q;
      if (!d.traded) {
        d.traded = true;
        tr.matchedDecreases++;
      }
    }
    const takerFromBook = first.side === "ask" ? "BUY" : "SELL";
    const other = dec.get(complement.get(t.assetId));
    const compBid = near(other, r6(1 - p), t.recvTs, "bid").length > 0;
    const compAsk = near(other, r6(1 - p), t.recvTs, "ask").length > 0;
    const bucket = takerFromBook === t.side ? (tr.sideOk++, tr.ok) : (tr.sideBad++, tr.bad);
    if (compBid) bucket.compBid++;
    if (compAsk) bucket.compAsk++;
    if (!compBid && !compAsk) bucket.compNone++;
    if (bucket === tr.bad) {
      if (near(own, p, t.recvTs, first.side === "ask" ? "bid" : "ask").length) tr.bad.sameOtherSide++;
      if (tr.bad.examples.length < 8) tr.bad.examples.push({ price: p, size: t.size, reportedSide: t.side, ownDecrease: first.side, compBidAt1mP: compBid, compAskAt1mP: compAsk });
    }
  }
}
setInterval(() => matchTrades(Date.now()), 250).unref();

console.log(`\n  ws-probe: ${coins.join(", ")} × 5m/15m, ${conns} connections + 1 shadow, ${seconds} s\n`);
const t0 = Date.now();
await rotator.tick();
initialDone = true;
rotator.start();
console.log(`  subscribed ${pool.where.size} tokens on ${pool.feeds.filter((f) => f.books.size).length} connections`);

// unsubscribe + subscribe on a main connection once a minute, timed (the shadow does this all the time too)
const resubDelays = [];
async function resubTest() {
  const id = [...pool.where.keys()].find((x) => pool.book(x)?.hasSnapshot);
  if (!id) return;
  const t = Date.now();
  dynamicTokens.add(id);
  pool.where.get(id).resubscribe(id, "probe");
  for (let i = 0; i < 80 && !pool.book(id)?.hasSnapshot; i++) await sleep(25);
  if (pool.book(id)?.hasSnapshot) resubDelays.push(Date.now() - t);
}

let round = 0;
while (Date.now() - t0 < seconds * 1000) {
  await sleep(10_000);
  round++;
  await Promise.all([...pool.where.keys()].filter((id) => !pool.isStale(id)).map((id) => pool.restSample(id)));
  if (round % 6 === 3) await resubTest();
  const h = pool.health();
  const d = h.drift;
  console.log(
    `  ${Math.round((Date.now() - t0) / 1000)}s  tokens ${h.tokens}  msg/s ${h.msgPerSec}  stale ${h.staleTokens.length}  reconnects ${h.reconnects}  shadow ${d.checks} checks / ${d.driftDetected} drift  REST ${h.restSample.match}/${h.restSample.checks}  latency p50 ${h.latencyMs.p50}ms p95 ${h.latencyMs.p95}ms`,
  );
}
await sleep(1_000);
matchTrades(Infinity);

const h = pool.health();
const d = h.drift;
const snapDelays = pool.feeds.flatMap((f) => Array.from(f.snapshotDelays.a.subarray(0, f.snapshotDelays.n)));
const pongOk = pool.feeds.filter((f) => f.books.size).every((f) => Date.now() - f.lastPong < 25_000);
const acceptance = {
  maxDriftAgeSec: { value: d.maxDriftAgeSec, limit: "≤ 60", pass: d.maxDriftAgeSec === null || d.maxDriftAgeSec <= 60 },
  restTopMatchPct: { value: h.restSample.matchPct, limit: "≥ 99", pass: h.restSample.matchPct !== null && h.restSample.matchPct >= 99 },
};
const report = {
  seconds,
  tokens: h.tokens,
  msgPerSec: h.msgPerSec,
  reconnects: h.reconnects,
  staleAtEnd: h.staleTokens.length,
  latencyMs: h.latencyMs,
  acceptance,
  drift: d,
  restSample: h.restSample,
  facts: {
    pongOk,
    bookOrderBidsAscAsksDesc: `${facts.bookOrderOk} ok / ${facts.bookOrderBad} bad`,
    framesWithNewline: `${facts.framesWithNewline} of ${facts.frames}`,
    bestBidAsk: { initialSubscribe: facts.bestBidAskInitial, dynamicSubscribe: facts.bestBidAskDynamic },
    snapshotAfterSubscribeMs: { p50: pct(snapDelays, 0.5), p95: pct(snapDelays, 0.95), n: snapDelays.length },
    unsubSubSnapshotMs: { p50: pct(resubDelays, 0.5), max: Math.max(...resubDelays, 0), n: resubDelays.length },
    tickSizeChanges: facts.tickChanges,
    fdNotR007E1: facts.fdMismatch,
    itodeNotTrue: facts.itodeFalse,
    minOrderNot5: facts.mosNot5,
    trades: {
      trades: tr.n,
      matchedWithin300ms: tr.matched,
      levelBeforeTrade: tr.levelFirst,
      dtMs: { p50: pct(tr.dts, 0.5), p95: pct(tr.dts, 0.95) },
      tradeSideIsTaker: `${tr.sideOk} yes / ${tr.sideBad} no`,
      sideExceptions: tr.bad,
      sideOkComplement: tr.ok,
    },
    decreases: {
      events: all.n,
      bySource: all.bySource,
      tradeShareByEvents: share(tr.matchedDecreases, all.n),
      tradeShareByVolume: share(tr.tradedQty, all.qty),
    },
  },
};
console.log("\n" + JSON.stringify(report, null, 2));
const pass = Object.values(acceptance).every((a) => a.pass);
console.log(`\n  ${pass ? "PASS" : "FAIL"}: ${Object.entries(acceptance).map(([k, a]) => `${k} ${a.value} (${a.limit}) ${a.pass ? "ok" : "NO"}`).join(", ")}\n`);
rotator.stop();
pool.close();
process.exit(pass ? 0 : 1);
