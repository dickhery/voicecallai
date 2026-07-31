module {
  public type CallStatus = {
    #pending;
    #inProgress;
    #completed;
    #failed;
  };

  // Call history log entry
  public type CallRecord = {
    id : Nat;
    userId : Principal;
    recipientPhone : Text;
    presetId : Nat;
    startTime : Int;
    var endTime : ?Int;
    var status : CallStatus;
    var callSid : ?Text;
    var transcript : ?Text;
  };

  // Shared (immutable) version for API responses
  public type CallRecordPublic = {
    id : Nat;
    userId : Principal;
    recipientPhone : Text;
    presetId : Nat;
    startTime : Int;
    endTime : ?Int;
    status : CallStatus;
    callSid : ?Text;
    transcript : ?Text;
  };

  // Input for initiating a call
  public type InitiateCallInput = {
    recipientPhone : Text;
    presetId : Nat;
  };

  // Response from initiating a call
  public type InitiateCallResult = {
    #ok : { callId : Nat; callSid : Text };
    #err : Text;
  };

  // System log entry
  public type SystemLog = {
    timestamp : Int;
    level : { #info; #warn; #error_ };
    message : Text;
    callId : ?Nat;
  };

  public type AnsweringLiveSession = {
    sessionId : Text;
    monitorToken : Text;
    callSid : Text;
    userId : Principal;
    answeringPresetId : Nat;
    answeringPresetName : Text;
    callerPhone : Text;
    startedAt : Int;
    allowedSeconds : Nat;
  };

  // Remote hang-up request stored on-chain for the off-chain voice bridge to poll.
  // Keeps Twilio hang-ups out of the canister while still letting users/agents end calls.
  public type PendingCallEnd = {
    id : Text;
    callId : ?Nat;
    reservationId : Text;
    callSid : ?Text;
    serverSessionId : ?Text;
    requestedAt : Int;
    reason : Text;
  };

  public type RequestCallEndResult = {
    #ok : PendingCallEnd;
    #err : Text;
  };
};
