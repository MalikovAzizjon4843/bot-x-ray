#!/usr/bin/env node
// Stop the Bot X-Ray running from this folder. --all stops every copy on this computer.
// It asks the server to shut down (/api/shutdown) and reports "Stopped" only once it has gone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = process.env.BOTXRAY_DATA || path.join(root, 'data');
const all = process.argv.includes('--all');
const same = (a, b) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async (p) => {
  try {
    return await (await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(700) })).json();
  } catch {
    return null;
  }
};

const first = Number(process.env.PORT) || 3797;
const ports = new Set();
try {
  const l = JSON.parse(fs.readFileSync(path.join(data, '.lock'), 'utf8'));
  if (l.port) ports.add(l.port);
} catch { /* no lock */ }
for (let p = first; p < first + 21; p++) ports.add(p);

let stopped = 0;
let failed = 0;
for (const p of ports) {
  const h = await health(p);
  if (!h || h.app !== 'bot-x-ray' || (!all && !same(h.root, root))) continue;
  let r = null;
  try {
    r = await fetch(`http://127.0.0.1:${p}/api/shutdown`, { method: 'POST', headers: { 'x-bx': '1' }, signal: AbortSignal.timeout(3000) });
  } catch { /* it may close the connection as it goes */ }
  if (r && !r.ok) {
    console.log(`Bot X-Ray on port ${p} refused to shut down (${r.status}). It may be an older version: close its window or press Ctrl+C there.`);
    failed++;
    continue;
  }
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    await sleep(250);
    gone = !(await health(p));
  }
  if (gone) {
    console.log(`Stopped Bot X-Ray on port ${p}`);
    stopped++;
  } else {
    console.log(`Bot X-Ray on port ${p} is still answering after 10 s.`);
    failed++;
  }
}
if (!stopped && !failed) console.log('Bot X-Ray was not running from this folder.');
process.exit(failed ? 1 : 0);
