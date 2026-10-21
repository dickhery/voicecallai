import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("./call-session.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { getCallSessionPhase } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("dispatch alone does not claim an answered phone or start a conversation", () => {
  assert.equal(
    getCallSessionPhase({ callSid: "CA-dispatched", status: "active" }),
    "connecting",
  );
  assert.equal(
    getCallSessionPhase({ callSid: "CA-dispatched", status: "ringing" }),
    "connecting",
  );
  assert.equal(getCallSessionPhase({ queued: true }), "queued");
  assert.equal(
    getCallSessionPhase({ callSid: "CA-connected", billingStartedAt: 123 }),
    "in_call",
  );
  assert.equal(
    getCallSessionPhase({ callSid: "CA-connected", status: "in-progress" }),
    "in_call",
  );
});

test("failed terminal transport states override an existing call ID and billing time", () => {
  for (const status of ["failed", "busy", "no-answer"]) {
    assert.equal(
      getCallSessionPhase({
        callSid: "CA-ended",
        billingStartedAt: 123,
        status,
      }),
      "error",
    );
  }
  assert.equal(getCallSessionPhase({ status: "completed" }), "completed");
  assert.equal(getCallSessionPhase({ status: "canceled" }), "completed");
});
