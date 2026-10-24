import AccessControl "mo:caffeineai-authorization/access-control";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import ConfigLib "../lib/config";
import IdentityLib "../lib/identity";
import ScheduleLib "../lib/schedule";
import ScheduleTypes "../types/schedule";

mixin (
  accessControlState : AccessControl.AccessControlState,
  identityState : IdentityLib.State,
  answeringState : ConfigLib.AnsweringState,
  answeringPresetVoiceIds : ConfigLib.VoiceIdState,
  scheduleState : ScheduleLib.State,
) {
  private func scheduleAccountOf(caller : Principal) : Principal {
    IdentityLib.resolve(identityState, caller);
  };

  private func requireScheduleUser(caller : Principal) {
    if (caller.isAnonymous() or not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
  };

  private func requireScheduleServer(caller : Principal) {
    if (caller.isAnonymous() or not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
  };

  private func scheduleNowMs() : Int {
    Time.now() / 1_000_000;
  };

  private func ownedPreset(
    caller : Principal,
    presetId : ?Nat,
  ) : { #ok : ?Nat; #err : Text } {
    switch (presetId) {
      case null { #ok(null) };
      case (?id) {
        switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
          case null { #err("Answering preset was not found.") };
          case (?preset) {
            if (IdentityLib.sameAccount(identityState, caller, preset.ownerId)) {
              #ok(?id);
            } else {
              #err("That answering preset belongs to another account.");
            };
          };
        };
      };
    };
  };

  /// Default Monday–Friday 09:00–17:00 UTC template. This query writes nothing.
  public query func suggestedSchedule() : async ScheduleTypes.ScheduleSettings {
    ScheduleLib.suggestedSettings();
  };

  public query ({ caller }) func getMySchedule() : async ?ScheduleTypes.ScheduleSettings {
    requireScheduleUser(caller);
    ScheduleLib.getSettings(scheduleState, scheduleAccountOf(caller));
  };

  public shared ({ caller }) func setMySchedule(
    input : ScheduleTypes.ScheduleSettings,
  ) : async ScheduleTypes.ScheduleMutationResult {
    requireScheduleUser(caller);
    ScheduleLib.setSettings(scheduleState, scheduleAccountOf(caller), input);
  };

  public query ({ caller }) func listOpenSlots(
    fromMs : Int,
    toMs : Int,
  ) : async ScheduleTypes.OpenSlotsResult {
    requireScheduleUser(caller);
    ScheduleLib.listOpenSlots(scheduleState, scheduleAccountOf(caller), fromMs, toMs, scheduleNowMs());
  };

  public query ({ caller }) func listMyAppointments(
    fromMs : Int,
    toMs : Int,
  ) : async ScheduleTypes.AppointmentListResult {
    requireScheduleUser(caller);
    ScheduleLib.listAppointments(scheduleState, scheduleAccountOf(caller), fromMs, toMs);
  };

  public query ({ caller }) func getAppointment(
    id : Nat,
  ) : async ?ScheduleTypes.Appointment {
    requireScheduleUser(caller);
    ScheduleLib.getAppointment(scheduleState, scheduleAccountOf(caller), id);
  };

  public shared ({ caller }) func bookAppointment(
    input : ScheduleTypes.BookAppointmentInput,
  ) : async ScheduleTypes.AppointmentMutationResult {
    requireScheduleUser(caller);
    switch (ownedPreset(caller, input.presetId)) {
      case (#err(message)) { #err(message) };
      case (#ok(presetId)) {
        ScheduleLib.book(
          scheduleState,
          scheduleAccountOf(caller),
          { input with presetId },
          scheduleNowMs(),
        );
      };
    };
  };

  public shared ({ caller }) func cancelAppointment(
    id : Nat,
  ) : async ScheduleTypes.AppointmentMutationResult {
    requireScheduleUser(caller);
    ScheduleLib.cancel(scheduleState, scheduleAccountOf(caller), id, scheduleNowMs());
  };

  public shared ({ caller }) func rescheduleAppointment(
    id : Nat,
    startsAtMs : Int,
  ) : async ScheduleTypes.AppointmentMutationResult {
    requireScheduleUser(caller);
    ScheduleLib.reschedule(scheduleState, scheduleAccountOf(caller), id, startsAtMs, scheduleNowMs());
  };

  public shared ({ caller }) func updateAppointmentDetails(
    id : Nat,
    input : ScheduleTypes.AppointmentDetailsInput,
  ) : async ScheduleTypes.AppointmentMutationResult {
    requireScheduleUser(caller);
    ScheduleLib.updateDetails(scheduleState, scheduleAccountOf(caller), id, input, scheduleNowMs());
  };

  public query ({ caller }) func getScheduleForServer(
    webhookSecret : Text,
    phoneNumber : Text,
  ) : async ?ScheduleTypes.ScheduleSettings {
    requireScheduleServer(caller);
    switch (ConfigLib.getAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber)) {
      case null { null };
      case (?preset) {
        ScheduleLib.getSettings(scheduleState, scheduleAccountOf(preset.ownerId));
      };
    };
  };

  public query ({ caller }) func listOpenSlotsForServer(
    webhookSecret : Text,
    phoneNumber : Text,
    fromMs : Int,
    toMs : Int,
  ) : async ScheduleTypes.OpenSlotsResult {
    requireScheduleServer(caller);
    switch (ConfigLib.getAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber)) {
      case null { #err("Answering preset was not found.") };
      case (?preset) {
        ScheduleLib.listOpenSlots(
          scheduleState,
          scheduleAccountOf(preset.ownerId),
          fromMs,
          toMs,
          scheduleNowMs(),
        );
      };
    };
  };

  public shared ({ caller }) func bookAppointmentForServer(
    webhookSecret : Text,
    phoneNumber : Text,
    input : ScheduleTypes.BookAppointmentInput,
  ) : async ScheduleTypes.AppointmentMutationResult {
    requireScheduleServer(caller);
    switch (ConfigLib.getAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber)) {
      case null { #err("Answering preset was not found.") };
      case (?preset) {
        ScheduleLib.book(
          scheduleState,
          scheduleAccountOf(preset.ownerId),
          { input with presetId = ?preset.id },
          scheduleNowMs(),
        );
      };
    };
  };
};
