#!/usr/bin/env node
// One command that proves an install works: offline tests, data-source doctor, live smoke test.
//   node scripts/check.js
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  ['Offline tests', [process.execPath, path.join(root, 'scripts', 'test.js')]],
  ['Data sources', [process.execPath, path.join(root, 'scripts', 'doctor.js')]],
  ['Live smoke test', [process.execPath, path.join(root, 'scripts', 'smoke.js')]],
];
const results = [];
for (const [name, [cmd, ...args]] of steps) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  results.push([name, r.status === 0]);
}
console.log('\n=== Summary ===');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
const ready = results.every(([, ok]) => ok);
console.log(ready ? '\nREADY. Start it with: node scripts/launch.js' : '\nNOT READY. Read the FAIL output above.');
process.exit(ready ? 0 : 1);
