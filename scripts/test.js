#!/usr/bin/env node
// Runs every test/*.test.js except the live-network suite, on Node 18 and up (no glob support needed).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync(new URL("../test/", import.meta.url)).filter((f) => f.endsWith(".test.js") && f !== "live.test.js").map((f) => `test/${f}`);
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
