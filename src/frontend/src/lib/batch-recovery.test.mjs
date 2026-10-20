import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("./batch-recovery.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const {
  clearPendingBatch,
  fingerprintBatchIntent,
  readPendingBatch,
  savePendingBatch,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("uncertain queue recovery survives reload with no stored phone numbers", async () => {
  const storage = memoryStorage();
  const intent = '{"phones":["+14155550123"],"maxCallSeconds":180}';
  const request = {
    idempotencyKey: "web-batch-original",
    fingerprint: await fingerprintBatchIntent(intent),
    createdAt: 1234,
  };
  assert.equal(await fingerprintBatchIntent(intent), request.fingerprint);
  assert.notEqual(
    await fingerprintBatchIntent(`${intent} `),
    request.fingerprint,
  );
  assert.equal(savePendingBatch(storage, "owner-a", request), true);
  assert.deepEqual(readPendingBatch(storage, "owner-a"), request);
  assert.doesNotMatch([...storage.values.values()].join(""), /14155550123/);
  assert.equal(readPendingBatch(storage, "owner-b"), null);
});

test("a different intent cannot overwrite an unresolved request", () => {
  const storage = memoryStorage();
  const original = {
    idempotencyKey: "web-batch-original",
    fingerprint: "a".repeat(64),
    createdAt: 1234,
  };
  const different = {
    ...original,
    idempotencyKey: "web-batch-different",
    fingerprint: "b".repeat(64),
  };
  assert.equal(savePendingBatch(storage, "owner-a", original), true);
  assert.equal(savePendingBatch(storage, "owner-a", different), false);
  assert.equal(
    savePendingBatch(storage, "owner-a", {
      ...original,
      fingerprint: different.fingerprint,
    }),
    false,
  );
  assert.deepEqual(readPendingBatch(storage, "owner-a"), original);
  assert.equal(
    clearPendingBatch(storage, "owner-a", different.idempotencyKey),
    false,
  );
  assert.equal(
    clearPendingBatch(storage, "owner-a", original.idempotencyKey),
    true,
  );
  assert.equal(savePendingBatch(storage, "owner-a", different), true);
});

test("storage failures and malformed recovery records fail closed", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  const request = {
    idempotencyKey: "web-batch-original",
    fingerprint: "a".repeat(64),
    createdAt: 1234,
  };
  assert.equal(readPendingBatch(blocked, "owner-a"), null);
  assert.equal(savePendingBatch(blocked, "owner-a", request), false);
  assert.equal(savePendingBatch(null, "owner-a", request), false);
  const storage = memoryStorage();
  storage.setItem(
    "voicecall.pendingBatch:owner-a",
    '{"idempotencyKey":"bad","fingerprint":"raw phone","createdAt":0}',
  );
  assert.equal(readPendingBatch(storage, "owner-a"), null);
});
