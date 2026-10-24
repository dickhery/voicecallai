module {
  /// Local office hours for one weekday. Index 0 is Sunday.
  /// Minutes are counted from local midnight. A closed day ignores the minutes.
  public type DayHours = {
    closed : Bool;
    openMinute : Nat;
    closeMinute : Nat;
  };

  /// One calendar per account. The offset is a fixed number of minutes from UTC.
  /// Daylight-saving changes are a new saved offset, not an automatic rule.
  public type ScheduleSettings = {
    enabled : Bool;
    timezoneOffsetMinutes : Int;
    slotMinutes : Nat;
    minNoticeMinutes : Nat;
    bookingWindowDays : Nat;
    serviceLabel : Text;
    bookingNotes : Text;
    weeklyHours : [DayHours];
  };

  public type AppointmentStatus = {
    #booked;
    #cancelled;
  };

  public type Appointment = {
    id : Nat;
    ownerId : Principal;
    presetId : ?Nat;
    callerName : Text;
    callerPhone : Text;
    startsAtMs : Int;
    endsAtMs : Int;
    status : AppointmentStatus;
    serviceLabel : Text;
    notes : Text;
    createdAtMs : Int;
    updatedAtMs : Int;
  };

  public type TimeSlot = {
    startsAtMs : Int;
    endsAtMs : Int;
  };

  public type BookAppointmentInput = {
    presetId : ?Nat;
    callerName : Text;
    callerPhone : Text;
    startsAtMs : Int;
    serviceLabel : ?Text;
    notes : Text;
  };

  public type AppointmentDetailsInput = {
    callerName : Text;
    callerPhone : Text;
    serviceLabel : ?Text;
    notes : Text;
  };

  public type ScheduleMutationResult = {
    #ok : ScheduleSettings;
    #err : Text;
  };

  public type AppointmentMutationResult = {
    #ok : Appointment;
    #err : Text;
  };

  public type OpenSlotsResult = {
    #ok : [TimeSlot];
    #err : Text;
  };

  public type AppointmentListResult = {
    #ok : [Appointment];
    #err : Text;
  };
};
