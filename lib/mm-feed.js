// The Market-Maker v2 feed, wired up once for the server: rotator → FeedPool → RawLog.
//   BOTXRAY_NO_FEED=1          don't start it
//   BOTXRAY_FEED_COINS=btc,eth  which coins (default btc, eth, sol, xrp, doge)
//   BOTXRAY_FEED_CONNS=8        WebSocket connections
//   BOTXRAY_RAWLOG_MAX_GB=2     rolling size limit of data/ws-raw (0 turns the raw log off)
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { DATA } from "./net.js";
import { FeedPool, RawLog } from "./clob-ws.js";
import { MarketRotator, COINS } from "./market-rotator.js";

let S = null;

export const enabled = () => !!S;

export function options(env = process.env) {
  const coins = (env.BOTXRAY_FEED_COINS || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => COINS.includes(c));
  const gb = env.BOTXRAY_RAWLOG_MAX_GB === undefined || env.BOTXRAY_RAWLOG_MAX_GB === "" ? 2 : Number(env.BOTXRAY_RAWLOG_MAX_GB);
  return {
    disabled: env.BOTXRAY_NO_FEED === "1",
    coins: coins.length ? coins : COINS,
    conns: Math.min(Math.max(Number(env.BOTXRAY_FEED_CONNS) || 8, 1), 32),
    rawLogMaxGB: Number.isFinite(gb) && gb >= 0 ? gb : 2,
  };
}

export function start({ log = () => {}, env = process.env } = {}) {
  if (S) return S;
  const o = options(env);
  if (o.disabled) return null;
  if (typeof globalThis.WebSocket !== "function") {
    log(`feed: off (Node ${process.version} has no built-in WebSocket; use Node 22 or newer)`);
    return null;
  }
  const rawLog = o.rawLogMaxGB > 0 ? new RawLog({ dir: path.join(DATA, "ws-raw"), maxBytes: o.rawLogMaxGB * 1024 ** 3 }) : null;
  const pool = new FeedPool({ size: o.conns, rawLog });
  const rotator = new MarketRotator({ coins: o.coins, log });
  rotator.on("add", (m) => pool.add(m.tokens.map((t) => t.assetId)));
  rotator.on("remove", (m) => pool.remove(m.tokens.map((t) => t.assetId)));
  pool.on("reconnected", (e) => log(`feed: connection ${e.conn} reconnected (attempt ${e.attempt})`));
  rotator.start();
  const onExit = () => rawLog?.close();
  process.on("exit", onExit);
  S = { o, pool, rotator, rawLog, onExit, startedAt: Date.now(), proc: processMonitor() };
  log(`feed: ${o.coins.join(", ")} × 5m/15m on ${o.conns} connections, raw log ${rawLog ? `${o.rawLogMaxGB} GB max` : "off"}`);
  return S;
}

export const pool = () => S?.pool || null;
export const rotator = () => S?.rotator || null;

// Event-loop lag and CPU of this process over the last minute (a window that rolls every 60 s).
function processMonitor() {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const ms = (ns) => (Number.isFinite(ns) ? Math.round(ns / 1e5) / 10 : null);
  let last = { lag: null, cpuPct: null, at: Date.now(), cpu: process.cpuUsage() };
  const roll = () => {
    const now = Date.now();
    const cpu = process.cpuUsage(last.cpu);
    last = {
      lag: { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max) },
      cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / Math.max(1, now - last.at)) * 1000) / 10,
      at: now,
      cpu: process.cpuUsage(),
    };
    h.reset();
  };
  const timer = setInterval(roll, 60_000);
  timer.unref?.();
  return {
    snapshot() {
      // until the first full minute, show what there is so far
      if (!last.lag) {
        const cpu = process.cpuUsage(last.cpu);
        return { eventLoopLagMs: { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max) }, cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / Math.max(1, Date.now() - last.at)) * 1000) / 10, windowSec: Math.round((Date.now() - last.at) / 1000) };
      }
      return { eventLoopLagMs: last.lag, cpuPct: last.cpuPct, windowSec: 60 };
    },
    stop() {
      clearInterval(timer);
      h.disable();
    },
  };
}

// set by the server once the v2 engine exists, so feed-health can show the fill model's numbers too
let engineMetrics = null;
export const setEngineMetrics = (fn) => (engineMetrics = fn);

export function health() {
  if (!S) return { enabled: false, reason: options().disabled ? "BOTXRAY_NO_FEED=1" : "not started" };
  return {
    enabled: true,
    startedAt: new Date(S.startedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - S.startedAt) / 1000),
    coins: S.o.coins,
    markets: S.rotator.markets().map((m) => ({ slug: m.slug, start: m.start, end: m.end, fd: m.fd, itode: m.itode, minOrderSize: m.minOrderSize })),
    ...S.pool.health(),
    rawLog: S.rawLog?.stats() || null,
    process: { ...S.proc.snapshot(), rssMB: Math.round(process.memoryUsage().rss / 1e6) },
    fillModel: engineMetrics?.() || null,
  };
}

// Graceful stop: flush the raw log completely before the process exits.
export async function stop() {
  if (!S) return;
  const s = S;
  S = null;
  s.rotator.stop();
  s.pool.close();
  s.proc.stop();
  process.off("exit", s.onExit);
  if (s.rawLog) {
    await s.rawLog.flush();
    s.rawLog.close();
  }
}
