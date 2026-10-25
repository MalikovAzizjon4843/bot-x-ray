#!/usr/bin/env node
// Bot X-Ray. Node 18+ and nothing else: no npm install, no build step, no account, no API key.
//   node server.js            start on http://localhost:3797 (or the next free port)
//   node server.js --open     start and open your browser
//   PORT=4000 node server.js  pick a port
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relaunchForProxy, proxyNote } from "./lib/proxy.js";
import { DATA } from "./lib/net.js";
import { xray, toText, VIDEO_SAMPLES } from "./lib/xray/index.js";
import { RULE_CHANGES } from "./lib/xray/series.js";
import * as leaderboard from "./lib/leaderboard.js";
import * as live from "./lib/live.js";
import * as engine from "./lib/strategy/engine.js";
import * as brokers from "./lib/brokers/index.js";
import * as mm from "./lib/market-maker.js";
import * as mmFeed from "./lib/mm-feed.js";
import * as lock from "./lib/instance-lock.js";
import { MarketMakerV2 } from "./lib/mm-v2.js";
import { Variants } from "./lib/mm-variants.js";
import { endedWinner } from "./lib/polymarket.js";

// Market-Maker engine: v2 (default) runs on the live feed; v1 is retired and only runs on request.
const MM_ENGINE = process.env.BOTXRAY_MM_ENGINE === "v1" ? "v1" : "v2";
let mm2 = null; // the v2 engine, once the feed is up
let variants = null; // several v2 engines side by side (data/variants.json)

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;
const HOST = process.env.HOST || "127.0.0.1";
const START_PORT = Number(process.env.PORT) || 3797;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// Set when this file runs as the server; tests that import start() can't shut the process down.
let shutdownHook = null;

const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string";
  res.writeHead(status, {
    "Content-Type": isStr ? "text/plain; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isStr ? body : JSON.stringify(body));
}

async function readBody(req, limit = 1e5) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, "Request too large");
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    const b = JSON.parse(text);
    if (b && typeof b === "object" && !Array.isArray(b)) return b;
  } catch {
    /* falls through */
  }
  throw httpError(400, "The request body must be a JSON object");
}

