import { AppointmentStatus } from "@/bindings/backend";
import type {
  Appointment,
  ScheduleSettings,
  TimeSlot,
} from "@/bindings/backend";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useBookAppointment,
  useCancelAppointment,
  useGetMySchedule,
  useListMyAnsweringPresets,
  useListMyAppointments,
  useListOpenSlots,
  useRescheduleAppointment,
  useSetMySchedule,
  useSuggestedSchedule,
} from "@/hooks/use-backend";
import {
  isValidAnsweringPhoneNumber,
  normalizeAnsweringPhoneNumber,
} from "@/lib/answering-setup";
import {
  OFFSET_PRESETS,
  type ScheduleDraft,
  type ScheduleNumbers,
  WEEKDAY_LABELS,
  addDaysYmd,
  businessDayRangeMs,
  businessYmd,
  draftFromSettings,
  formatBusinessLocal,
  formatOffsetLabel,
  settingsFromDraft,
  weekYmds,
  weekdayOfYmd,
} from "@/lib/schedule-time";
import { Link } from "@tanstack/react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function numbersFromSettings(settings: ScheduleSettings): ScheduleNumbers {
  return {
    enabled: settings.enabled,
    timezoneOffsetMinutes: Number(settings.timezoneOffsetMinutes),
    slotMinutes: Number(settings.slotMinutes),
    minNoticeMinutes: Number(settings.minNoticeMinutes),
    bookingWindowDays: Number(settings.bookingWindowDays),
    serviceLabel: settings.serviceLabel,
    bookingNotes: settings.bookingNotes,
    weeklyHours: settings.weeklyHours.map((day) => ({
      closed: day.closed,
      openMinute: Number(day.openMinute),
      closeMinute: Number(day.closeMinute),
    })),
  };
}

function toCanisterSettings(settings: ScheduleNumbers): ScheduleSettings {
  return {
    enabled: settings.enabled,
    timezoneOffsetMinutes: BigInt(settings.timezoneOffsetMinutes),
    slotMinutes: BigInt(settings.slotMinutes),
    minNoticeMinutes: BigInt(settings.minNoticeMinutes),
    bookingWindowDays: BigInt(settings.bookingWindowDays),
    serviceLabel: settings.serviceLabel,
    bookingNotes: settings.bookingNotes,
    weeklyHours: settings.weeklyHours.map((day) => ({
      closed: day.closed,
      openMinute: BigInt(day.openMinute),
      closeMinute: BigInt(day.closeMinute),
    })),
  };
}

function variantMessage(
  result: { __kind__: string; err?: string } | undefined,
): string | null {
  if (result?.__kind__ === "err")
    return result.err || "The calendar request failed.";
  return null;
}

