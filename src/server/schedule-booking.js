// Pure inbound booking helpers. The bridge calls the canister; this module does not.

const DAY_MS = 86_400_000;
const MAX_TOOL_SPAN_DAYS = 7;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const LIST_OPEN_TIMES_TOOL = {
  type: "function",
  name: "list_open_times",
  description: "List open appointment times for this business. Offer only returned times. Do not invent openings.",
  parameters: {
    type: "object",
    properties: {
      fromMs: {
        type: "integer",
        description: "Optional Unix milliseconds to start the search. Omit to start from now. Use one millisecond after the last returned startsAtMs to ask for later times.",
      },
    },
    additionalProperties: false,
  },
};

export const BOOK_APPOINTMENT_TOOL = {
  type: "function",
  name: "book_appointment",
  description: "Save one appointment at an exact startsAtMs returned by list_open_times. Confirm it to the caller only when the result status is booked.",
  parameters: {
    type: "object",
    properties: {
      callerName: { type: "string", description: "The caller's name." },
      startsAtMs: { type: "integer", description: "Exact startsAtMs from list_open_times." },
      notes: { type: "string", description: "Short reason or detail from the caller." },
      callerPhone: { type: "string", description: "E.164 callback number. Omit to use the incoming caller ID when it is valid." },
      serviceLabel: { type: "string", description: "Optional service name. Omit to use the saved calendar label." },
    },
    required: ["callerName", "startsAtMs"],
    additionalProperties: false,
  },
};

export function isE164(phone) {
  return /^\+[1-9]\d{1,14}$/.test(String(phone || "").replace(/\s/g, ""));
}

export function formatBusinessLocal(ms, offsetMinutes) {
  const shifted = new Date(Number(ms) + Number(offsetMinutes) * 60_000);
  const hour24 = shifted.getUTCHours();
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${WEEKDAYS[shifted.getUTCDay()]}, ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${hour12}:${minute} ${suffix}`;
}

export function buildScheduleInstructions(settings) {
  const notes = String(settings?.bookingNotes || "").trim();
  const label = String(settings?.serviceLabel || "Appointment").trim() || "Appointment";
  return [
    `Appointment booking is on for ${label}. Times use a fixed UTC offset of ${Number(settings?.timezoneOffsetMinutes) || 0} minutes. Daylight saving does not change this offset.`,
    "When the caller wants an appointment, call list_open_times before offering any time. Offer at most three returned localTime values. Never invent, round, or recall a time that was not returned.",
    "After the caller accepts one returned time, call book_appointment with that exact startsAtMs, the caller's name, and short notes. Pass callerPhone only when the caller gives a callback number.",
    "Say the appointment is booked only when book_appointment returns status booked. Any other status means it is not reserved. Book at most one appointment on this call.",
    notes ? `Office notes the caller may need: ${notes}` : "",
  ].filter(Boolean).join("\n");
}

export function resolveCallerPhone(requested, incoming) {
  const requestedClean = String(requested || "").replace(/[\s().-]/g, "");
  if (requestedClean) {
    return isE164(requestedClean)
      ? { ok: true, phone: requestedClean }
      : { ok: false };
  }
  const incomingClean = String(incoming || "").replace(/\s/g, "");
  return isE164(incomingClean) ? { ok: true, phone: incomingClean } : { ok: false };
}

export function parseBookAppointmentArgs(args) {
  const callerName = String(args?.callerName || "").trim();
  if (!callerName || callerName.length > 80) {
    return {
      ok: false,
      instruction: "Ask for the caller's name. Do not say a time is reserved.",
    };
  }
  const startsAtMs = Number(args?.startsAtMs);
  if (!Number.isSafeInteger(startsAtMs)) {
    return {
      ok: false,
      instruction: "Call list_open_times and use an exact returned startsAtMs. Do not invent a time.",
    };
  }
  return {
    ok: true,
    callerName,
    startsAtMs,
    notes: String(args?.notes || "").trim().slice(0, 500),
    callerPhone: args?.callerPhone ? String(args.callerPhone) : "",
    serviceLabel: args?.serviceLabel ? String(args.serviceLabel).trim().slice(0, 80) : "",
  };
}

export function clampOpenTimesRange(args, settings, nowMs) {
  const windowDays = Math.min(
    MAX_TOOL_SPAN_DAYS,
    Math.max(1, Math.trunc(Number(settings?.bookingWindowDays) || 1)),
  );
  const earliest = Math.trunc(nowMs);
  const latest = earliest + windowDays * DAY_MS;
  let fromMs = Number(args?.fromMs);
  if (!Number.isSafeInteger(fromMs)) fromMs = earliest;
  fromMs = Math.max(earliest, Math.min(Math.trunc(fromMs), latest - 60_000));
  let toMs = Math.min(fromMs + windowDays * DAY_MS, latest);
  if (toMs <= fromMs) toMs = fromMs + 60_000;
  return { fromMs, toMs };
}

export function formatOpenTimes(slots, settings, limit = 12) {
  const offset = Number(settings?.timezoneOffsetMinutes) || 0;
  return (Array.isArray(slots) ? slots : []).slice(0, limit).map((slot) => ({
    startsAtMs: Number(slot.startsAtMs),
    endsAtMs: Number(slot.endsAtMs),
    localTime: formatBusinessLocal(slot.startsAtMs, offset),
  }));
}

export function bookingGuard(state) {
  if (state?.booked) {
    return {
      allow: false,
      status: "already_booked",
      instruction: "This call already saved one appointment. Do not book another. Tell the caller the office can change it from the calendar.",
    };
  }
  if (state?.inFlight) {
    return {
      allow: false,
      status: "in_progress",
      instruction: "A booking is already being saved. Wait for that result. Do not book another time.",
    };
  }
  return { allow: true };
}
