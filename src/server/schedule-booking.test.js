import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { CALL_LIFECYCLE_INSTRUCTIONS, CALL_LIFECYCLE_TOOLS } from "./call-lifecycle.js";
import { KEYPAD_INSTRUCTIONS, KEYPAD_TOOL } from "./phone-keypad.js";
import {
  BOOK_APPOINTMENT_TOOL,
  LIST_OPEN_TIMES_TOOL,
  bookingGuard,
  buildScheduleInstructions,
  clampOpenTimesRange,
  formatBusinessLocal,
  formatOpenTimes,
  parseBookAppointmentArgs,
  resolveCallerPhone,
} from "./schedule-booking.js";

const mondayNineUtc = Date.UTC(2026, 9, 26, 9, 0, 0);

test("caller ID is used only when it is already E.164", () => {
  assert.deepEqual(resolveCallerPhone("", "+14155550123"), { ok: true, phone: "+14155550123" });
  assert.deepEqual(resolveCallerPhone("+44 20 7946 0958", "unknown"), {
    ok: true,
    phone: "+442079460958",
  });
  assert.equal(resolveCallerPhone("", "unknown").ok, false);
  assert.equal(resolveCallerPhone("4155550123", "+14155550123").ok, false);
});

test("booking args and the one-booking guard refuse a second canister write", () => {
  const parsed = parseBookAppointmentArgs({
    callerName: "  Ada Lovelace ",
    startsAtMs: mondayNineUtc,
    notes: "checkup",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.callerName, "Ada Lovelace");
  assert.equal(parseBookAppointmentArgs({ callerName: "Ada" }).ok, false);
  assert.equal(bookingGuard({ booked: false, inFlight: false }).allow, true);
  assert.equal(bookingGuard({ booked: true }).allow, false);
  assert.equal(bookingGuard({ inFlight: true }).status, "in_progress");
});

test("open-time search stays inside seven days and labels the business clock", () => {
  const now = mondayNineUtc;
  const range = clampOpenTimesRange({}, { bookingWindowDays: 14 }, now);
  assert.equal(range.fromMs, now);
  assert.equal(range.toMs - range.fromMs, 7 * 86_400_000);
  const later = clampOpenTimesRange({ fromMs: now - 86_400_000 }, { bookingWindowDays: 2 }, now);
  assert.equal(later.fromMs, now);
  assert.equal(later.toMs - later.fromMs, 2 * 86_400_000);
  const slots = formatOpenTimes(
    [{ startsAtMs: mondayNineUtc, endsAtMs: mondayNineUtc + 1_800_000 }, { startsAtMs: 1, endsAtMs: 2 }],
    { timezoneOffsetMinutes: 0 },
    1,
  );
  assert.deepEqual(slots, [{
    startsAtMs: mondayNineUtc,
    endsAtMs: mondayNineUtc + 1_800_000,
    localTime: "Monday, Oct 26, 9:00 AM",
  }]);
  assert.equal(formatBusinessLocal(Date.UTC(2026, 9, 26, 14, 0, 0), -300), "Monday, Oct 26, 9:00 AM");
  assert.match(buildScheduleInstructions({ serviceLabel: "Visit", timezoneOffsetMinutes: -300, bookingNotes: "" }), /list_open_times/);
  assert.match(buildScheduleInstructions({ serviceLabel: "Visit", timezoneOffsetMinutes: -300, bookingNotes: "" }), /not reserved/);
});

test("full inbound sessions gain booking tools only when the calendar is enabled", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const start = source.indexOf("function buildXaiSessionUpdate(");
  const end = source.indexOf("function wantsForceOpening", start);
  const context = vm.createContext({
    KEYPAD_TOOL,
    KEYPAD_INSTRUCTIONS,
    CALL_LIFECYCLE_TOOLS,
    CALL_LIFECYCLE_INSTRUCTIONS,
    LIST_OPEN_TIMES_TOOL,
    BOOK_APPOINTMENT_TOOL,
    buildScheduleInstructions,
    CALL_DIRECTIONS: { OUTBOUND: "outbound", INBOUND: "inbound" },
    extractVoiceSessionOptions: () => ({ cleanPrompt: "Answer the phone", options: {} }),
    normalizeCallDirection: (value) => value,
    normalizeInboundGreeting: (value) => value,
    normalizeOptionalInstructionText: (value) => value,
    buildSafeInstructions: (...parts) => parts.join("\n"),
    buildOpeningOnlySessionInstructions: () => "Greeting",
    buildVoiceStyleInstructions: () => "Style",
    buildNaturalVoiceInstructions: (value) => value,
    buildCallDirectionInstructions: () => "Direction",
    normalizeIdleTimeoutMs: () => 14000,
    normalizeKeyterms: () => [],
    normalizeSpeechSpeed: () => 1,
    normalizeReasoningEffort: () => "high",
    clamp: (value) => value,
    XAI_SESSION_RESUMPTION: false,
    process: { env: {} },
  });
  vm.runInContext(source.slice(start, end), context);
  const preset = { toolsEnabled: {}, vectorStoreIds: [], voice: "eve", turnDetection: {} };
  const schedule = { enabled: true, serviceLabel: "Visit", timezoneOffsetMinutes: -300, bookingNotes: "Bring insurance." };
  const booked = context.buildXaiSessionUpdate(preset, { direction: "inbound", schedule }).session;
  assert.equal(booked.tools.map((tool) => tool.name).join(","), "list_open_times,book_appointment");
  assert.match(booked.instructions, /Bring insurance/);
  assert.equal(
    context.buildXaiSessionUpdate(preset, { direction: "inbound", openingOnly: true, schedule }).session.tools.length,
    0,
  );
  assert.equal(
    context.buildXaiSessionUpdate(preset, { direction: "outbound", schedule }).session.tools.some((tool) => tool.name === "book_appointment"),
    false,
  );
});