function SchedulePageContent() {
  const scheduleQuery = useGetMySchedule();
  const suggestedQuery = useSuggestedSchedule();
  const presetsQuery = useListMyAnsweringPresets();
  const saveSchedule = useSetMySchedule();
  const bookAppointment = useBookAppointment();
  const cancelAppointment = useCancelAppointment();
  const rescheduleAppointment = useRescheduleAppointment();

  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [callerName, setCallerName] = useState("");
  const [callerPhone, setCallerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [presetId, setPresetId] = useState("none");
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const saved = scheduleQuery.data ?? null;
  const savedNumbers = saved ? numbersFromSettings(saved) : null;
  const offset =
    savedNumbers?.timezoneOffsetMinutes ??
    Number(draft?.timezoneOffsetMinutes || 0);
  const todayYmd = businessYmd(
    Date.now(),
    Number.isFinite(offset) ? offset : 0,
  );
  const activeYmd = selectedYmd ?? todayYmd;
  const week = weekYmds(activeYmd);
  const dayRange = businessDayRangeMs(
    activeYmd,
    Number.isFinite(offset) ? offset : 0,
  );
  const weekStart = businessDayRangeMs(
    week[0],
    Number.isFinite(offset) ? offset : 0,
  );
  const upcomingStart = businessDayRangeMs(
    todayYmd,
    Number.isFinite(offset) ? offset : 0,
  );

  useEffect(() => {
    if (draft || scheduleQuery.isLoading || suggestedQuery.isLoading) return;
    const source = scheduleQuery.data ?? suggestedQuery.data;
    if (!source) return;
    setDraft(draftFromSettings(numbersFromSettings(source)));
  }, [
    draft,
    scheduleQuery.data,
    scheduleQuery.isLoading,
    suggestedQuery.data,
    suggestedQuery.isLoading,
  ]);

  const slotsQuery = useListOpenSlots(
    dayRange ? BigInt(dayRange.fromMs) : null,
    dayRange ? BigInt(dayRange.toMs) : null,
    saved?.enabled === true,
  );
  const weekAppointments = useListMyAppointments(
    weekStart ? BigInt(weekStart.fromMs) : null,
    weekStart ? BigInt(weekStart.toMs + 6 * 86_400_000) : null,
  );
  const upcomingAppointments = useListMyAppointments(
    upcomingStart ? BigInt(upcomingStart.fromMs) : null,
    upcomingStart ? BigInt(upcomingStart.fromMs + 14 * 86_400_000) : null,
  );

  const dayAppointments = useMemo(() => {
    if (!dayRange || weekAppointments.data?.__kind__ !== "ok") return [];
    return weekAppointments.data.ok.filter(
      (appointment) =>
        Number(appointment.startsAtMs) < dayRange.toMs &&
        Number(appointment.endsAtMs) > dayRange.fromMs,
    );
  }, [dayRange, weekAppointments.data]);

  const openSlots =
    slotsQuery.data?.__kind__ === "ok" ? slotsQuery.data.ok : [];
  const upcoming =
    upcomingAppointments.data?.__kind__ === "ok"
      ? upcomingAppointments.data.ok
      : [];
  const bookingOn = saved?.enabled === true;
  const offsetLabel = formatOffsetLabel(Number.isFinite(offset) ? offset : 0);

  function updateDay(
    index: number,
    patch: Partial<ScheduleDraft["weeklyHours"][number]>,
  ) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        weeklyHours: current.weeklyHours.map((day, dayIndex) =>
          dayIndex === index ? { ...day, ...patch } : day,
        ),
      };
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const parsed = settingsFromDraft(draft);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    const result = await saveSchedule.mutateAsync(
      toCanisterSettings(parsed.ok),
    );
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    setDraft(draftFromSettings(numbersFromSettings(result.ok)));
    toast.success(
      result.ok.enabled
        ? "Appointment booking is on."
        : "Calendar saved. Booking is off.",
    );
  }

  async function onBook(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlot) {
      toast.error("Choose an open time first.");
      return;
    }
    const phone = normalizeAnsweringPhoneNumber(callerPhone);
    if (!callerName.trim()) {
      toast.error("Enter the caller's name.");
      return;
    }
    if (!isValidAnsweringPhoneNumber(phone)) {
      toast.error("Enter a phone number like +15551234567.");
      return;
    }
    const result = await bookAppointment.mutateAsync({
      callerName: callerName.trim(),
      callerPhone: phone,
      startsAtMs: BigInt(selectedSlot),
      notes: notes.trim(),
      ...(presetId !== "none" ? { presetId: BigInt(presetId) } : {}),
    });
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    toast.success(
      `Booked ${formatBusinessLocal(Number(result.ok.startsAtMs), offset)}.`,
    );
    setCallerName("");
    setNotes("");
    setSelectedSlot(null);
  }

  async function onCancel(appointment: Appointment) {
    const confirmed = window.confirm(
      `Cancel ${appointment.callerName} at ${formatBusinessLocal(Number(appointment.startsAtMs), offset)}?`,
    );
    if (!confirmed) return;
    const result = await cancelAppointment.mutateAsync(appointment.id);
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    if (movingId === appointment.id.toString()) setMovingId(null);
    toast.success("Appointment cancelled. That time is open again.");
  }

  async function onMove(slot: TimeSlot) {
    if (!movingId) return;
    const result = await rescheduleAppointment.mutateAsync({
      id: BigInt(movingId),
      startsAtMs: slot.startsAtMs,
    });
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    setMovingId(null);
    toast.success(
      `Moved to ${formatBusinessLocal(Number(result.ok.startsAtMs), offset)}.`,
    );
  }

  const slotError = variantMessage(slotsQuery.data);
  const listError =
    variantMessage(weekAppointments.data) ||
    variantMessage(upcomingAppointments.data);
  const presetMatch = OFFSET_PRESETS.find(
    (preset) => preset.minutes === Number(draft?.timezoneOffsetMinutes),
  );

  return (
    <ProtectedRoute>
      <AppLayout>
        <div
          className="p-6 space-y-6 max-w-screen-xl"
          data-ocid="schedule.page"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                Calendar
              </h1>
              <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                One calendar per account. Times below use {offsetLabel}.
                Daylight saving does not change this offset; save a new one when
                the clocks change. Custom answering instructions still work when
                booking is off.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="self-start">
              <Link to="/user/answering">AI Answering</Link>
            </Button>
          </div>

          {scheduleQuery.isLoading || suggestedQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !draft ? (
            <p className="text-sm text-destructive">
              The calendar could not be loaded. Refresh and try again.
            </p>
          ) : (
            <Card data-ocid="schedule.settings">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CalendarDays className="h-5 w-5" />
                  Office hours
                </CardTitle>
                <CardDescription>
                  {bookingOn
                    ? "Booking is on. Open times come from the saved hours, notice, and window."
                    : "Booking is off until you save with appointment booking turned on."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-5" onSubmit={onSave}>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                    <div>
                      <Label htmlFor="schedule-enabled">
                        Appointment booking
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Turn this on only when callers should be able to reserve
                        a time.
                      </p>
                    </div>
                    <Switch
                      id="schedule-enabled"
                      checked={draft.enabled}
                      onCheckedChange={(enabled) =>
                        setDraft({ ...draft, enabled })
                      }
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Common offsets</Label>
                      <Select
                        value={presetMatch?.id ?? "custom"}
                        onValueChange={(id) => {
                          const match = OFFSET_PRESETS.find(
                            (preset) => preset.id === id,
                          );
                          if (!match) return;
                          setDraft({
                            ...draft,
                            timezoneOffsetMinutes: String(match.minutes),
                          });
                        }}
                      >
                        <SelectTrigger aria-label="Common timezone offsets">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom offset</SelectItem>
                          {OFFSET_PRESETS.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label} (
                              {formatOffsetLabel(preset.minutes)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="schedule-offset">Minutes from UTC</Label>
                      <Input
                        id="schedule-offset"
                        inputMode="numeric"
                        value={draft.timezoneOffsetMinutes}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            timezoneOffsetMinutes: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Slot length</Label>
                      <Select
                        value={draft.slotMinutes}
                        onValueChange={(slotMinutes) =>
                          setDraft({ ...draft, slotMinutes })
                        }
                      >
                        <SelectTrigger aria-label="Slot length">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["15", "30", "45", "60"].map((minutes) => (
                            <SelectItem key={minutes} value={minutes}>
                              {minutes} minutes
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="schedule-notice">
                        Minimum notice (minutes)
                      </Label>
                      <Input
                        id="schedule-notice"
                        inputMode="numeric"
                        value={draft.minNoticeMinutes}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            minNoticeMinutes: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="schedule-window">
                        Booking window (days)
                      </Label>
                      <Input
                        id="schedule-window"
                        inputMode="numeric"
                        value={draft.bookingWindowDays}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            bookingWindowDays: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="schedule-label">Service name</Label>
                      <Input
                        id="schedule-label"
                        value={draft.serviceLabel}
                        maxLength={80}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            serviceLabel: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="schedule-notes">
                      Notes for the person booking
                    </Label>
                    <Textarea
                      id="schedule-notes"
                      value={draft.bookingNotes}
                      maxLength={500}
                      onChange={(event) =>
                        setDraft({ ...draft, bookingNotes: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    {draft.weeklyHours.map((day, index) => (
                      <div
                        key={WEEKDAY_LABELS[index]}
                        className="grid items-center gap-3 rounded-md border border-border p-3 md:grid-cols-[140px_120px_1fr_1fr]"
                      >
                        <span className="text-sm font-medium">
                          {WEEKDAY_LABELS[index]}
                        </span>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={day.closed}
                            onCheckedChange={(closed) =>
                              updateDay(index, { closed })
                            }
                            aria-label={`${WEEKDAY_LABELS[index]} closed`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {day.closed ? "Closed" : "Open"}
                          </span>
                        </div>
                        <Input
                          aria-label={`${WEEKDAY_LABELS[index]} opens`}
                          value={day.open}
                          disabled={day.closed}
                          onChange={(event) =>
                            updateDay(index, { open: event.target.value })
                          }
                        />
                        <Input
                          aria-label={`${WEEKDAY_LABELS[index]} closes`}
                          value={day.close}
                          disabled={day.closed}
                          onChange={(event) =>
                            updateDay(index, { close: event.target.value })
                          }
                        />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Use 09:00 and 17:00 style times. Use 24:00 when a day
                      closes at midnight.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={saveSchedule.isPending}
                    data-ocid="schedule.save"
                  >
                    {saveSchedule.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Save calendar
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Card data-ocid="schedule.week">
              <CardHeader>
                <CardTitle className="text-lg">Week of {week[0]}</CardTitle>
                <CardDescription>
                  Open times are queried for the selected business day so later
                  slots stay visible. Appointments use the saved {offsetLabel}{" "}
                  clock.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Previous week"
                    onClick={() => {
                      setSelectedYmd(addDaysYmd(activeYmd, -7));
                      setSelectedSlot(null);
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedYmd(todayYmd);
                      setSelectedSlot(null);
                    }}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Next week"
                    onClick={() => {
                      setSelectedYmd(addDaysYmd(activeYmd, 7));
                      setSelectedSlot(null);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {week.map((ymd) => (
                    <button
                      key={ymd}
                      type="button"
                      className={`rounded-md border px-1 py-2 text-center text-xs ${
                        ymd === activeYmd
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border"
                      }`}
                      onClick={() => {
                        setSelectedYmd(ymd);
                        setSelectedSlot(null);
                      }}
                    >
                      <span className="block">
                        {WEEKDAY_LABELS[weekdayOfYmd(ymd)].slice(0, 3)}
                      </span>
                      <span className="block font-medium">{ymd.slice(8)}</span>
                    </button>
                  ))}
                </div>
                {listError ? (
                  <p className="text-sm text-destructive">{listError}</p>
                ) : null}
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">
                    {activeYmd} appointments
                  </h2>
                  {weekAppointments.isLoading ? (
                    <Skeleton className="h-16 w-full" />
                  ) : null}
                  {dayAppointments.length === 0 &&
                  !weekAppointments.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      No appointments on this day.
                    </p>
                  ) : (
                    dayAppointments.map((appointment) => (
                      <AppointmentRow
                        key={appointment.id.toString()}
                        appointment={appointment}
                        offset={offset}
                        moving={movingId === appointment.id.toString()}
                        pending={
                          cancelAppointment.isPending ||
                          rescheduleAppointment.isPending
                        }
                        onCancel={() => void onCancel(appointment)}
                        onMove={() =>
                          setMovingId((current) =>
                            current === appointment.id.toString()
                              ? null
                              : appointment.id.toString(),
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card data-ocid="schedule.book">
              <CardHeader>
                <CardTitle className="text-lg">
                  {movingId ? "Choose a new time" : "Open times"}
                </CardTitle>
                <CardDescription>
                  {bookingOn
                    ? "A time is reserved only after it is saved."
                    : "Save the calendar with booking turned on to load open times."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {slotError ? (
                  <p className="text-sm text-destructive">{slotError}</p>
                ) : null}
                {slotsQuery.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : null}
                {bookingOn &&
                !slotsQuery.isLoading &&
                openSlots.length === 0 &&
                !slotError ? (
                  <p className="text-sm text-muted-foreground">
                    No open times on this business day. Notice and the booking
                    window can hide earlier times.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {openSlots.map((slot) => {
                    const key = slot.startsAtMs.toString();
                    const selected = selectedSlot === key;
                    return (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        onClick={() => {
                          if (movingId) {
                            void onMove(slot);
                            return;
                          }
                          setSelectedSlot(key);
                        }}
                      >
                        {formatBusinessLocal(Number(slot.startsAtMs), offset)
                          .split(", ")
                          .slice(1)
                          .join(", ")}
                      </Button>
                    );
                  })}
                </div>
                {movingId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setMovingId(null)}
                  >
                    Stop moving
                  </Button>
                ) : (
                  <form className="space-y-3" onSubmit={onBook}>
                    <div className="space-y-1.5">
                      <Label htmlFor="book-name">Caller name</Label>
                      <Input
                        id="book-name"
                        value={callerName}
                        maxLength={80}
                        onChange={(event) => setCallerName(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="book-phone">Phone number</Label>
                      <Input
                        id="book-phone"
                        value={callerPhone}
                        placeholder="+15551234567"
                        onChange={(event) => setCallerPhone(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="book-notes">Notes</Label>
                      <Textarea
                        id="book-notes"
                        value={notes}
                        maxLength={500}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </div>
                    {(presetsQuery.data?.length ?? 0) > 0 ? (
                      <div className="space-y-1.5">
                        <Label>Answering line</Label>
                        <Select value={presetId} onValueChange={setPresetId}>
                          <SelectTrigger aria-label="Answering line">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              Not tied to a line
                            </SelectItem>
                            {presetsQuery.data?.map((preset) => (
                              <SelectItem
                                key={preset.id.toString()}
                                value={preset.id.toString()}
                              >
                                {preset.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    <Button
                      type="submit"
                      disabled={!bookingOn || bookAppointment.isPending}
                      data-ocid="schedule.book_button"
                    >
                      {bookAppointment.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Save appointment
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Upcoming</CardTitle>
              <CardDescription>
                Saved appointments for the next 14 business-local days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No appointments in this window.
                </p>
              ) : (
                upcoming.map((appointment) => (
                  <AppointmentRow
                    key={`upcoming-${appointment.id.toString()}`}
                    appointment={appointment}
                    offset={offset}
                    moving={movingId === appointment.id.toString()}
                    pending={
                      cancelAppointment.isPending ||
                      rescheduleAppointment.isPending
                    }
                    onCancel={() => void onCancel(appointment)}
                    onMove={() =>
                      setMovingId((current) =>
                        current === appointment.id.toString()
                          ? null
                          : appointment.id.toString(),
                      )
                    }
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}

function AppointmentRow({
  appointment,
  offset,
  moving,
  pending,
  onCancel,
  onMove,
}: {
  appointment: Appointment;
  offset: number;
  moving: boolean;
  pending: boolean;
  onCancel: () => void;
  onMove: () => void;
}) {
  const booked = appointment.status === AppointmentStatus.booked;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">
          {formatBusinessLocal(Number(appointment.startsAtMs), offset)}
        </p>
        <p className="text-sm text-muted-foreground">
          {appointment.callerName} · {appointment.callerPhone}
          {appointment.serviceLabel ? ` · ${appointment.serviceLabel}` : ""}
        </p>
        {appointment.notes ? (
          <p className="text-xs text-muted-foreground">{appointment.notes}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={booked ? "default" : "secondary"}>
          {booked ? "Booked" : "Cancelled"}
        </Badge>
        {booked ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={moving ? "default" : "outline"}
              onClick={onMove}
              disabled={pending}
            >
              {moving ? "Moving" : "Move"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function SchedulePage() {
  return <SchedulePageContent />;
}
