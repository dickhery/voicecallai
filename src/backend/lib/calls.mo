import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Array "mo:core/Array";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Iter "mo:core/Iter";
import Types "../types/calls";
import Common "../types/common";

module {
  private let MAX_USER_CALL_HISTORY_RESULTS : Nat = 200;
  private let MAX_STORED_CALLS_PER_USER : Nat = 200;
  private let MAX_ADMIN_CALL_RESULTS : Nat = 500;
  private let MAX_SYSTEM_LOGS : Nat = 600;
  private let SYSTEM_LOGS_AFTER_PRUNE : Nat = 400;
  private let MAX_SYSTEM_LOG_RESULTS : Nat = 500;
  private let MAX_SYSTEM_LOG_MESSAGE_CHARS : Nat = 500;

  public type State = {
    callRecords : Map.Map<Common.CallId, Types.CallRecord>;
    userCallIndex : Map.Map<Principal, List.List<Common.CallId>>;
    nextCallId : { var value : Nat };
    systemLogs : List.List<Types.SystemLog>;
  };

  public type AnsweringLiveState = {
    activeSessions : Map.Map<Text, Types.AnsweringLiveSession>;
  };

  public func initState() : State {
    {
      callRecords = Map.empty<Common.CallId, Types.CallRecord>();
      userCallIndex = Map.empty<Principal, List.List<Common.CallId>>();
      nextCallId = { var value = 1 };
      systemLogs = List.empty<Types.SystemLog>();
    };
  };

  public func initAnsweringLiveState() : AnsweringLiveState {
    {
      activeSessions = Map.empty<Text, Types.AnsweringLiveSession>();
    };
  };

  public func toPublic(record : Types.CallRecord) : Types.CallRecordPublic {
    {
      id = record.id;
      userId = record.userId;
      recipientPhone = record.recipientPhone;
      presetId = record.presetId;
      startTime = record.startTime;
      endTime = record.endTime;
      status = record.status;
      callSid = record.callSid;
      transcript = record.transcript;
    };
  };

  private func pruneFinalizedCallsForUser(
    state : State,
    ids : List.List<Common.CallId>,
  ) {
    if (ids.size() < MAX_STORED_CALLS_PER_USER) {
      return;
    };
    var remainingToRemove = Nat.sub(
      ids.size(),
      Nat.sub(MAX_STORED_CALLS_PER_USER, 1),
    );
    ids.retain(func(id) {
      if (remainingToRemove == 0) {
        return true;
      };
      switch (state.callRecords.get(id)) {
        case null {
          remainingToRemove := Nat.sub(remainingToRemove, 1);
          false;
        };
        case (?record) {
          switch (record.status) {
            case (#completed) {
              state.callRecords.remove(id);
              remainingToRemove := Nat.sub(remainingToRemove, 1);
              false;
            };
            case (#failed) {
              state.callRecords.remove(id);
              remainingToRemove := Nat.sub(remainingToRemove, 1);
              false;
            };
            case (#pending) { true };
            case (#inProgress) { true };
          };
        };
      };
    });
  };

  public func createCallRecord(
    state : State,
    userId : Principal,
    recipientPhone : Text,
    presetId : Nat,
  ) : Types.CallRecord {
    let id = state.nextCallId.value;
    state.nextCallId.value += 1;
    let record : Types.CallRecord = {
      id;
      userId;
      recipientPhone;
      presetId;
      startTime = Time.now();
      var endTime = null;
      var status = #pending;
      var callSid = null;
      var transcript = null;
    };
    state.callRecords.add(id, record);
    switch (state.userCallIndex.get(userId)) {
      case null {
        let userList = List.empty<Common.CallId>();
        userList.add(id);
        state.userCallIndex.add(userId, userList);
      };
      case (?userList) {
        pruneFinalizedCallsForUser(state, userList);
        userList.add(id);
      };
    };
    record;
  };

  public func getCallRecord(
    state : State,
    id : Common.CallId,
  ) : ?Types.CallRecord {
    state.callRecords.get(id);
  };

  public func updateCallRecord(
    state : State,
    id : Common.CallId,
    status : Types.CallStatus,
    callSid : ?Text,
    endTime : ?Int,
    transcript : ?Text,
  ) : Bool {
    switch (state.callRecords.get(id)) {
      case null { false };
      case (?record) {
        record.status := status;
        switch (callSid) {
          case (?value) { record.callSid := ?value };
          case null {};
        };
        switch (endTime) {
          case (?value) { record.endTime := ?value };
          case null {};
        };
        switch (transcript) {
          case (?value) { record.transcript := ?value };
          case null {};
        };
        true;
      };
    };
  };

  private func compareCallsNewestFirst(a : Types.CallRecordPublic, b : Types.CallRecordPublic) : Order.Order {
    switch (Int.compare(b.startTime, a.startTime)) {
      case (#equal) { Nat.compare(b.id, a.id) };
      case (order) { order };
    };
  };

  public func listCallsForUser(
    state : State,
    userId : Principal,
  ) : [Types.CallRecordPublic] {
    switch (state.userCallIndex.get(userId)) {
      case null { [] };
      case (?ids) {
        let buf = List.empty<Types.CallRecordPublic>();
        let total = ids.size();
        let start = if (total > MAX_USER_CALL_HISTORY_RESULTS) {
          Nat.sub(total, MAX_USER_CALL_HISTORY_RESULTS);
        } else {
          0;
        };
        for (cid in ids.sliceToArray(start, total).values()) {
          switch (state.callRecords.get(cid)) {
            case null {};
            case (?r) { buf.add(toPublic(r)) };
          };
        };
        buf.toArray().sort(compareCallsNewestFirst);
      };
    };
  };

  public func listAllCalls(state : State) : [Types.CallRecordPublic] {
    let buf = List.empty<Types.CallRecordPublic>();
    state.callRecords.forEach(func(_k, r) { buf.add(toPublic(r)) });
    let sorted = buf.toArray().sort(compareCallsNewestFirst);
    sorted.sliceToArray(0, Nat.min(sorted.size(), MAX_ADMIN_CALL_RESULTS));
  };

  public func addSystemLog(
    state : State,
    level : { #info; #warn; #error_ },
    message : Text,
    callId : ?Nat,
  ) {
    if (state.systemLogs.size() >= MAX_SYSTEM_LOGS) {
      let discard = Nat.sub(state.systemLogs.size(), SYSTEM_LOGS_AFTER_PRUNE);
      var index = 0;
      state.systemLogs.retain(func(_entry) {
        let keep = index >= discard;
        index += 1;
        keep;
      });
    };
    let chars = message.toArray();
    let cleanMessage = if (chars.size() > MAX_SYSTEM_LOG_MESSAGE_CHARS) {
      Text.fromArray(chars.sliceToArray(0, MAX_SYSTEM_LOG_MESSAGE_CHARS));
    } else {
      message;
    };
    let entry : Types.SystemLog = {
      timestamp = Time.now();
      level;
      message = cleanMessage;
      callId;
    };
    state.systemLogs.add(entry);
  };

  public func getSystemLogs(state : State, limit : Nat) : [Types.SystemLog] {
    let safeLimit = Nat.min(limit, MAX_SYSTEM_LOG_RESULTS);
    let total = state.systemLogs.size();
    let start : Nat = if (total > safeLimit) { total - safeLimit } else { 0 };
    state.systemLogs.sliceToArray(start, total).reverse();
  };

  public func registerAnsweringLiveSession(
    state : AnsweringLiveState,
    session : Types.AnsweringLiveSession,
  ) {
    state.activeSessions.add(session.sessionId, session);
  };

  public func removeAnsweringLiveSession(
    state : AnsweringLiveState,
    sessionId : Text,
  ) : Bool {
    switch (state.activeSessions.get(sessionId)) {
      case null { false };
      case (?_) {
        state.activeSessions.remove(sessionId);
        true;
      };
    };
  };

  public func listAnsweringLiveSessionsForUser(
    state : AnsweringLiveState,
    userId : Principal,
  ) : [Types.AnsweringLiveSession] {
    state.activeSessions.values()
      .filter(func(session) { Principal.equal(session.userId, userId) })
      .toArray();
  };
};
