// Which Up/Down markets the feed follows: every coin × 5m/15m, the current window and the next one.
// The next window is picked up as soon as Gamma lists it (well over 60 s before it starts); an ended
// window is dropped after a 60 s grace so its last trades and the settlement-time book still arrive.
import { EventEmitter } from "node:events";
import { getJSON } from "./net.js";

export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB = "https://clob.polymarket.com";
export const COINS = ["btc", "eth", "sol", "xrp", "doge"];
export const WINDOWS = [5, 15];

const safeJSON = (s, d) => {
  try {
    return typeof s === "string" ? JSON.parse(s) : s ?? d;
  } catch {
    return d;
  }
};

// Gamma market + its CLOB parameters (fee `fd`, `itode`, min order). `fd` missing → null, never a guess.
export async function fetchUpDown(slug) {
  const d = await getJSON(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`, { timeout: 10_000, retries: 1 });
  const m = Array.isArray(d) ? d[0] : null;
  if (!m) return null;
  const outcomes = safeJSON(m.outcomes, []);
  const ids = safeJSON(m.clobTokenIds, []);
  if (ids.length !== 2) return null;
  let clob = null;
  try {
    clob = await getJSON(`${CLOB}/clob-markets/${m.conditionId}`, { timeout: 10_000, retries: 1 });
  } catch {
    /* recorded as missing */
  }
  return {
    slug,
    conditionId: m.conditionId,
    question: m.question || slug,
    tokens: outcomes.map((o, i) => ({ outcome: o, assetId: ids[i] })),
    fd: clob?.fd ?? null,
    itode: clob?.itode ?? null,
    minOrderSize: clob?.mos ?? m.orderMinSize ?? null,
    tickSize: clob?.mts ?? m.orderPriceMinTickSize ?? null,
    feeSchedule: m.feeSchedule ?? null,
  };
}

export class MarketRotator extends EventEmitter {
  constructor({ coins = COINS, windows = WINDOWS, graceSec = 60, retrySec = 20, tickMs = 5_000, fetchMarket = fetchUpDown, now = Date.now, log = () => {} } = {}) {
    super();
    Object.assign(this, { coins, windows, graceSec, retrySec, tickMs, fetchMarket, now, log });
    this.active = new Map(); // slug → market
    this.pending = new Map(); // slug → next retry (ms)
    this.inflight = new Set();
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  markets() {
    return [...this.active.values()];
  }

  wanted(nowSec) {
    const out = [];
    for (const coin of this.coins)
      for (const m of this.windows) {
        const len = m * 60;
        const cur = Math.floor(nowSec / len) * len;
        for (const start of [cur, cur + len]) out.push({ coin, minutes: m, start, end: start + len, slug: `${coin}-updown-${m}m-${start}` });
      }
    return out;
  }

  async tick() {
    const t = this.now();
    const nowSec = Math.floor(t / 1000);
    for (const [slug, mk] of this.active)
      if (nowSec > mk.end + this.graceSec) {
        this.active.delete(slug);
        this.emit("remove", mk);
      }
    const jobs = [];
    for (const w of this.wanted(nowSec)) {
      if (this.active.has(w.slug) || this.inflight.has(w.slug)) continue;
      if ((this.pending.get(w.slug) || 0) > t) continue;
      this.inflight.add(w.slug);
      jobs.push(
        this.fetchMarket(w.slug)
          .then((m) => {
            if (!m) {
              this.pending.set(w.slug, this.now() + this.retrySec * 1000);
              return;
            }
            if (this.now() / 1000 > w.end + this.graceSec) return;
            const mk = { ...w, ...m };
            this.active.set(w.slug, mk);
            this.pending.delete(w.slug);
            if (!mk.fd) this.log(`feed: ${w.slug} has no fee data (fd); the engine will skip it`);
            this.emit("add", mk);
          })
          .catch((e) => {
            this.pending.set(w.slug, this.now() + this.retrySec * 1000);
            this.log(`feed: couldn't load ${w.slug} (${e.message})`);
          })
          .finally(() => this.inflight.delete(w.slug)),
      );
    }
    for (const [slug, at] of this.pending) if (at < t - 3600e3) this.pending.delete(slug);
    await Promise.all(jobs);
  }
}
