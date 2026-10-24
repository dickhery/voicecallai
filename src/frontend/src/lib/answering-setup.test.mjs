import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("./answering-setup.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { normalizeAnsweringPhoneNumber, isValidAnsweringPhoneNumber } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );

test("Twilio number input accepts display formatting without guessing a country", () => {
  assert.equal(
    normalizeAnsweringPhoneNumber(" +44 (20) 7946-0958 "),
    "+442079460958",
  );
  assert.equal(isValidAnsweringPhoneNumber("+1 (415) 555-0123"), true);
  assert.equal(normalizeAnsweringPhoneNumber("415-555-0123"), "4155550123");
  assert.equal(isValidAnsweringPhoneNumber("415-555-0123"), false);
});

test("invalid or ambiguous Twilio identifiers stay invalid instead of routing elsewhere", () => {
  for (const value of [
    "",
    "+0123456789",
    "++14155550123",
    "+14155550123 ext 2",
    "+14155550123/anything",
    "+1234567890123456",
    "phone:+14155550123",
  ]) {
    assert.equal(isValidAnsweringPhoneNumber(value), false, value);
  }
});
