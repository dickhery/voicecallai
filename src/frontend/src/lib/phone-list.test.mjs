import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const toModuleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  ).toString("base64")}`;
const emergency = toModuleUrl(
  await readFile(new URL("./emergency-numbers.ts", import.meta.url), "utf8"),
);
const source = (
  await readFile(new URL("./phone-list.ts", import.meta.url), "utf8")
).replace('"./emergency-numbers"', JSON.stringify(emergency));
const { parsePhoneList, MAX_PHONE_LIST_BYTES } = await import(
  toModuleUrl(source)
);

test("accepts explicit international numbers and removes duplicate formatted versions", () => {
  const result = parsePhoneList(
    "+1 (415) 555-0123\n+442079460123\n+14155550123",
  );
  assert.deepEqual(result.phones, ["+14155550123", "+442079460123"]);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.issues, []);
});

test("extracts the phone column from quoted CSV with commas in names", () => {
  const result = parsePhoneList(
    '\uFEFFname,phone,note\r\n"Doe, Jane",+14155550123,"say ""hello"""\r\nOther,+442079460123,',
  );
  assert.deepEqual(result.phones, ["+14155550123", "+442079460123"]);
  assert.equal(result.error, null);
});

test("accepts tabs and headerless comma separated numbers", () => {
  assert.deepEqual(
    parsePhoneList("Name\tPhone Number\nJane\t+14155550123").phones,
    ["+14155550123"],
  );
  assert.deepEqual(
    parsePhoneList("\nName\tPhone Number\nJane\t+14155550123").phones,
    ["+14155550123"],
  );
  assert.deepEqual(parsePhoneList("+14155550123,+442079460123").phones, [
    "+14155550123",
    "+442079460123",
  ]);
});

test("never guesses a country, strips extensions, or interprets formulas", () => {
  const result = parsePhoneList(
    '4155550123\n+14155550123 ext 4\n="+14155550123"\n+14155550123',
  );
  // Malformed CSV/formula input fails closed, without starting a partial list.
  assert.ok(result.error);
  const withoutFormula = parsePhoneList(
    "4155550123\n+14155550123 ext 4\n+14155550123",
  );
  assert.equal(withoutFormula.issues.length, 2);
  assert.deepEqual(withoutFormula.phones, ["+14155550123"]);
});

test("blocks emergency destinations and reports original row numbers", () => {
  const result = parsePhoneList("phone\n\n+19115550123\ninvalid\n+14155550123");
  assert.equal(result.issues[0].row, 3);
  assert.match(result.issues[0].reason, /blocked/);
  assert.equal(result.issues[1].row, 4);
  assert.deepEqual(result.phones, ["+14155550123"]);
});

test("requires a phone header for multi-column data with labels", () => {
  assert.match(parsePhoneList("Jane,+14155550123").error, /header/);
  assert.match(
    parsePhoneList("phone,number\n+14155550123,+442079460123").error,
    /multiple/,
  );
});

test("reports missing phone cells and malformed CSV", () => {
  assert.equal(parsePhoneList("name,phone\nJane,").issues.length, 1);
  assert.match(parsePhoneList('phone\n"+14155550123').error, /closing quote/);
  assert.match(parsePhoneList('phone\n"+14155550123"x').error, /after a quote/);
});

test("enforces list and input bounds without silently truncating numbers", () => {
  const phones = Array.from(
    { length: 101 },
    (_, index) => `+1415555${String(1000 + index)}`,
  );
  const result = parsePhoneList(phones.join("\n"));
  assert.equal(result.phones.length, 101);
  assert.match(result.error, /at most 100/);
  assert.match(
    parsePhoneList(" ".repeat(MAX_PHONE_LIST_BYTES + 1)).error,
    /64 KB/,
  );
});
