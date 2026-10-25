// Several v2 paper engines on one feed, each with its own state, cycles, $50 and FillModel:
// data/variants/<id>/mm-paper-v2.json and mm-cycles-v2.jsonl. The variants are defined in data/variants.json
// (written with the defaults below the first time). A variant's config comes from that file on every start.
import fs from "node:fs";
import path from "node:path";
import { MarketMakerV2, DEFAULT_CONFIG } from "./mm-v2.js";

// shared by every default variant
const BASE = { cancelMode: "pessimistic", strategies: { A: false, B: true }, orderUsd: 10, maxOpen: 3, startBalance: 50 };

export const DEFAULT_VARIANTS = [
  { id: "V1", label: "penny · cross all · stop 3¢/5s · spread 2¢ (baseline)", config: { quoteMode: "penny", crossFill: "all", stopEnabled: true, stopMoveCents: 3, minHoldMs: 5000, exitMode: "taker_scratch", minSpreadCents: 2 } },
  { id: "V2", label: "penny · cross through_only · stop 3¢/5s · spread 2¢", config: { quoteMode: "penny", crossFill: "through_only", stopEnabled: true, stopMoveCents: 3, minHoldMs: 5000, exitMode: "taker_scratch", minSpreadCents: 2 } },
  { id: "V3", label: "join · cross all · stop 3¢/5s · spread 2¢", config: { quoteMode: "join", crossFill: "all", stopEnabled: true, stopMoveCents: 3, minHoldMs: 5000, exitMode: "taker_scratch", minSpreadCents: 2 } },
  { id: "V4", label: "join · cross all · no stop, TTL 180s · spread 2¢", config: { quoteMode: "join", crossFill: "all", stopEnabled: false, quoteTtlSec: 180, legTtlSec: 180, exitMode: "taker_scratch", minSpreadCents: 2 } },
  { id: "V5", label: "penny · cross all · no stop, TTL 180s · spread 2¢", config: { quoteMode: "penny", crossFill: "all", stopEnabled: false, quoteTtlSec: 180, legTtlSec: 180, exitMode: "taker_scratch", minSpreadCents: 2 } },
  { id: "V6", label: "join · cross all · hold to resolution · spread 3¢", config: { quoteMode: "join", crossFill: "all", exitMode: "hold_to_resolution", minSpreadCents: 3 } },
];

export const MIN_CYCLES = 300; // fewer → "not enough data"

export function loadVariants(dataDir) {
  const file = path.join(dataDir, "variants.json");
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(v.variants) && v.variants.length) return v.variants;
  } catch {
    /* first run */
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ note: "Each variant is a separate paper engine on the same feed. Edit, then restart the server.", base: BASE, variants: DEFAULT_VARIANTS }, null, 2));
  return DEFAULT_VARIANTS;
}

export class Variants {
  constructor({ pool, markets, dataDir, now = Date.now, log = () => {}, resolve, timers = true, variants } = {}) {
    this.dataDir = dataDir;
    this.now = now;
    this.list = (variants || loadVariants(dataDir)).map((v) => {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(v.id)) throw new Error(`variant id ${v.id}?`);
      const dir = path.join(dataDir, "variants", v.id);
      const engine = new MarketMakerV2({ pool, markets, dataDir: dir, now, log: (m) => log(`[${v.id}] ${m}`), resolve, timers });
      // the definition wins over whatever config the variant's state file had
      const config = { ...DEFAULT_CONFIG, ...BASE, ...v.config, strategies: { ...BASE.strategies, ...(v.config?.strategies || {}) } };
      const wasRunning = engine.s.running;
      engine.s.running = false;
      engine.setConfig(config);
      engine.s.running = wasRunning;
      return { id: v.id, label: v.label || v.id, engine };
    });
  }

  // variants that were running when the server stopped carry on
  resume() {
    for (const v of this.list) if (v.engine.s.running) v.engine.start();
  }

  startAll() {
    for (const v of this.list) v.engine.start();
    return this.status();
  }

  stopAll() {
    for (const v of this.list) v.engine.stop();
    return this.status();
  }

  suspendAll() {
    for (const v of this.list) v.engine.suspend();
  }

  resetAll() {
    for (const v of this.list) v.engine.stop();
    for (const v of this.list) v.engine.reset();
    return this.status();
  }

  tick(at) {
    for (const v of this.list) v.engine.tick(at);
  }

  get(id) {
    return this.list.find((v) => v.id === id) || null;
  }

  status() {
    return {
      minCycles: MIN_CYCLES,
      variants: this.list.map(({ id, label, engine }) => {
        const st = engine.status();
        const stats = engine.stats();
        return {
          id,
          label,
          running: st.running,
          uptimeSec: st.uptimeSec,
          startedAt: st.startedAt,
          cash: st.cash,
          open: st.open.length,
          config: st.config,
          stats,
          enoughData: stats.cycles >= MIN_CYCLES,
          equity: engine.s.equity.slice(-300).map((e) => [e.t, e.v]),
          fillModel: st.fillModel ? { eventUsP99: st.fillModel.eventUs.p99, buffer: st.fillModel.buffer.pending } : null,
        };
      }),
    };
  }
}
