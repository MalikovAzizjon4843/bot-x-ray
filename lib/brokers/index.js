// The broker connector. Bot X-Ray runs on paper until you connect your own broker and arm it yourself.
//
// How it fits together (the same pattern PTQ uses):
// - Your keys live only in environment variables or the .env file in this folder. They're never written to
//   data/, never sent to the browser and never logged. The screens only learn whether keys were found.
// - Arming happens only in your own terminal (`node scripts/arm.js`), behind a typed confirmation, and lasts 24
//   hours. The app and Claude can disarm or stop, never arm.
// - Paper keys can't arm for live orders and live keys can't run as paper: a mismatch is refused.
// - Every order is a limit order inside the risk limits in data/strategy/config.json.
//
// Out of the box the only adapter is the stub: it reads your keys and tells you what's needed, and it refuses to
// place orders because no broker is wired in yet. To connect yours, ask Claude: "connect Bot X-Ray to my <broker>
// account". It writes lib/brokers/<name>.js from lib/brokers/TEMPLATE.md.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { ROOT, DATA } from "../net.js";
import stub from "./stub.js";

const ARMED = () => path.join(DATA, "strategy", "armed.json");
const KILL = () => path.join(DATA, "strategy", "STOP");

// Keys: BOTXRAY_BROKER, BOTXRAY_KEY_ID, BOTXRAY_SECRET (and BOTXRAY_KEY_MODE=paper|live), from the environment
// or from ./.env. Returned only to the adapter; nothing else in the app reads the values.
export function readKeys(env = process.env) {
  const out = {};
  try {
    for (const line of fs
      .readFileSync(path.join(ROOT, ".env"), "utf8")
      .split(/\r?\n/)) {
      const m = line.match(
        /^\s*(BOTXRAY_[A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/,
      );
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* no .env file */
  }
  for (const k of Object.keys(env))
    if (k.startsWith("BOTXRAY_")) out[k] = env[k];
  return {
    broker: (out.BOTXRAY_BROKER || "").toLowerCase() || null,
    keyId: out.BOTXRAY_KEY_ID || null,
    secret: out.BOTXRAY_SECRET || null,
    keyMode:
      (out.BOTXRAY_KEY_MODE || "").toLowerCase() === "live"
        ? "live"
        : (out.BOTXRAY_KEY_MODE || "").toLowerCase() === "paper"
          ? "paper"
          : null,
  };
}

// Adapters in lib/brokers/<name>.js. The stub is always there.
export async function adapter(name) {
  if (!name || name === "stub") return stub;
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error(`"${name}" isn't a valid broker name`);
  const file = path.join(ROOT, "lib", "brokers", `${name}.js`);
  if (!fs.existsSync(file)) return stub;
  return (await import(pathToFileURL(file).href)).default;
}

// What the screens and Claude may know: never the keys themselves.
export async function status() {
  const keys = readKeys();
  const a = await adapter(keys.broker);
  const armed = armedState();
  return {
    broker: keys.broker || "none",
    adapter: a.name,
    adapterLive: Boolean(a.live),
    keysFound: Boolean(keys.keyId && keys.secret),
    keyMode: keys.keyMode,
    armed: armed.armed,
    armedUntil: armed.until,
    stopped: fs.existsSync(KILL()),
    note: a.live ? `${a.title} is connected.` : a.note,
  };
}

export function armedState() {
  try {
    const a = JSON.parse(fs.readFileSync(ARMED(), "utf8"));
    if (Date.parse(a.expiresAt) > Date.now())
      return {
        armed: true,
        until: a.expiresAt,
        broker: a.broker,
        token: a.token,
      };
  } catch {
    /* not armed */
  }
  return { armed: false, until: null };
}

// Called only from scripts/arm.js, after you've typed the confirmation in your own terminal.
export async function arm({ confirm, hours = 24 } = {}) {
  const keys = readKeys();
  const a = await adapter(keys.broker);
  const want = `ARM ${String(a.name).toUpperCase()} FOR LIVE ORDERS`;
  if (!a.live) throw new Error(a.note);
  if (!keys.keyId || !keys.secret)
    throw new Error(
      "No broker keys found. Put BOTXRAY_KEY_ID and BOTXRAY_SECRET in the .env file in this folder.",
    );
  if (keys.keyMode !== "live")
    throw new Error(
      "These keys are marked as paper keys (BOTXRAY_KEY_MODE). Paper keys can't arm live orders.",
    );
  if (confirm !== want) throw new Error(`Type exactly: ${want}`);
  const check = await a.account(keys);
  if (check.mode && check.mode !== "live")
    throw new Error(
      `${a.title} says these keys are for its ${check.mode} account, not live. Nothing was armed.`,
    );
  fs.mkdirSync(path.dirname(ARMED()), { recursive: true });
  const rec = {
    broker: a.name,
    armedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + hours * 3600e3).toISOString(),
    token: crypto.randomBytes(16).toString("hex"),
  };
  fs.writeFileSync(ARMED(), JSON.stringify(rec, null, 1));
  try {
    fs.rmSync(KILL());
  } catch {
    /* not stopped */
  }
  return rec;
}

export function disarm() {
  try {
    fs.rmSync(ARMED());
  } catch {
    /* already */
  }
  return { armed: false };
}

// The stop button: disarms and blocks new orders until you remove data/strategy/STOP (arm.js does that).
export function engageStop() {
  disarm();
  fs.mkdirSync(path.dirname(KILL()), { recursive: true });
  fs.writeFileSync(KILL(), new Date().toISOString());
  return { stopped: true };
}

// Send one order. Only reached when armed; the engine has already applied the risk limits.
export async function submitLive(order) {
  const st = armedState();
  if (!st.armed)
    throw new Error(
      "Not armed. Live orders need `node scripts/arm.js` in your own terminal.",
    );
  if (fs.existsSync(KILL()))
    throw new Error("The stop is on. Nothing was sent.");
  const keys = readKeys();
  const a = await adapter(keys.broker);
  if (!a.live || a.name !== st.broker)
    throw new Error(
      "The armed broker isn't connected any more. Nothing was sent.",
    );
  if (order.type !== "limit")
    throw new Error("Bot X-Ray only sends limit orders.");
  return a.submit(keys, order);
}