// Only this computer's browser gets in. Writes need a custom header a random website can't add to a
// cross-site request, so no other page can drive the app.
function allowed(req) {
  const host = (req.headers.host || "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.headers["x-bx"] !== "1") return false;
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

function serveStatic(res, rel) {
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, "Forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": rel.startsWith("fonts/")
        ? "public, max-age=86400"
        : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

// X-ray jobs: a wallet can take a few seconds (or longer, the first time for a slow bot), so the screen polls.
const jobs = new Map();
function startJob(wallet, sample) {
  const key = `${String(wallet).toLowerCase()}|${sample}`;
  for (const [id, j] of jobs)
    if (j.key === key && (!j.done || Date.now() - j.finishedAt < 5 * 60e3))
      return id;
  const id = crypto.randomBytes(6).toString("hex");
  const job = {
    key,
    wallet,
    steps: [],
    done: false,
    report: null,
    error: null,
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  xray(wallet, {
    sample,
    progress: (step, msg) => job.steps.push({ step, msg, at: Date.now() }),
  })
    .then((r) => (job.report = r))
    .catch((e) => (job.error = { message: e.message, status: e.status || 500 }))
    .finally(() => {
      job.done = true;
      job.finishedAt = Date.now();
    });
  for (const [k, j] of jobs)
    if (j.done && Date.now() - j.finishedAt > 30 * 60e3) jobs.delete(k);
  return id;
}

async function handle(req, res) {
  if (!allowed(req))
    return send(
      res,
      403,
      "Forbidden: Bot X-Ray only answers to this computer.",
    );
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);
  const q = (k) => url.searchParams.get(k);
  const post = req.method === "POST";
  try {
    if (p === "/api/health")
      return send(res, 200, {
        ok: true,
        app: "bot-x-ray",
        version: VERSION,
        root: ROOT,
        data: DATA,
      });
    if (p === "/api/presets")
      return send(res, 200, {
        mcp: `claude mcp add --scope user bot-x-ray -- node "${path.join(ROOT, "scripts", "mcp.js")}"`,
        wallets: Object.entries(VIDEO_SAMPLES).map(([wallet, v]) => ({
          wallet,
          name: v.name,
        })),
        ruleChanges: RULE_CHANGES,
      });

    if (p === "/api/xray" && post) {
      const b = await readBody(req);
      if (!b.wallet)
        throw httpError(400, "Give a wallet address or a username");
      return send(res, 200, {
        job: startJob(
          String(b.wallet).trim(),
          b.sample === "recent" ? "recent" : "auto",
        ),
      });
    }
    const jm = p.match(/^\/api\/xray\/([0-9a-f]{12})$/);
    if (jm) {
      const j = jobs.get(jm[1]);
      if (!j) throw httpError(404, "That x-ray has expired. Run it again.");
      return send(res, 200, {
        done: j.done,
        steps: j.steps.slice(-6),
        error: j.error,
        report: j.report,
        text: q("text") && j.report ? toText(j.report) : undefined,
      });
    }

    if (p === "/api/leaderboard") {
      const opts = { timePeriod: ["WEEK", "MONTH", "ALL"].includes(q("period")) ? q("period") : "MONTH", limit: q("limit") === "50" ? 50 : 15 };
      const s = leaderboard.state(opts);
      if (!s || (s.finishedAt && Date.now() - Date.parse(s.finishedAt) > 30 * 60e3) || q("refresh")) leaderboard.refresh(opts).catch(() => {});
      return send(res, 200, leaderboard.state(opts) || { status: "Starting", rows: [], ...opts });
    }

    if (p === "/api/live") return send(res, 200, live.state());
    if (p === "/api/live/start" && post) {
      const b = await readBody(req);
      return send(
        res,
        200,
        live.start({
          minutes: Math.min(Math.max(Number(b.minutes) || 20, 1), 120),
        }),
      );
    }
    if (p === "/api/live/stop" && post) return send(res, 200, live.stop());

    if (p === "/api/strategy") {
      const b = engine.book();
      return send(res, 200, {
        config: engine.config(),
        stats: engine.stats(),
        open: b.open,
        closed: b.closed.slice(-50).reverse(),
        scan: engine.lastScanResult(),
        broker: await brokers.status(),
      });
    }
    if (p === "/api/strategy/scan" && post)
      return send(res, 200, await engine.scan());
    if (p === "/api/strategy/config" && post) {
      const b = await readBody(req);
      // The screen can change paper settings. Arming isn't here: it happens only in your own terminal.
      const patch = {};
      if (typeof b.running === "boolean") patch.running = b.running;
      if (Number(b.stake) > 0 && Number(b.stake) <= 1000)
        patch.stake = Number(b.stake);
      if (Number(b.minEdge) >= 0 && Number(b.minEdge) < 0.5)
        patch.minEdge = Number(b.minEdge);
      if (b.markets && typeof b.markets === "object")
        patch.markets = {
          kalshi: Boolean(b.markets.kalshi),
          options: Boolean(b.markets.options),
        };
      return send(res, 200, engine.setConfig(patch));
    }
    if (p === "/api/broker/disarm" && post)
      return send(res, 200, brokers.disarm());
    if (p === "/api/broker/stop" && post)
      return send(res, 200, brokers.engageStop());

    if (p === "/api/shutdown" && post) {
      if (!shutdownHook) throw httpError(501, "Shutdown is only available on the running server");
      send(res, 200, { ok: true, stopping: true, pid: process.pid });
      setImmediate(shutdownHook);
      return;
    }

    if (p === "/api/mm/feed-health") return send(res, 200, mmFeed.health());

    // ── Market-Maker v2 variants (paper) ──
    if (p.startsWith("/api/mm/variants")) {
      if (!variants) throw httpError(503, "Variants need the v2 engine and the feed");
      if (p === "/api/mm/variants") return send(res, 200, { ...variants.status(), feed: mmFeed.health() });
      if (p === "/api/mm/variants/start" && post) return send(res, 200, variants.startAll());
      if (p === "/api/mm/variants/stop" && post) return send(res, 200, variants.stopAll());
      if (p === "/api/mm/variants/reset" && post) {
        const b = await readBody(req);
        if (b.confirm !== "RESET") throw httpError(400, 'Send {"confirm":"RESET"} to reset every variant');
        return send(res, 200, variants.resetAll());
      }
      throw httpError(404, `No such endpoint: ${p}`);
    }

    // ── Market-Maker v2 (paper) ──
    if (p.startsWith("/api/mm/v2/")) {
      if (!mm2) throw httpError(503, MM_ENGINE === "v1" ? "This server runs the v1 engine (BOTXRAY_MM_ENGINE=v1)" : "The feed is off (BOTXRAY_NO_FEED=1 or no WebSocket), so v2 can't run");
      if (p === "/api/mm/v2/status") return send(res, 200, { ...mm2.status(), stats: mm2.stats(), equity: mm2.s.equity.slice(-500) });
      if (p === "/api/mm/v2/cycles") return send(res, 200, mm2.readCycles(Math.min(Number(q("limit")) || 100, 1000)).reverse());
      if (p === "/api/mm/v2/start" && post) return send(res, 200, mm2.start());
      if (p === "/api/mm/v2/stop" && post) return send(res, 200, mm2.stop());
      if (p === "/api/mm/v2/reset" && post) {
        const b = await readBody(req);
        if (b.confirm !== "RESET") throw httpError(400, 'Send {"confirm":"RESET"} to reset v2');
        return send(res, 200, mm2.reset());
      }
      if (p === "/api/mm/v2/config" && post) {
        const b = await readBody(req);
        const cur = mm2.config;
        const patch = {};
        for (const [k, v] of Object.entries(b)) {
          if (!(k in cur)) continue;
          if (k === "strategies" && v && typeof v === "object") patch.strategies = { A: !!v.A, B: !!v.B };
          else if (typeof v === typeof cur[k] && (typeof v !== "number" || Number.isFinite(v))) patch[k] = v;
        }
        try {
          return send(res, 200, mm2.setConfig(patch));
        } catch (e) {
          throw httpError(e.status || 400, e.message);
        }
      }
      throw httpError(404, `No such endpoint: ${p}`);
    }

    // ── Market-Maker v1 (retired: results invalid) ──
    if (p === "/api/mm/status") return send(res, 200, { ...mm.state(), engine: "v1", invalid: true, activeEngine: MM_ENGINE });
    if (p === "/api/mm/toggle" && post) return send(res, 200, mm.toggle());
    if (p === "/api/mm/config" && post) {
      const b = await readBody(req);
      const patch = {};
      if (typeof b.orderSizeUsd === "number" && b.orderSizeUsd > 0 && b.orderSizeUsd <= 500) patch.orderSizeUsd = b.orderSizeUsd;
      if (typeof b.minSpreadCents === "number" && b.minSpreadCents >= 0) patch.minSpreadCents = b.minSpreadCents;
      if (typeof b.maxOpenMarkets === "number" && b.maxOpenMarkets >= 1) patch.maxOpenMarkets = Math.min(b.maxOpenMarkets, 20);
      if (Array.isArray(b.categories)) patch.categories = b.categories.filter(c => ["crypto","sports"].includes(c));
      if (typeof b.maxHoldSeconds === "number") patch.maxHoldSeconds = Math.max(30, Math.min(b.maxHoldSeconds, 600));
      if (typeof b.stopLossCents === "number") patch.stopLossCents = Math.max(1, Math.min(b.stopLossCents, 20));
      return send(res, 200, mm.setConfig(patch));
    }
    if (p === "/api/mm/reset" && post) return send(res, 200, mm.reset());
    if (p === "/api/mm/scan-once" && post) return send(res, 200, await mm.scanOnce());

    if (p.startsWith("/api/strategy-doc/")) {
      const docName = path.basename(p.replace("/api/strategy-doc/", "")).replace(/\.md$/, "");
      const lang = q("lang") === "uz" ? "uz" : "en";
      const uzPath = path.join(ROOT, "strategies", `${docName}-uz.md`);
      const enPath = path.join(ROOT, "strategies", `${docName}.md`);
      const target = (lang === "uz" && fs.existsSync(uzPath)) ? uzPath : (fs.existsSync(enPath) ? enPath : null);
      if (!target) throw httpError(404, "Strategy document not found");
      const content = fs.readFileSync(target, "utf8");
      return send(res, 200, { name: docName, lang, content });
    }

    if (p.startsWith("/api/")) throw httpError(404, `No such endpoint: ${p}`);
    return serveStatic(res, p === "/" ? "index.html" : p.slice(1));
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || String(e) });
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
    c.on("error", () => {});
    c.unref();
  } catch {
    /* no desktop: the address is printed */
  }
}

export function start(port = START_PORT, tries = 20) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) =>
      handle(req, res).catch(
        (e) => !res.headersSent && send(res, 500, { error: e.message }),
      ),
    );
    server.once("error", (e) =>
      e.code === "EADDRINUSE" && tries > 0
        ? resolve(start(port + 1, tries - 1))
        : reject(e),
    );
    server.listen(port, HOST, () => resolve({ server, port }));
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const relaunched = isMain ? relaunchForProxy() : null;
if (relaunched) process.exit(await relaunched);
if (isMain) {
  // One server per data folder, or two copies write the same files.
  const got = lock.acquire(DATA, { root: ROOT });
  if (!got.ok) {
    console.error(`
  Bot X-Ray is already running from this data folder (pid ${got.holder?.pid}, port ${got.holder?.port ?? "?"}).
  Stop it with: node scripts/stop.js
`);
    process.exit(1);
  }
  process.on("exit", () => lock.release(DATA));
  const { server, port } = await start();
  lock.update(DATA, { port });
  const stamp = (m) => console.log(`  ${new Date().toISOString().slice(11, 19)} ${m}`);
  let stopping = false;
  shutdownHook = async () => {
    if (stopping) return;
    stopping = true;
    stamp("shutting down");
    setTimeout(() => process.exit(0), 5000).unref();
    server.close();
    server.closeAllConnections?.();
    try {
      mm2?.suspend();
      variants?.suspendAll();
    } catch (e) {
      stamp(`mm-v2: couldn't save on shutdown (${e.message})`);
    }
    await mmFeed.stop().catch(() => {});
    process.exit(0);
  };
  const url = `http://localhost:${port}`;
  if (process.env.BOTXRAY_NO_STRATEGY !== "1")
    engine.startLoop((m) =>
      console.log(`  ${new Date().toISOString().slice(11, 19)} ${m}`),
    );
  // v1 Market-Maker is retired (its fill model was wrong); data/mm-paper.json stays as an archive.
  // BOTXRAY_MM_ENGINE=v1 still runs the old loop instead of v2.
  if (MM_ENGINE === "v1") mm.startLoop(stamp);
  const feed = mmFeed.start({ log: stamp });
  if (feed && MM_ENGINE === "v2") {
    mm2 = new MarketMakerV2({ pool: feed.pool, markets: () => feed.rotator.markets(), dataDir: DATA, log: stamp, resolve: (slug) => endedWinner(slug) });
    mmFeed.setEngineMetrics(() => mm2.fm?.metrics() || null);
    // it was running when the server stopped: carry on
    if (mm2.s.running) mm2.start();
    variants = new Variants({ pool: feed.pool, markets: () => feed.rotator.markets(), dataDir: DATA, log: stamp, resolve: (slug) => endedWinner(slug) });
    variants.resume();
  }
  console.log(
    `\n  Bot X-Ray ${VERSION} is running\n\n  Open:  ${url}\n  Stop:  Ctrl+C\n  Data:  ${DATA}\n`,
  );
  if (proxyNote()) console.log(`  ${proxyNote()}\n`);
  if (process.argv.includes("--open")) openBrowser(url);
  process.on("SIGINT", shutdownHook);
  process.on("SIGTERM", shutdownHook);
}
