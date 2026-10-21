// The broker connector: paper until a real adapter is connected and armed in your own terminal.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BOTXRAY_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bx-broker-"));
const brokers = await import("../lib/brokers/index.js");
const stub = (await import("../lib/brokers/stub.js")).default;

test("the stub can't trade and says how to connect a broker", async () => {
  assert.equal(stub.live, false);
  await assert.rejects(() => stub.submit({}, { type: "limit" }), /ask Claude/);
});

test("status never carries the keys themselves", async () => {
  process.env.BOTXRAY_BROKER = "stub";
  process.env.BOTXRAY_KEY_ID = "id-123";
  process.env.BOTXRAY_SECRET = "secret-xyz";
  const s = await brokers.status();
  assert.equal(s.keysFound, true);
  assert.ok(!JSON.stringify(s).includes("secret-xyz"));
  assert.ok(!JSON.stringify(s).includes("id-123"));
  delete process.env.BOTXRAY_KEY_ID;
  delete process.env.BOTXRAY_SECRET;
});

test("arming refuses without a live adapter, and live orders refuse when not armed", async () => {
  await assert.rejects(
    () => brokers.arm({ confirm: "ARM STUB FOR LIVE ORDERS" }),
    /paper only/,
  );
  assert.equal(brokers.armedState().armed, false);
  await assert.rejects(
    () => brokers.submitLive({ type: "limit" }),
    /Not armed/,
  );
});

test("arming a live adapter needs live keys and the exact words, and the stop disarms it", async () => {
  const dir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "lib",
    "brokers",
  );
  const file = path.join(dir, "testbroker.js");
  fs.writeFileSync(
    file,
    `export default { name: "testbroker", title: "Test", live: true, async account() { return { ok: true, mode: "live" }; }, async submit(k, o) { return { id: "1", status: "accepted", o }; } };`,
  );
  try {
    process.env.BOTXRAY_BROKER = "testbroker";
    process.env.BOTXRAY_KEY_ID = "k";
    process.env.BOTXRAY_SECRET = "s";
    process.env.BOTXRAY_KEY_MODE = "paper";
    await assert.rejects(
      () => brokers.arm({ confirm: "ARM TESTBROKER FOR LIVE ORDERS" }),
      /paper keys/,
    );
    process.env.BOTXRAY_KEY_MODE = "live";
    await assert.rejects(() => brokers.arm({ confirm: "yes" }), /Type exactly/);
    const rec = await brokers.arm({
      confirm: "ARM TESTBROKER FOR LIVE ORDERS",
    });
    assert.equal(rec.broker, "testbroker");
    await assert.rejects(
      () => brokers.submitLive({ type: "market" }),
      /limit orders/,
    );
    assert.equal(
      (await brokers.submitLive({ type: "limit", ticker: "X" })).status,
      "accepted",
    );
    brokers.engageStop();
    assert.equal(brokers.armedState().armed, false);
    await assert.rejects(
      () => brokers.submitLive({ type: "limit" }),
      /Not armed/,
    );
  } finally {
    fs.rmSync(file);
    for (const k of [
      "BOTXRAY_BROKER",
      "BOTXRAY_KEY_ID",
      "BOTXRAY_SECRET",
      "BOTXRAY_KEY_MODE",
    ])
      delete process.env[k];
  }
});
