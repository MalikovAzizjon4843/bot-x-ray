// Fetching JSON from public APIs, with a timeout, a couple of retries and an optional disk cache.
// Nothing here needs a key or an account.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DATA = process.env.BOTXRAY_DATA || path.join(ROOT, "data");
const CACHE = path.join(DATA, "cache");
const UA = "bot-x-ray/1.0 (+local app; public data only)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FetchError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// GET a URL and parse JSON. Retries on timeouts, 429 and 5xx; a 4xx other than 429 fails at once.
export async function getJSON(
  url,
  { timeout = 20000, retries = 2, headers = {} } = {},
) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(600 * 2 ** (attempt - 1));
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });
      if (r.status === 429 || r.status >= 500) {
        last = new FetchError(`${host(url)} answered ${r.status}`, {
          status: r.status,
          url,
        });
        continue;
      }
      if (!r.ok) {
        let detail = "";
        try {
          detail = (await r.text()).slice(0, 200);
        } catch {
          /* no body */
        }
        throw new FetchError(
          `${host(url)} answered ${r.status}${detail ? `: ${detail}` : ""}`,
          { status: r.status, url },
        );
      }
      return await r.json();
    } catch (e) {
      if (
        e instanceof FetchError &&
        e.status &&
        e.status !== 429 &&
        e.status < 500
      )
        throw e;
      last =
        e instanceof FetchError
          ? e
          : new FetchError(
              `${host(url)} didn't answer (${e.name === "TimeoutError" ? "timed out" : e.cause?.code || e.message})`,
              { url },
            );
    }
  }
  throw last;
}

// Read-through disk cache. ttlMs = Infinity for data that can't change (a settled market, a window in the past).
export async function cached(key, ttlMs, fn) {
  const file = path.join(
    CACHE,
    `${crypto.createHash("sha1").update(key).digest("hex")}.json`,
  );
  try {
    const st = fs.statSync(file);
    if (ttlMs === Infinity || Date.now() - st.mtimeMs < ttlMs)
      return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* not cached yet */
  }
  const value = await fn();
  if (value !== undefined && value !== null) {
    try {
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(value));
      fs.renameSync(file + ".tmp", file);
    } catch {
      /* a read-only folder still works, just slower */
    }
  }
  return value;
}

// Run fn over items with at most `n` in flight.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
