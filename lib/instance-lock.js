// One server per data folder: data/.lock holds {pid, port, root, startedAt}. A live pid there means another
// copy is running; a dead pid's lock is taken over.
import fs from "node:fs";
import path from "node:path";

export const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

export function readLock(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".lock"), "utf8"));
  } catch {
    return null;
  }
}

// → { ok: true } or { ok: false, holder }
export function acquire(dir, info = {}) {
  const file = path.join(dir, ".lock");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, port: null, startedAt: new Date().toISOString(), ...info }));
      fs.closeSync(fd);
      return { ok: true };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const holder = readLock(dir);
      if (holder && holder.pid !== process.pid && alive(holder.pid)) return { ok: false, holder };
      try {
        fs.unlinkSync(file);
      } catch {
        /* someone else took it over; the retry decides */
      }
    }
  }
  return { ok: false, holder: readLock(dir) };
}

export function update(dir, patch) {
  const cur = readLock(dir);
  if (!cur || cur.pid !== process.pid) return;
  fs.writeFileSync(path.join(dir, ".lock"), JSON.stringify({ ...cur, ...patch }));
}

export function release(dir) {
  const cur = readLock(dir);
  if (cur && cur.pid !== process.pid) return;
  try {
    fs.unlinkSync(path.join(dir, ".lock"));
  } catch {
    /* already gone */
  }
}
