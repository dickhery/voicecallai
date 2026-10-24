/** Business-local calendar math. The offset is a fixed number of minutes from UTC. */

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const OFFSET_PRESETS = [
  { id: "utc", label: "UTC / UK winter", minutes: 0 },
  { id: "et-d", label: "US Eastern daylight", minutes: -240 },
  {
    id: "et-s",
    label: "US Eastern standard or Central daylight",
    minutes: -300,
  },
  {
    id: "ct-s",
    label: "US Central standard or Mountain daylight",
    minutes: -360,
  },
  {
    id: "mt-s",
    label: "US Mountain standard or Pacific daylight",
    minutes: -420,
  },
  { id: "pt-s", label: "US Pacific standard", minutes: -480 },
  { id: "uk-s", label: "UK summer or Central Europe standard", minutes: 60 },
  { id: "cet-s", label: "Central Europe summer", minutes: 120 },
  { id: "in", label: "India", minutes: 330 },
  { id: "cn", label: "China, Singapore, or Perth", minutes: 480 },
  { id: "jp", label: "Japan or Korea", minutes: 540 },
  { id: "aest", label: "Australia Eastern standard", minutes: 600 },
  { id: "aedt", label: "Australia Eastern daylight", minutes: 660 },
] as const;

export interface DayDraft {
  closed: boolean;
  open: string;
  close: string;
}

export interface ScheduleDraft {
  enabled: boolean;
  timezoneOffsetMinutes: string;
  slotMinutes: string;
  minNoticeMinutes: string;
  bookingWindowDays: string;
  serviceLabel: string;
  bookingNotes: string;
  weeklyHours: DayDraft[];
}

export interface ScheduleNumbers {
  enabled: boolean;
  timezoneOffsetMinutes: number;
  slotMinutes: number;
  minNoticeMinutes: number;
  bookingWindowDays: number;
  serviceLabel: string;
  bookingNotes: string;
  weeklyHours: { closed: boolean; openMinute: number; closeMinute: number }[];
}

export function formatOffsetLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return "UTC";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(Math.trunc(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `UTC${sign}${hours}:${String(mins).padStart(2, "0")}`;
}

export function formatBusinessLocal(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  const hour24 = shifted.getUTCHours();
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${WEEKDAY_LABELS[shifted.getUTCDay()]}, ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${hour12}:${minute} ${suffix}`;
}

export function businessYmd(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  return formatYmd(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
}

export function formatYmd(
  year: number,
  monthIndex: number,
  day: number,
): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseYmd(
  value: string,
): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, monthIndex, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== monthIndex ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, monthIndex, day };
}

export function addDaysYmd(ymd: string, days: number): string {
  const parts = parseYmd(ymd);
  if (!parts) return ymd;
  const next = new Date(
    Date.UTC(parts.year, parts.monthIndex, parts.day + days),
  );
  return formatYmd(
    next.getUTCFullYear(),
    next.getUTCMonth(),
    next.getUTCDate(),
  );
}

export function weekdayOfYmd(ymd: string): number {
  const parts = parseYmd(ymd);
  if (!parts) return 0;
  return new Date(
    Date.UTC(parts.year, parts.monthIndex, parts.day),
  ).getUTCDay();
}

/** Sunday-start week that contains the business-local day. */
export function weekYmds(ymd: string): string[] {
  const start = addDaysYmd(ymd, -weekdayOfYmd(ymd));
  return Array.from({ length: 7 }, (_, index) => addDaysYmd(start, index));
}

/** UTC millisecond range of one business-local calendar day. End is exclusive. */
export function businessDayRangeMs(
  ymd: string,
  offsetMinutes: number,
): { fromMs: number; toMs: number } | null {
  const parts = parseYmd(ymd);
  if (!parts) return null;
  const fromMs =
    Date.UTC(parts.year, parts.monthIndex, parts.day) - offsetMinutes * 60_000;
  return { fromMs, toMs: fromMs + 86_400_000 };
}

export function minutesToTime(minutes: number): string {
  const total = Math.max(0, Math.min(1440, Math.trunc(minutes)));
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59) return null;
  if (hour === 24 && minute !== 0) return null;
  const total = hour * 60 + minute;
  return total <= 1440 ? total : null;
}

export function draftFromSettings(settings: ScheduleNumbers): ScheduleDraft {
  return {
    enabled: settings.enabled,
    timezoneOffsetMinutes: String(settings.timezoneOffsetMinutes),
    slotMinutes: String(settings.slotMinutes),
    minNoticeMinutes: String(settings.minNoticeMinutes),
    bookingWindowDays: String(settings.bookingWindowDays),
    serviceLabel: settings.serviceLabel,
    bookingNotes: settings.bookingNotes,
    weeklyHours: settings.weeklyHours.map((day) => ({
      closed: day.closed,
      open: minutesToTime(day.openMinute),
      close: minutesToTime(day.closed ? 0 : day.closeMinute),
    })),
  };
}

export function settingsFromDraft(
  draft: ScheduleDraft,
): { ok: ScheduleNumbers } | { error: string } {
  const offset = Number(draft.timezoneOffsetMinutes);
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
    return {
      error:
        "Timezone offset must be a whole number of minutes from -840 to 840.",
    };
  }
  const slot = Number(draft.slotMinutes);
  if (![15, 30, 45, 60].includes(slot)) {
    return { error: "Slot length must be 15, 30, 45, or 60 minutes." };
  }
  const notice = Number(draft.minNoticeMinutes);
  if (!Number.isInteger(notice) || notice < 0 || notice > 10_080) {
    return {
      error: "Minimum notice must be a whole number of minutes up to 7 days.",
    };
  }
  const windowDays = Number(draft.bookingWindowDays);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 60) {
    return { error: "Booking window must be from 1 to 60 days." };
  }
  if (draft.weeklyHours.length !== 7) {
    return { error: "Office hours need all seven weekdays." };
  }
  const weeklyHours: ScheduleNumbers["weeklyHours"] = [];
  for (let index = 0; index < draft.weeklyHours.length; index += 1) {
    const day = draft.weeklyHours[index];
    if (day.closed) {
      weeklyHours.push({ closed: true, openMinute: 0, closeMinute: 0 });
      continue;
    }
    const openMinute = timeToMinutes(day.open);
    const closeMinute = timeToMinutes(day.close);
    if (openMinute === null || closeMinute === null) {
      return {
        error: `${WEEKDAY_LABELS[index]} needs times like 09:00. Use 24:00 to close at midnight.`,
      };
    }
    if (openMinute >= closeMinute || closeMinute - openMinute < slot) {
      return {
        error: `${WEEKDAY_LABELS[index]} must stay open long enough for one time slot.`,
      };
    }
    weeklyHours.push({ closed: false, openMinute, closeMinute });
  }
  const serviceLabel = draft.serviceLabel.trim() || "Appointment";
  if (serviceLabel.length > 80) {
    return { error: "Service name must be 80 characters or fewer." };
  }
  const bookingNotes = draft.bookingNotes.trim();
  if (bookingNotes.length > 500) {
    return { error: "Booking notes must be 500 characters or fewer." };
  }
  return {
    ok: {
      enabled: draft.enabled,
      timezoneOffsetMinutes: offset,
      slotMinutes: slot,
      minNoticeMinutes: notice,
      bookingWindowDays: windowDays,
      serviceLabel,
      bookingNotes,
      weeklyHours,
    },
  };
}
