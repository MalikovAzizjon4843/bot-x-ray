// The server answers only this computer, needs the custom header for writes, and the MCP speaks JSON-RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.BOTXRAY_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bx-server-"));
const { start } = await import("../server.js");
const { handle, TOOLS } = await import("../scripts/mcp.js");

const req = (port, p, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, path: p, method, headers },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      },
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });

test("server: health, page, host check and write header", async () => {
  const { server, port } = await start(4590 + Math.floor(Math.random() * 50));
  try {
    const h = JSON.parse((await req(port, "/api/health")).body);
    assert.equal(h.app, "bot-x-ray");
    assert.match((await req(port, "/")).body, /Bot X-Ray/);
    assert.equal(
      (await req(port, "/api/health", { headers: { host: "evil.example" } }))
        .status,
      403,
    );
    assert.equal(
      (await req(port, "/api/live/stop", { method: "POST" })).status,
      403,
    );
    assert.equal(
      (
        await req(port, "/api/live/stop", {
          method: "POST",
          headers: { "x-bx": "1" },
        })
      ).status,
      200,
    );
    assert.equal((await req(port, "/../package.json")).status, 404);
    const s = JSON.parse((await req(port, "/api/strategy")).body);
    assert.equal(s.broker.armed, false);
    assert.equal((await req(port, "/api/nope")).status, 404);
  } finally {
    server.close();
  }
});

test("mcp: initialize, list tools, unknown tool", async () => {
  const init = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(init.result.serverInfo.name, "bot-x-ray");
  const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    Object.keys(TOOLS),
  );
  assert.ok(list.result.tools.every((t) => !/arm/i.test(t.name)));
  const bad = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "nope" },
  });
  assert.equal(bad.error.code, -32602);
  assert.equal(
    await handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
    null,
  );
});
