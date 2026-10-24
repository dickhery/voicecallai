import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Types "../types/schedule";

module {
  private let MAX_APPOINTMENTS_PER_ACCOUNT : Nat = 200;
  private let MAX_OPEN_SLOTS : Nat = 48;
  private let MAX_SCAN_DAYS : Nat = 14;
  private let MAX_APPOINTMENT_RESULTS : Nat = 100;
  private let MAX_APPOINTMENT_SPAN_MS : Int = 5_356_800_000;
  private let MAX_NAME_CHARS : Nat = 80;
  private let MAX_NOTES_CHARS : Nat = 500;
  private let MAX_LABEL_CHARS : Nat = 80;
  private let MIN_TIME_MS : Int = 1_500_000_000_000;
  private let MAX_TIME_MS : Int = 4_200_000_000_000;
  private let DAY_MS : Int = 86_400_000;
  private let MINUTE_MS : Int = 60_000;

  public type State = {
    schedules : Map.Map<Principal, Types.ScheduleSettings>;
    appointments : Map.Map<Nat, Types.Appointment>;
    appointmentIdsByOwner : Map.Map<Principal, List.List<Nat>>;
    nextAppointmentId : { var value : Nat };
  };

  public func initState() : State {
    {
      schedules = Map.empty<Principal, Types.ScheduleSettings>();
      appointments = Map.empty<Nat, Types.Appointment>();
      appointmentIdsByOwner = Map.empty<Principal, List.List<Nat>>();
      nextAppointmentId = { var value = 1 };
    };
  };

  public func suggestedSettings() : Types.ScheduleSettings {
    {
      enabled = false;
      timezoneOffsetMinutes = 0;
      slotMinutes = 30;
      minNoticeMinutes = 60;
      bookingWindowDays = 14;
      serviceLabel = "Appointment";
      bookingNotes = "";
      weeklyHours = Array.tabulate<Types.DayHours>(
        7,
        func(day) {
          if (day == 0 or day == 6) {
            { closed = true; openMinute = 0; closeMinute = 0 };
          } else {
            { closed = false; openMinute = 9 * 60; closeMinute = 17 * 60 };
          };
        },
      );
    };
  };

  public func getSettings(state : State, owner : Principal) : ?Types.ScheduleSettings {
    state.schedules.get(owner);
  };

  public func setSettings(
    state : State,
    owner : Principal,
    input : Types.ScheduleSettings,
  ) : Types.ScheduleMutationResult {
    switch (sanitizeSettings(input)) {
      case (#err(message)) { #err(message) };
      case (#ok(settings)) {
        state.schedules.add(owner, settings);
        #ok(settings);
      };
    };
  };

  public func listOpenSlots(
    state : State,
    owner : Principal,
    fromMs : Int,
    toMs : Int,
    nowMs : Int,
  ) : Types.OpenSlotsResult {
    switch (requireEnabled(state, owner)) {
      case (#err(message)) { #err(message) };
      case (#ok(settings)) {
        switch (clampSlotRange(settings, fromMs, toMs, nowMs)) {
          case (#err(message)) { #err(message) };
          case (#ok(rangeStart, rangeEnd)) {
            #ok(collectSlots(state, owner, settings, rangeStart, rangeEnd));
          };
        };
      };
    };
  };

  public func listAppointments(
    state : State,
    owner : Principal,
    fromMs : Int,
    toMs : Int,
  ) : Types.AppointmentListResult {
    if (not inTimeRange(fromMs) or not inTimeRange(toMs)) {
      return #err("Times must be Unix milliseconds between 2017 and 2103.");
    };
    if (toMs <= fromMs) {
      return #err("The end time must be after the start time.");
    };
    if (toMs - fromMs > MAX_APPOINTMENT_SPAN_MS) {
      return #err("Appointment queries can cover at most 62 days.");
    };
    let matches = List.empty<Types.Appointment>();
    switch (state.appointmentIdsByOwner.get(owner)) {
      case null {};
      case (?ids) {
        for (id in ids.values()) {
          switch (state.appointments.get(id)) {
            case (?appointment) {
              if (appointment.startsAtMs < toMs and appointment.endsAtMs > fromMs) {
                matches.add(appointment);
              };
            };
            case null {};
          };
        };
      };
    };
    let sorted = matches.toArray().sort(
      func(a, b) {
        switch (Int.compare(a.startsAtMs, b.startsAtMs)) {
          case (#equal) { Nat.compare(a.id, b.id) };
          case (order) { order };
        };
      },
    );
    #ok(sorted.sliceToArray(0, Nat.min(sorted.size(), MAX_APPOINTMENT_RESULTS)));
  };

  public func getAppointment(
    state : State,
    owner : Principal,
    id : Nat,
  ) : ?Types.Appointment {
    switch (state.appointments.get(id)) {
      case (?appointment) {
        if (Principal.equal(appointment.ownerId, owner)) { ?appointment } else { null };
      };
      case null { null };
    };
  };

  public func book(
    state : State,
    owner : Principal,
    input : Types.BookAppointmentInput,
    nowMs : Int,
  ) : Types.AppointmentMutationResult {
    switch (requireEnabled(state, owner)) {
      case (#err(message)) { #err(message) };
      case (#ok(settings)) {
        switch (sanitizeBooking(input, settings)) {
          case (#err(message)) { #err(message) };
          case (#ok(clean)) {
            let endsAtMs = clean.startsAtMs + settings.slotMinutes * MINUTE_MS;
            if (not slotIsOpen(state, owner, settings, clean.startsAtMs, endsAtMs, nowMs, null)) {
              return #err("That time is not an open slot. Call listOpenSlots and book one of the returned startsAtMs values.");
            };
            switch (makeRoom(state, owner)) {
              case (?message) { #err(message) };
              case null {
                let id = state.nextAppointmentId.value;
                state.nextAppointmentId.value += 1;
                let appointment : Types.Appointment = {
                  id;
                  ownerId = owner;
                  presetId = clean.presetId;
                  callerName = clean.callerName;
                  callerPhone = clean.callerPhone;
                  startsAtMs = clean.startsAtMs;
                  endsAtMs;
                  status = #booked;
                  serviceLabel = clean.serviceLabel;
                  notes = clean.notes;
                  createdAtMs = nowMs;
                  updatedAtMs = nowMs;
                };
                state.appointments.add(id, appointment);
                switch (state.appointmentIdsByOwner.get(owner)) {
                  case null {
                    let ids = List.empty<Nat>();
                    ids.add(id);
                    state.appointmentIdsByOwner.add(owner, ids);
                  };
                  case (?ids) { ids.add(id) };
                };
                #ok(appointment);
              };
            };
          };
        };
      };
    };
  };

  public func cancel(
    state : State,
    owner : Principal,
    id : Nat,
    nowMs : Int,
  ) : Types.AppointmentMutationResult {
    switch (ownedBooked(state, owner, id)) {
      case (#err(message)) { #err(message) };
      case (#ok(appointment)) {
        let updated = {
          appointment with
          status = #cancelled;
          updatedAtMs = nowMs;
        };
        state.appointments.add(id, updated);
        #ok(updated);
      };
    };
  };

  public func reschedule(
    state : State,
    owner : Principal,
    id : Nat,
    startsAtMs : Int,
    nowMs : Int,
  ) : Types.AppointmentMutationResult {
    switch (requireEnabled(state, owner)) {
      case (#err(message)) { #err(message) };
      case (#ok(settings)) {
        switch (ownedBooked(state, owner, id)) {
          case (#err(message)) { #err(message) };
          case (#ok(appointment)) {
            if (not inTimeRange(startsAtMs)) {
              return #err("Times must be Unix milliseconds between 2017 and 2103.");
            };
            let endsAtMs = startsAtMs + settings.slotMinutes * MINUTE_MS;
            if (not slotIsOpen(state, owner, settings, startsAtMs, endsAtMs, nowMs, ?id)) {
              return #err("That time is not an open slot. Call listOpenSlots and use one of the returned startsAtMs values.");
            };
            let updated = {
              appointment with
              startsAtMs;
              endsAtMs;
              updatedAtMs = nowMs;
            };
            state.appointments.add(id, updated);
            #ok(updated);
          };
        };
      };
    };
  };

  public func updateDetails(
    state : State,
    owner : Principal,
    id : Nat,
    input : Types.AppointmentDetailsInput,
    nowMs : Int,
  ) : Types.AppointmentMutationResult {
    switch (ownedBooked(state, owner, id)) {
      case (#err(message)) { #err(message) };
      case (#ok(appointment)) {
        switch (state.schedules.get(owner)) {
          case null { #err("Save office hours before editing an appointment.") };
          case (?settings) {
            switch (sanitizeDetails(input, settings)) {
              case (#err(message)) { #err(message) };
              case (#ok(clean)) {
                let updated = {
                  appointment with
                  callerName = clean.callerName;
                  callerPhone = clean.callerPhone;
                  serviceLabel = clean.serviceLabel;
                  notes = clean.notes;
                  updatedAtMs = nowMs;
                };
                state.appointments.add(id, updated);
                #ok(updated);
              };
            };
          };
        };
      };
    };
  };

  private func requireEnabled(
    state : State,
    owner : Principal,
  ) : { #ok : Types.ScheduleSettings; #err : Text } {
    switch (state.schedules.get(owner)) {
      case null { #err("No office hours are saved. Call suggestedSchedule, edit them, then setMySchedule.") };
      case (?settings) {
        if (settings.enabled) { #ok(settings) } else {
          #err("Appointment booking is turned off. Call setMySchedule with enabled true.");
        };
      };
    };
  };

  private func ownedBooked(
    state : State,
    owner : Principal,
    id : Nat,
  ) : { #ok : Types.Appointment; #err : Text } {
    switch (getAppointment(state, owner, id)) {
      case null { #err("Appointment was not found.") };
      case (?appointment) {
        if (appointment.status == #booked) { #ok(appointment) } else {
          #err("That appointment is already cancelled.");
        };
      };
    };
  };

  private func sanitizeSettings(
    input : Types.ScheduleSettings,
  ) : { #ok : Types.ScheduleSettings; #err : Text } {
    if (input.timezoneOffsetMinutes < -840 or input.timezoneOffsetMinutes > 840) {
      return #err("Timezone offset must be from -840 to 840 minutes from UTC.");
    };
    if (
      input.slotMinutes != 15 and
      input.slotMinutes != 30 and
      input.slotMinutes != 45 and
      input.slotMinutes != 60
    ) {
      return #err("Slot length must be 15, 30, 45, or 60 minutes.");
    };
    if (input.minNoticeMinutes > 10_080) {
      return #err("Minimum notice must be 7 days or less.");
    };
    if (input.bookingWindowDays < 1 or input.bookingWindowDays > 60) {
      return #err("Booking window must be from 1 to 60 days.");
    };
    if (input.weeklyHours.size() != 7) {
      return #err("weeklyHours must contain exactly 7 days, Sunday at index 0 through Saturday at index 6.");
    };
    for (hours in input.weeklyHours.values()) {
      if (not hours.closed) {
        if (hours.openMinute >= hours.closeMinute or hours.closeMinute > 1440) {
          return #err("Each open day needs an opening minute before its closing minute, and closing no later than 1440.");
        };
        if (hours.closeMinute - hours.openMinute < input.slotMinutes) {
          return #err("Each open day must be long enough for one time slot.");
        };
      };
    };
    switch (cleanLabel(input.serviceLabel, "Appointment")) {
      case (#err(message)) { #err(message) };
      case (#ok(serviceLabel)) {
        let bookingNotes = input.bookingNotes.trim(#char ' ');
        if (hasControl(bookingNotes) or bookingNotes.toArray().size() > MAX_NOTES_CHARS) {
          return #err("Booking notes must be 500 characters or fewer and cannot include control characters.");
        };
        #ok({
          input with
          serviceLabel;
          bookingNotes;
        });
      };
    };
  };

  private func sanitizeBooking(
    input : Types.BookAppointmentInput,
    settings : Types.ScheduleSettings,
  ) : {
    #ok : {
      presetId : ?Nat;
      callerName : Text;
      callerPhone : Text;
      startsAtMs : Int;
      serviceLabel : Text;
      notes : Text;
    };
    #err : Text;
  } {
    switch (sanitizeDetails({
      callerName = input.callerName;
      callerPhone = input.callerPhone;
      serviceLabel = input.serviceLabel;
      notes = input.notes;
    }, settings)) {
      case (#err(message)) { #err(message) };
      case (#ok(details)) {
        if (not inTimeRange(input.startsAtMs)) {
          return #err("Times must be Unix milliseconds between 2017 and 2103.");
        };
        #ok({
          presetId = input.presetId;
          callerName = details.callerName;
          callerPhone = details.callerPhone;
          startsAtMs = input.startsAtMs;
          serviceLabel = details.serviceLabel;
          notes = details.notes;
        });
      };
    };
  };

  private func sanitizeDetails(
    input : Types.AppointmentDetailsInput,
    settings : Types.ScheduleSettings,
  ) : {
    #ok : {
      callerName : Text;
      callerPhone : Text;
      serviceLabel : Text;
      notes : Text;
    };
    #err : Text;
  } {
    let callerName = input.callerName.trim(#char ' ');
    if (callerName == "" or hasControl(callerName) or callerName.toArray().size() > MAX_NAME_CHARS) {
      return #err("Caller name is required and must be 80 characters or fewer.");
    };
    if (not isE164(input.callerPhone)) {
      return #err("Caller phone number must be E.164 format, for example +15551234567.");
    };
    let requestedLabel = switch (input.serviceLabel) {
      case null { settings.serviceLabel };
      case (?value) { value };
    };
    switch (cleanLabel(requestedLabel, settings.serviceLabel)) {
      case (#err(message)) { #err(message) };
      case (#ok(serviceLabel)) {
        let notes = input.notes.trim(#char ' ');
        if (hasControl(notes) or notes.toArray().size() > MAX_NOTES_CHARS) {
          return #err("Notes must be 500 characters or fewer and cannot include control characters.");
        };
        #ok({
          callerName;
          callerPhone = input.callerPhone;
          serviceLabel;
          notes;
        });
      };
    };
  };

  private func cleanLabel(value : Text, fallback : Text) : { #ok : Text; #err : Text } {
    let trimmed = value.trim(#char ' ');
    let labelText = if (trimmed == "") { fallback } else { trimmed };
    if (labelText == "" or hasControl(labelText) or labelText.toArray().size() > MAX_LABEL_CHARS) {
      #err("Service label must be 80 characters or fewer.");
    } else {
      #ok(labelText);
    };
  };

  private func hasControl(value : Text) : Bool {
    for (char in value.toArray().values()) {
      if (char.toNat32() < 32) {
        return true;
      };
    };
    false;
  };

  private func isDigit(char : Char) : Bool {
    let code = char.toNat32();
    code >= 48 and code <= 57;
  };

  private func isE164(phoneNumber : Text) : Bool {
    let chars = phoneNumber.toArray();
    let size = chars.size();
    if (size < 3 or size > 16 or chars[0] != '+' or chars[1].toNat32() < 49 or chars[1].toNat32() > 57) {
      return false;
    };
    var index = 2;
    while (index < size) {
      if (not isDigit(chars[index])) {
        return false;
      };
      index += 1;
    };
    true;
  };

  private func inTimeRange(value : Int) : Bool {
    value >= MIN_TIME_MS and value <= MAX_TIME_MS;
  };

  private func clampSlotRange(
    settings : Types.ScheduleSettings,
    fromMs : Int,
    toMs : Int,
    nowMs : Int,
  ) : { #ok : (Int, Int); #err : Text } {
    if (not inTimeRange(fromMs) or not inTimeRange(toMs)) {
      return #err("Times must be Unix milliseconds between 2017 and 2103.");
    };
    if (toMs <= fromMs) {
      return #err("The end time must be after the start time.");
    };
    let earliest = nowMs + settings.minNoticeMinutes * MINUTE_MS;
    let latest = nowMs + settings.bookingWindowDays * DAY_MS;
    var rangeStart = fromMs;
    if (rangeStart < earliest) {
      rangeStart := earliest;
    };
    var rangeEnd = toMs;
    if (rangeEnd > latest) {
      rangeEnd := latest;
    };
    let scanCap = rangeStart + MAX_SCAN_DAYS * DAY_MS;
    if (rangeEnd > scanCap) {
      rangeEnd := scanCap;
    };
    #ok(rangeStart, rangeEnd);
  };

  private func collectSlots(
    state : State,
    owner : Principal,
    settings : Types.ScheduleSettings,
    rangeStart : Int,
    rangeEnd : Int,
  ) : [Types.TimeSlot] {
    if (rangeStart >= rangeEnd) {
      return [];
    };
    let slotMs = settings.slotMinutes * MINUTE_MS;
    let slots = List.empty<Types.TimeSlot>();
    var dayUtc = startOfLocalDayUtc(rangeStart, settings.timezoneOffsetMinutes);
    var days = 0;
    while (dayUtc < rangeEnd and slots.size() < MAX_OPEN_SLOTS and days < MAX_SCAN_DAYS + 1) {
      days += 1;
      let weekday = weekdayIndex(localMs(dayUtc, settings.timezoneOffsetMinutes));
      let hours = settings.weeklyHours[weekday];
      if (not hours.closed) {
        var cursor = dayUtc + hours.openMinute * MINUTE_MS;
        let closeUtc = dayUtc + hours.closeMinute * MINUTE_MS;
        var checks = 0;
        while (cursor + slotMs <= closeUtc and slots.size() < MAX_OPEN_SLOTS and checks < 96) {
          checks += 1;
          let slotEnd = cursor + slotMs;
          if (
            cursor >= rangeStart and
            slotEnd <= rangeEnd and
            not overlaps(state, owner, cursor, slotEnd, null)
          ) {
            slots.add({ startsAtMs = cursor; endsAtMs = slotEnd });
          };
          cursor += slotMs;
        };
      };
      dayUtc += DAY_MS;
    };
    slots.toArray();
  };

  private func slotIsOpen(
    state : State,
    owner : Principal,
    settings : Types.ScheduleSettings,
    startsAtMs : Int,
    endsAtMs : Int,
    nowMs : Int,
    excludeId : ?Nat,
  ) : Bool {
    if (startsAtMs < nowMs + settings.minNoticeMinutes * MINUTE_MS) {
      return false;
    };
    if (endsAtMs > nowMs + settings.bookingWindowDays * DAY_MS) {
      return false;
    };
    let local = localMs(startsAtMs, settings.timezoneOffsetMinutes);
    let minute = minuteOfDay(local);
    let hours = settings.weeklyHours[weekdayIndex(local)];
    if (hours.closed or minute < hours.openMinute) {
      return false;
    };
    let slotEndMinute = minute + settings.slotMinutes;
    if (slotEndMinute > hours.closeMinute) {
      return false;
    };
    if ((minute - hours.openMinute) % settings.slotMinutes != 0) {
      return false;
    };
    // The saved end must be exactly one slot after the start in UTC.
    if (endsAtMs != startsAtMs + settings.slotMinutes * MINUTE_MS) {
      return false;
    };
    not overlaps(state, owner, startsAtMs, endsAtMs, excludeId);
  };

  private func overlaps(
    state : State,
    owner : Principal,
    startMs : Int,
    endMs : Int,
    excludeId : ?Nat,
  ) : Bool {
    switch (state.appointmentIdsByOwner.get(owner)) {
      case null { false };
      case (?ids) {
        var found = false;
        for (id in ids.values()) {
          if (not found) {
            let skipped = switch (excludeId) {
              case (?skip) { skip == id };
              case null { false };
            };
            switch (state.appointments.get(id)) {
              case (?appointment) {
                if (
                  not skipped and
                  appointment.status == #booked and
                  appointment.startsAtMs < endMs and
                  appointment.endsAtMs > startMs
                ) {
                  found := true;
                };
              };
              case null {};
            };
          };
        };
        found;
      };
    };
  };

  private func makeRoom(state : State, owner : Principal) : ?Text {
    switch (state.appointmentIdsByOwner.get(owner)) {
      case null { null };
      case (?ids) {
        if (ids.size() < MAX_APPOINTMENTS_PER_ACCOUNT) {
          return null;
        };
        var oldestId : ?Nat = null;
        var oldestAt : Int = 0;
        for (id in ids.values()) {
          switch (state.appointments.get(id)) {
            case (?appointment) {
              if (appointment.status == #cancelled) {
                switch (oldestId) {
                  case null {
                    oldestId := ?id;
                    oldestAt := appointment.createdAtMs;
                  };
                  case (?_) {
                    if (appointment.createdAtMs < oldestAt) {
                      oldestId := ?id;
                      oldestAt := appointment.createdAtMs;
                    };
                  };
                };
              };
            };
            case null {};
          };
        };
        switch (oldestId) {
          case (?id) {
            removeAppointment(state, owner, id);
            null;
          };
          case null {
            ?"This account already has 200 appointments. Cancel one before booking another.";
          };
        };
      };
    };
  };

  private func removeAppointment(state : State, owner : Principal, id : Nat) {
    state.appointments.remove(id);
    switch (state.appointmentIdsByOwner.get(owner)) {
      case null {};
      case (?ids) {
        let snapshot = ids.toArray();
        ids.clear();
        for (existing in snapshot.values()) {
          if (existing != id) {
            ids.add(existing);
          };
        };
        if (ids.size() == 0) {
          state.appointmentIdsByOwner.remove(owner);
        };
      };
    };
  };

  private func divFloor(numerator : Int, denominator : Int) : Int {
    let quotient = numerator / denominator;
    if (numerator < 0 and numerator % denominator != 0) { quotient - 1 } else { quotient };
  };

  private func localMs(utcMs : Int, offsetMinutes : Int) : Int {
    utcMs + offsetMinutes * MINUTE_MS;
  };

  private func startOfLocalDayUtc(utcMs : Int, offsetMinutes : Int) : Int {
    let local = localMs(utcMs, offsetMinutes);
    let day = divFloor(local, DAY_MS) * DAY_MS;
    day - offsetMinutes * MINUTE_MS;
  };

  /// Unix epoch was a Thursday. Sunday is 0.
  private func weekdayIndex(local : Int) : Nat {
    let days = divFloor(local, DAY_MS);
    var remainder = (days + 4) % 7;
    if (remainder < 0) {
      remainder += 7;
    };
    Int.abs(remainder);
  };

  private func minuteOfDay(local : Int) : Nat {
    let dayStart = divFloor(local, DAY_MS) * DAY_MS;
    Int.abs((local - dayStart) / MINUTE_MS);
  };
};
