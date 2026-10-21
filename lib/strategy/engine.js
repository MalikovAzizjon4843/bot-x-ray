// The strategy that held up, as a loop: coinman2's "price it like an option, buy the side priced too low, hold
// to the end", on markets you can trade. Each scan prices every "above K by this date" contract from the live
// price and how much the coin usually moves, compares that with what it costs to buy each side after fees,
// and buys the cheap side when the gap is big enough. It never sells: positions settle at the end.
//
// The rules come from what coinman2's own trades showed: it lost money on sides priced under 20¢ and made it
// between 20¢ and 95¢, so that's the band. And the live check showed the trap: a model that disagrees with the
// market's own volatility by a lot finds "bargains" everywhere, and they're the model being wrong. So when the
// model's volatility and the market's differ by more than the vol band, that ladder is skipped.
//
// Paper by default. Live orders go through lib/brokers only when you've connected a broker and armed it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATA, ROOT } from "../net.js";
import { spot } from "../prices.js";
import { probAbove, spreadAbove, fitVol, realisedVol, YEAR } from "./model.js";
import * as kalshi from "./kalshi.js";
import * as options from "./options.js";
import * as brokers from "../brokers/index.js";

const DIR = () => path.join(DATA, "strategy");
const FILE = (n) => path.join(DIR(), n);

export const DEFAULTS = {
  running: true, // paper scans every `everyMinutes` while the app is open
  everyMinutes: 5,
  markets: { kalshi: true, options: true },
  coins: ["btc", "eth"],
  stake: 25, // dollars of paper money per trade
  minEdge: 0.03, // fair value minus cost, after fees, per $1 the side pays
  band: [0.2, 0.95], // only buy sides priced 20¢ to 95¢
  volBand: [0.67, 1.5], // skip a ladder when model vol ÷ market vol is outside this
  maxOpen: 500, // most paper money at risk at once
  maxPerClose: 100, // most at risk on one expiry
  maxNewPerScan: 3,
  dailyLossStop: 100, // no new trades for the rest of the day after losing this much
  optionsCommission: options.COMMISSION,
  kalshiMaxHours: 30,
  optionsMaxDays: 45,
  custom: {}, // plug-in strategies switched off by name: { "<name>": false }
};

