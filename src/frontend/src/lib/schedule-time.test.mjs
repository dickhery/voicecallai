import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(
  await readFile(new URL("./schedule-time.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const {
  addDaysYmd,
  businessDayRangeMs,
  draftFromSettings,
  formatBusinessLocal,
  formatOffsetLabel,
  settingsFromDraft,
  timeToMinutes,
  weekYmds,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const mondayNineUtc = Date.UTC(2026, 9, 26, 9, 0, 0);

test("business-local labels follow the saved offset", () => {
  assert.equal(
    formatBusinessLocal(mondayNineUtc, 0),
    "Monday, Oct 26, 9:00 AM",
  );
  assert.equal(
    formatBusinessLocal(Date.UTC(2026, 9, 26, 14, 0, 0), -300),
    "Monday, Oct 26, 9:00 AM",
  );
  assert.equal(formatOffsetLabel(-300), "UTC-5:00");
  assert.equal(formatOffsetLabel(330), "UTC+5:30");
});

test("a business day range uses local midnight and the Sunday week", () => {
  const range = businessDayRangeMs("2026-10-26", -300);
  assert.equal(range.fromMs, Date.UTC(2026, 9, 26, 5, 0, 0));
  assert.equal(range.toMs - range.fromMs, 86_400_000);
  assert.deepEqual(weekYmds("2026-10-28"), [
    "2026-10-25",
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
  ]);
  assert.equal(addDaysYmd("2026-10-31", 1), "2026-11-01");
});

test("office-hour drafts accept a midnight close and reject a short day", () => {
  assert.equal(timeToMinutes("24:00"), 1440);
  assert.equal(timeToMinutes("24:15"), null);
  const saved = draftFromSettings({
    enabled: false,
    timezoneOffsetMinutes: -300,
    slotMinutes: 30,
    minNoticeMinutes: 60,
    bookingWindowDays: 14,
    serviceLabel: "Visit",
    bookingNotes: "",
    weeklyHours: Array.from({ length: 7 }, (_, day) =>
      day === 0 || day === 6
        ? { closed: true, openMinute: 0, closeMinute: 0 }
        : { closed: false, openMinute: 540, closeMinute: 1020 },
    ),
  });
  assert.equal(saved.weeklyHours[1].open, "09:00");
  assert.equal(saved.weeklyHours[0].closed, true);
  const closedMonday = {
    ...saved,
    weeklyHours: saved.weeklyHours.map((day, index) =>
      index === 1 ? { ...day, close: "09:15" } : day,
    ),
  };
  assert.match(settingsFromDraft(closedMonday).error, /Monday/);
  const midnight = {
    ...saved,
    weeklyHours: saved.weeklyHours.map((day, index) =>
      index === 1 ? { ...day, close: "24:00" } : day,
    ),
  };
  assert.equal(settingsFromDraft(midnight).ok.weeklyHours[1].closeMinute, 1440);
});
