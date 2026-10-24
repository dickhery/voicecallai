import Int "mo:core/Int";
import Principal "mo:core/Principal";
import Schedule "../src/backend/lib/schedule";
import Types "../src/backend/types/schedule";

let owner = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let other = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let state = Schedule.initState();
let suggested = Schedule.suggestedSettings();
assert not suggested.enabled;
assert suggested.weeklyHours.size() == 7;
assert suggested.weeklyHours[0].closed and suggested.weeklyHours[6].closed;
assert suggested.weeklyHours[1].openMinute == 540 and suggested.weeklyHours[1].closeMinute == 1020;

// Monday 2026-10-26 08:00 UTC. The 09:00 slot is one hour later.
let mondayMorning : Int = 1_793_001_600_000;
let nineAm : Int = 1_793_005_200_000;

let weekday : Types.ScheduleSettings = {
  suggested with
  enabled = true;
  minNoticeMinutes = 0;
  bookingWindowDays = 14;
  timezoneOffsetMinutes = 0;
  bookingNotes = "Ask for the caller's name and reason.";
};
switch (Schedule.setSettings(state, owner, weekday)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(saved)) { assert saved.enabled and saved.serviceLabel == "Appointment" };
};

let slots = switch (Schedule.listOpenSlots(state, owner, mondayMorning, mondayMorning + 86_400_000, mondayMorning)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(values)) { values };
};
assert slots.size() > 0;
assert slots[0].startsAtMs == nineAm;
assert slots[0].endsAtMs == nineAm + 1_800_000;

switch (Schedule.book(state, owner, {
  presetId = null;
  callerName = " Ada ";
  callerPhone = "+12025550123";
  startsAtMs = nineAm;
  serviceLabel = null;
  notes = "New patient";
}, mondayMorning)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(appointment)) {
    assert appointment.callerName == "Ada";
    assert appointment.callerPhone == "+12025550123";
    assert appointment.serviceLabel == "Appointment";
    assert appointment.status == #booked;
    assert appointment.notes == "New patient";
  };
};

switch (Schedule.book(state, owner, {
  presetId = null;
  callerName = "Grace";
  callerPhone = "+12025550124";
  startsAtMs = nineAm;
  serviceLabel = ?"Visit";
  notes = "";
}, mondayMorning)) {
  case (#ok(_)) { assert false; loop {} };
  case (#err(message)) { assert message.contains(#text("not an open slot")) };
};

let afterCancel = switch (Schedule.listAppointments(state, owner, mondayMorning, mondayMorning + 86_400_000)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(values)) { values };
};
assert afterCancel.size() == 1;
switch (Schedule.cancel(state, owner, afterCancel[0].id, mondayMorning)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(appointment)) { assert appointment.status == #cancelled };
};
switch (Schedule.book(state, owner, {
  presetId = ?4;
  callerName = "Grace";
  callerPhone = "+12025550124";
  startsAtMs = nineAm;
  serviceLabel = ?"Cleaning";
  notes = "";
}, mondayMorning)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(appointment)) {
    assert appointment.presetId == ?4;
    assert appointment.serviceLabel == "Cleaning";
  };
};

// 09:15 is not on a 30-minute grid.
switch (Schedule.book(state, owner, {
  presetId = null;
  callerName = "Grace";
  callerPhone = "+12025550124";
  startsAtMs = nineAm + 900_000;
  serviceLabel = null;
  notes = "";
}, mondayMorning)) {
  case (#ok(_)) { assert false; loop {} };
  case (#err(_)) {};
};

// Sunday is closed at offset 0.
let sundayMorning : Int = 1_792_918_800_000;
switch (Schedule.book(state, owner, {
  presetId = null;
  callerName = "Grace";
  callerPhone = "+12025550124";
  startsAtMs = sundayMorning;
  serviceLabel = null;
  notes = "";
}, sundayMorning - 3_600_000)) {
  case (#ok(_)) { assert false; loop {} };
  case (#err(_)) {};
};

// Minimum notice hides the 09:00 slot when only 60 minutes remain.
switch (Schedule.setSettings(state, owner, { weekday with minNoticeMinutes = 90 })) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(_)) {};
};
let noticed = switch (Schedule.listOpenSlots(state, owner, mondayMorning, mondayMorning + 86_400_000, mondayMorning)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(values)) { values };
};
assert noticed.size() > 0 and noticed[0].startsAtMs == nineAm + 1_800_000;

// UTC-5 makes local 09:00 equal to 14:00 UTC.
switch (Schedule.setSettings(state, owner, { weekday with timezoneOffsetMinutes = -300; minNoticeMinutes = 0 })) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(_)) {};
};
let shifted = switch (Schedule.listOpenSlots(state, owner, nineAm, nineAm + 86_400_000, mondayMorning)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(values)) { values };
};
assert shifted[0].startsAtMs == nineAm + 5 * 3_600_000;

switch (Schedule.listOpenSlots(state, other, mondayMorning, mondayMorning + 86_400_000, mondayMorning)) {
  case (#ok(_)) { assert false; loop {} };
  case (#err(message)) { assert message.contains(#text("No office hours")) };
};

switch (Schedule.setSettings(state, owner, { weekday with enabled = false })) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(_)) {};
};
switch (Schedule.book(state, owner, {
  presetId = null;
  callerName = "Grace";
  callerPhone = "5551234";
  startsAtMs = nineAm;
  serviceLabel = null;
  notes = "";
}, mondayMorning)) {
  case (#ok(_)) { assert false; loop {} };
  case (#err(message)) { assert message.contains(#text("turned off")) };
};