const read = (n, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(FILE(n), "utf8"));
  } catch {
    return fallback;
  }
};
const write = (n, v) => {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(FILE(n) + ".tmp", JSON.stringify(v, null, 1));
  fs.renameSync(FILE(n) + ".tmp", FILE(n));
};
const journal = (e) => {
  try {
    fs.mkdirSync(DIR(), { recursive: true });
    fs.appendFileSync(
      FILE("journal.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n",
    );
  } catch {
    /* read-only folder */
  }
};

export function config() {
  const c = { ...DEFAULTS, ...read("config.json", {}) };
  c.markets = { ...DEFAULTS.markets, ...(c.markets || {}) };
  return c;
}
export function setConfig(patch) {
  const allowed = Object.keys(DEFAULTS);
  const cur = read("config.json", {});
  for (const [k, v] of Object.entries(patch || {}))
    if (allowed.includes(k)) cur[k] = v;
  write("config.json", cur);
  return config();
}
export const book = () => read("book.json", { open: [], closed: [] });

// Price one ladder: fair value of each side, the market's own volatility, and the trades the rules allow.
export function priceLadder(
  l,
  { S, sigma, now = Date.now() / 1000, cfg = DEFAULTS },
) {
  const t = Math.max((l.closes - now) / YEAR, 1 / YEAR / 60);
  const isOpt = l.venue === "options";
  const fair = (c, s) =>
    isOpt ? spreadAbove(S, c.K, c.w, s, t) : probAbove(S, c.K, s, t);
  const mid = l.contracts
    .map((c) => ({
      c,
      price:
        c.yesBid !== null && c.yesAsk !== null && c.yesBid > 0
          ? (c.yesBid + c.yesAsk) / 2
          : null,
    }))
    .filter((x) => x.price !== null && x.price > 0.08 && x.price < 0.92);
  const marketVol = fitVol(
    mid.map((x) => ({ ...x.c, price: x.price })),
    (c, s) => fair(c, s),
  );
  const ratio = marketVol ? sigma / marketVol : null;
  const volOk =
    ratio !== null && ratio >= cfg.volBand[0] && ratio <= cfg.volBand[1];
  const fee = (p) =>
    isOpt
      ? (2 * cfg.optionsCommission) / (100 * l.contracts[0].w)
      : kalshi.feePerContract(p);
  const rows = l.contracts.map((c) => {
    const fy = fair(c, sigma);
    const sides = [
      { side: "yes", fair: fy, ask: c.yesAsk },
      { side: "no", fair: 1 - fy, ask: c.noAsk },
    ].map((s) => ({
      ...s,
      cost: s.ask === null || s.ask <= 0 ? null : s.ask + fee(s.ask),
    }));
    for (const s of sides) s.edge = s.cost === null ? null : s.fair - s.cost;
    const best =
      sides.filter((s) => s.edge !== null).sort((a, b) => b.edge - a.edge)[0] ||
      null;
    let why = null;
    if (!best) why = "no price to buy at";
    else if (best.edge < cfg.minEdge)
      why = `edge ${(100 * best.edge).toFixed(1)}¢ is under ${(100 * cfg.minEdge).toFixed(0)}¢`;
    else if (best.ask < cfg.band[0] || best.ask > cfg.band[1])
      why = `priced ${(100 * best.ask).toFixed(0)}¢, outside the ${(100 * cfg.band[0]).toFixed(0)}–${(100 * cfg.band[1]).toFixed(0)}¢ band`;
    else if (!volOk)
      why =
        ratio === null
          ? "the market's volatility couldn't be read"
          : `model vol is ${ratio.toFixed(2)}× the market's: the model is probably wrong here`;
    return { ...c, fairYes: fy, best, signal: !why, why };
  });
  return {
    venue: l.venue,
    coin: l.coin,
    symbol: l.symbol,
    closes: l.closes,
    expiry: l.expiry,
    S,
    sigma,
    marketVol,
    ratio,
    volOk,
    contracts: rows,
  };
}

// Plug-in strategies: conversions Claude writes into lib/strategy/custom/ (see the README there). Each one runs
// in this same loop, on paper, inside the same risk limits.
const CUSTOM = path.join(ROOT, "lib", "strategy", "custom");
export async function customStrategies() {
  let files = [];
  try {
    files = fs.readdirSync(CUSTOM).filter((f) => f.endsWith(".js"));
  } catch { /* no folder */ }
  const out = [];
  for (const f of files) {
    const full = path.join(CUSTOM, f);
    try {
      const mod = (await import(`${pathToFileURL(full).href}?v=${fs.statSync(full).mtimeMs}`)).default;
      if (!mod || typeof mod.scan !== "function" || typeof mod.settle !== "function" || !mod.name) throw new Error("it must export default { name, title, scan, settle }");
      out.push({ file: f, name: String(mod.name), title: mod.title || mod.name, from: mod.from || null, target: mod.target || null, mod });
    } catch (e) {
      out.push({ file: f, name: f.replace(/\.js$/, ""), title: f, error: e.message });
    }
  }
  return out;
}

let lastScan = null;
let scanning = null;
export const lastScanResult = () => lastScan;

// One scan: read every enabled market, price it, and (if allowed) open paper trades. Returns what it saw.
export async function scan({ trade = true } = {}) {
  if (scanning) return scanning;
  scanning = (async () => {
    const cfg = config();
    const out = {
      at: new Date().toISOString(),
      ladders: [],
      opened: [],
      notes: [],
      vol: {},
    };
    for (const coin of cfg.coins) {
      let sigma = null;
      try {
        sigma = await realisedVol(coin);
        out.vol[coin] = sigma;
      } catch (e) {
        out.notes.push(
          `${coin.toUpperCase()}: couldn't read recent prices for volatility (${e.message}).`,
        );
        continue;
      }
      if (cfg.markets.kalshi) {
        try {
          const S = (await spot(coin)).price;
          for (const l of await kalshi.ladders(coin, {
            maxHours: cfg.kalshiMaxHours,
          }))
            out.ladders.push(priceLadder(l, { S, sigma: sigma.sigma, cfg }));
        } catch (e) {
          out.notes.push(`Kalshi ${coin.toUpperCase()}: ${e.message}`);
        }
      }
      if (cfg.markets.options) {
        try {
          const ch = await options.chain(coin);
          if (!ch.open)
            out.notes.push(
              `${ch.symbol} options: the US market is closed, so these quotes are from the last session. Paper trades wait for the open.`,
            );
          for (const l of options.ladders(ch, {
            maxDays: cfg.optionsMaxDays,
          })) {
            const p = priceLadder(l, { S: ch.S, sigma: sigma.sigma, cfg });
            if (!ch.open)
              for (const c of p.contracts)
                if (c.signal) {
                  c.signal = false;
                  c.why = "market closed";
                }
            out.ladders.push(p);
          }
        } catch (e) {
          out.notes.push(`${options.UNDERLYINGS[coin]} options: ${e.message}`);
        }
      }
    }
    out.custom = [];
    for (const m of await customStrategies()) {
      const row = { name: m.name, title: m.title, from: m.from, target: m.target, signals: [], error: m.error || null, off: cfg.custom?.[m.name] === false };
      out.custom.push(row);
      if (row.error || row.off) continue;
      try {
        const sigs = (await m.mod.scan({ config: cfg, spot, now: Date.now() / 1000 })) || [];
        row.signals = sigs.map((x) => ({ ...x, edge: Number(x.edge) || 0, cost: Number(x.cost), fair: Number(x.fair) })).filter((x) => x.ticker && Number.isFinite(x.cost) && x.cost > 0 && x.cost < 1 && Number.isFinite(x.closes));
      } catch (e) {
        row.error = e.message;
      }
    }
    if (trade && cfg.running) out.opened = await openTrades(out, cfg);
    lastScan = out;
    return out;
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

async function openTrades(scanOut, cfg) {
  const b = book();
  const atRisk = () => b.open.reduce((s, p) => s + p.stake, 0);
  const today = new Date().toISOString().slice(0, 10);
  const lostToday = b.closed
    .filter((p) => p.settledAt?.startsWith(today))
    .reduce((s, p) => s + p.pnl, 0);
  if (lostToday <= -cfg.dailyLossStop) {
    scanOut.notes.push(
      `Paper loss today is ${lostToday.toFixed(2)}, past the daily stop of ${cfg.dailyLossStop}. No new trades until tomorrow.`,
    );
    return [];
  }
  const live = brokers.armedState().armed;
  const signals = scanOut.ladders
    .flatMap((l) => l.contracts.filter((c) => c.signal).map((c) => ({ l, c })))
    .concat(
      (scanOut.custom || []).flatMap((m) =>
        m.signals
          .filter((x) => x.buy !== false && x.edge >= cfg.minEdge)
          .map((x) => ({
            l: { venue: `custom:${m.name}`, coin: x.coin || null, closes: x.closes, expiry: x.expiry || null, S: x.S ?? null, sigma: x.sigma ?? null, marketVol: null },
            c: { ticker: x.ticker, label: x.label || x.ticker, K: x.K ?? null, w: null, best: { side: x.side || "yes", ask: x.ask ?? x.cost, cost: x.cost, fair: x.fair, edge: x.edge }, legs: null, meta: x.meta ?? null },
          })),
      ),
    )
    .sort((a, z) => z.c.best.edge - a.c.best.edge);
  const opened = [];
  for (const { l, c } of signals) {
    if (opened.length >= cfg.maxNewPerScan) break;
    if (b.open.some((p) => p.ticker === c.ticker)) continue; // one position per contract, never added to
    const sameClose = b.open
      .filter((p) => p.closes === l.closes)
      .reduce((s, p) => s + p.stake, 0);
    if (
      atRisk() + cfg.stake > cfg.maxOpen ||
      sameClose + cfg.stake > cfg.maxPerClose
    )
      continue;
    const s = c.best;
    const units = cfg.stake / s.cost; // contracts on Kalshi; $ of spread width on options
    const pos = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      mode: live ? "live" : "paper",
      openedAt: new Date().toISOString(),
      venue: l.venue,
      coin: l.coin,
      ticker: c.ticker,
      label: c.label,
      side: s.side,
      K: c.K,
      w: c.w ?? null,
      closes: l.closes,
      expiry: l.expiry ?? null,
      price: s.ask,
      cost: s.cost,
      fair: s.fair,
      edge: s.edge,
      units,
      stake: cfg.stake,
      S: l.S,
      sigma: l.sigma,
      marketVol: l.marketVol,
      legs: c.legs?.[s.side] ?? null,
    };
    if (c.meta !== undefined) pos.meta = c.meta;
    if (live && l.venue.startsWith("custom:")) {
      scanOut.notes.push(`${c.label}: plug-in strategies stay on paper. Their live orders need their own broker code.`);
    } else if (live) {
      try {
        const contracts =
          l.venue === "options"
            ? Math.max(1, Math.floor(cfg.stake / (s.ask * 100 * c.w)))
            : Math.max(1, Math.floor(cfg.stake / s.ask));
        pos.order = await brokers.submitLive({
          type: "limit",
          venue: l.venue,
          ticker: c.ticker,
          side: s.side,
          contracts,
          limit: s.ask,
          legs: pos.legs,
        });
      } catch (e) {
        scanOut.notes.push(`Live order for ${c.label} not sent: ${e.message}`);
        journal({ event: "live-refused", ticker: c.ticker, reason: e.message });
        continue;
      }
    }
    b.open.push(pos);
    opened.push(pos);
    journal({ event: "open", ...pos });
  }
  if (opened.length) write("book.json", b);
  return opened;
}

// Settle positions whose market has ended. Kalshi publishes a result; options settle on the ETF's close.
export async function settle() {
  const b = book();
  const now = Date.now() / 1000;
  let changed = false;
  for (const p of [...b.open]) {
    if (p.closes > now - 120) continue;
    let paid = null;
    try {
      if (p.venue.startsWith("custom:")) {
        const m = (await customStrategies()).find((x) => `custom:${x.name}` === p.venue && x.mod);
        if (m) {
          const v = await m.mod.settle(p);
          if (v !== null && v !== undefined && Number.isFinite(Number(v))) paid = Math.min(Math.max(Number(v), 0), 1);
        }
      } else if (p.venue === "kalshi") {
        const r = await kalshi.result(p.ticker);
        if (r) paid = r === p.side ? 1 : 0;
      } else if (p.venue === "options" && now > p.closes + 1800) {
        const close = await options.closeOn(p.coin, p.expiry);
        if (close) {
          paid = options.payout(p.side, p.K, p.w, close);
          p.settlePrice = close;
        }
      }
    } catch {
      /* try next time */
    }
    if (paid === null) continue;
    const back = p.units * paid;
    Object.assign(p, {
      paid,
      back,
      pnl: back - p.stake,
      settledAt: new Date().toISOString(),
    });
    b.open = b.open.filter((x) => x.id !== p.id);
    b.closed.push(p);
    journal({ event: "settle", id: p.id, ticker: p.ticker, paid, pnl: p.pnl });
    changed = true;
  }
  if (changed) write("book.json", b);
  return b;
}

export function stats() {
  const b = book();
  const pnl = b.closed.reduce((s, p) => s + p.pnl, 0);
  const staked = b.closed.reduce((s, p) => s + p.stake, 0);
  const won = b.closed.filter((p) => p.pnl > 0).length;
  const expected = b.closed.reduce((s, p) => s + p.edge * p.units, 0);
  return {
    open: b.open.length,
    atRisk: b.open.reduce((s, p) => s + p.stake, 0),
    closed: b.closed.length,
    won,
    pnl,
    staked,
    ret: staked ? pnl / staked : null,
    expectedPnl: expected,
  };
}

// The loop the server runs: scan every few minutes, settle as markets end.
let timer = null;
export function startLoop(log = () => {}) {
  if (timer) return;
  const tick = async () => {
    const cfg = config();
    try {
      await settle();
      if (cfg.running) {
        const r = await scan();
        if (r.opened.length)
          log(
            `Paper: opened ${r.opened.map((p) => `${p.side} ${p.label}`).join("; ")}`,
          );
      }
    } catch (e) {
      log(`Strategy scan failed: ${e.message}`);
    }
    timer = setTimeout(tick, Math.max(1, cfg.everyMinutes) * 60e3);
    timer.unref?.();
  };
  timer = setTimeout(tick, 5000);
  timer.unref?.();
}
export function stopLoop() {
  clearTimeout(timer);
  timer = null;
}
