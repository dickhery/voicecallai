import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types/calls";

module {
  public let MAX_RECORDS : Nat = 2_000;
  public type State = { entries : Map.Map<Nat, Types.CallDiagnostics> };

  public func initState() : State { { entries = Map.empty<Nat, Types.CallDiagnostics>() } };

  public func valid(input : Types.CallDiagnosticsInput) : Bool {
    input.version == 1 and input.bridgeVersion.size() <= 80 and
    input.transportStatus.size() <= 30 and input.terminationReason.size() <= 120 and
    input.callerAudioBytes <= 1_000_000_000 and input.assistantAudioBytes <= 1_000_000_000 and
    input.assistantSuppressedBytes <= 1_000_000_000 and
    input.assistantConfirmedTurns <= 100_000 and input.assistantUnconfirmedTurns <= 100_000;
  };

  public func outcome(input : Types.CallDiagnosticsInput) : Types.CallAudioOutcome {
    if (not input.connected) { return #notConnected };
    if (input.assistantAudioBytes == 0) { return #noAssistantAudio };
    if (input.assistantConfirmedTurns == 0) { return #playbackUnconfirmed };
    if (input.callerAudioBytes > 0) { #audioExchanged } else { #unknown };
  };

  public func callStatus(input : ?Types.CallDiagnosticsInput) : Types.CallStatus {
    switch (input) {
      case null { #completed };
      case (?value) {
        if (not value.connected or value.transportStatus == "failed" or value.transportStatus == "busy" or value.transportStatus == "no-answer" or value.transportStatus == "canceled") { #failed } else { #completed };
      };
    };
  };

  /// Called in the existing finalization update, without another network call.
  /// Retain the newest 2,000 call IDs globally; old recoveries cannot evict newer ones.
  public func save(state : State, callId : Nat, input : Types.CallDiagnosticsInput) : Bool {
    if (not valid(input)) { return false };
    if (not state.entries.containsKey(callId) and state.entries.size() >= MAX_RECORDS) {
      switch (state.entries.keys().next()) {
        case null {};
        case (?oldest) {
          if (callId < oldest) { return false };
          state.entries.remove(oldest);
        };
      };
    };
    state.entries.add(callId, { input with outcome = outcome(input); recordedAt = Time.now() });
    true;
  };

  public func get(state : State, callId : Nat) : ?Types.CallDiagnostics { state.entries.get(callId) };
};
