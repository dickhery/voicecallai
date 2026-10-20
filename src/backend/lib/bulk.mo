import Array "mo:core/Array";
import List "mo:core/List";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import AgentLib "agent";
import ConfigLib "config";
import EmergencyLib "emergency";
import Types "../types/agent";

module {
  public let MAX_BATCH_SIZE : Nat = 100;
  public let MAX_PENDING_NUMBERS : Nat = 200;
  public let MAX_GLOBAL_PENDING_NUMBERS : Nat = 2_000;
  public let MAX_RETAINED_BATCHES : Nat = 10;
  public let MAX_GLOBAL_BATCHES : Nat = 1_000;
  public let MAX_PENDING_JOBS : Nat = 2_000;
  // No timer: authorization expires when the queue is read or claimed.
  public let BATCH_TTL_NS : Int = 86_400_000_000_000;

  public type StoredBatch = {
    id : Text;
    user : Principal;
    idempotencyKey : Text;
    recipientPhones : [Text];
    presetId : Nat;
    captureOptions : Types.AgentCallCaptureOptions;
    maxCallSeconds : Nat;
    createdAt : Int;
    var status : Types.AgentCallBatchStatus;
    var nextIndex : Nat;
    // Public snapshots retain results after the bounded live job index prunes.
    jobs : Map.Map<Text, Types.AgentCallJob>;
    var lastError : ?Text;
  };

  // Kept separate from existing agent state for stable-compatible upgrades on
  // this project's pinned, plain enhanced-orthogonal-persistence toolchain.
  public type State = {
    batches : Map.Map<Text, StoredBatch>;
    userBatches : Map.Map<Principal, List.List<Text>>;
    pendingJobIds : Map.Map<Text, Bool>;
    var pendingIndexInitialized : Bool;
    var nextId : Nat;
    var lastServedOwner : ?Principal;
  };

  public func initState() : State {
    { batches = Map.empty<Text, StoredBatch>(); userBatches = Map.empty<Principal, List.List<Text>>(); pendingJobIds = Map.empty<Text, Bool>(); var pendingIndexInitialized = false; var nextId = 1; var lastServedOwner = null };
  };

  /// A one-time upgrade scan preserves old queued work; steady-state worker
  /// polling never traverses the global historical call-job map.
  public func seedPendingIndex(state : State, agent : AgentLib.State) {
    if (state.pendingIndexInitialized) { return };
    for (job in agent.callJobs.values()) {
      syncPendingJob(state, job);
    };
    state.pendingIndexInitialized := true;
  };

  public func syncPendingJob(state : State, job : Types.StoredAgentCallJob) {
    if (job.status == #queued or job.status == #claimed) {
      state.pendingJobIds.add(job.id, true);
    } else { state.pendingJobIds.remove(job.id) };
  };

  /// Stable principal ordering gives a deterministic round-robin cursor,
  /// independent of how many recipients any one owner uploads.
  public func nextOwner(owners : [Principal], lastServed : ?Principal) : ?Principal {
    var first : ?Principal = null;
    var after : ?Principal = null;
    for (owner in owners.values()) {
      switch (first) {
        case null { first := ?owner };
        case (?current) { if (Principal.compare(owner, current) == #less) { first := ?owner } };
      };
      let follows = switch (lastServed) { case null { true }; case (?previous) { Principal.compare(owner, previous) == #greater } };
      if (follows) {
        switch (after) {
          case null { after := ?owner };
          case (?current) { if (Principal.compare(owner, current) == #less) { after := ?owner } };
        };
      };
    };
    switch (after) { case (?owner) { ?owner }; case null { first } };
  };

  public func isPending(batch : StoredBatch) : Bool {
    isPendingAt(batch, Time.now());
  };

  public func isPendingAt(batch : StoredBatch, now : Int) : Bool {
    batch.status == #queued and batch.nextIndex < batch.recipientPhones.size() and
    now - batch.createdAt < BATCH_TTL_NS;
  };

  public func isRunnable(batch : StoredBatch, currentTerms : Bool, availableSeconds : Nat, presetAvailable : Bool, jobCapacity : Bool) : Bool {
    isPending(batch) and currentTerms and availableSeconds >= batch.maxCallSeconds and presetAvailable and jobCapacity;
  };

  public func matchesInput(batch : StoredBatch, input : Types.AgentCallBatchInput) : Bool {
    batch.recipientPhones == input.recipientPhones and batch.presetId == input.presetId and
    batch.captureOptions == AgentLib.customerCapture(input.captureOptions) and batch.maxCallSeconds == input.maxCallSeconds;
  };

  public type ValidationError = { code : Text; message : Text };

  public func validateInput(input : Types.AgentCallBatchInput) : ?ValidationError {
    if (input.recipientPhones.size() == 0 or input.recipientPhones.size() > MAX_BATCH_SIZE) {
      return ?{ code = "INVALID_BATCH_SIZE"; message = "Provide between 1 and 100 distinct E.164 phone numbers per batch." };
    };
    if (input.maxCallSeconds < 60 or input.maxCallSeconds > 600 or input.maxCallSeconds % 60 != 0) {
      return ?{ code = "INVALID_CALL_LIMIT"; message = "maxCallSeconds must be a whole minute between 60 and 600 seconds." };
    };
    let seen = Map.empty<Text, Bool>();
    for (phone in input.recipientPhones.values()) {
      if (not ConfigLib.isE164(phone)) {
        return ?{ code = "INVALID_PHONE_NUMBER"; message = "Every number must use E.164 format, for example +15551234567. No calls were queued." };
      };
      if (EmergencyLib.isBlockedDestination(phone)) {
        return ?{ code = "EMERGENCY_NUMBER_BLOCKED"; message = EmergencyLib.BLOCKED_MESSAGE # " No calls were queued." };
      };
      if (phone.size() < 9) {
        return ?{ code = "INVALID_PHONE_NUMBER"; message = "Every phone number must have 8–15 digits after its leading plus sign." };
      };
      if (seen.containsKey(phone)) {
        return ?{ code = "DUPLICATE_PHONE_NUMBER"; message = "Remove duplicate numbers before submitting this batch. No calls were queued." };
      };
      seen.add(phone, true);
    };
    null;
  };

  public func remaining(batch : StoredBatch) : Nat {
    if (isPending(batch)) { Nat.sub(batch.recipientPhones.size(), batch.nextIndex) } else { 0 };
  };

  public func pendingCount(state : State, user : ?Principal) : Nat {
    var count = 0;
    for (batch in state.batches.values()) {
      if (user == null or user == ?batch.user) { count += remaining(batch) };
    };
    count;
  };

  public func getByKey(state : State, user : Principal, key : Text) : ?StoredBatch {
    switch (state.userBatches.get(user)) {
      case null { null };
      case (?ids) {
        for (id in ids.values()) {
          switch (state.batches.get(id)) {
            case (?batch) { if (batch.idempotencyKey == key) { return ?batch } };
            case null {};
          };
        };
        null;
      };
    };
  };

  public func canRetain(state : State, user : Principal) : Bool {
    var globalRoom = state.batches.size() < MAX_GLOBAL_BATCHES;
    if (not globalRoom) {
      for (batch in state.batches.values()) { if (not isPending(batch)) { globalRoom := true } };
    };
    switch (state.userBatches.get(user)) {
      case null { globalRoom };
      case (?ids) {
        if (ids.size() < MAX_RETAINED_BATCHES) { return globalRoom };
        var activeCount = 0;
        for (id in ids.values()) {
          switch (state.batches.get(id)) {
            case (?batch) { if (isPending(batch)) { activeCount += 1 } };
            case null {};
          };
        };
        activeCount < MAX_RETAINED_BATCHES and globalRoom;
      };
    };
  };

  private func evictGlobalHistory(state : State) {
    if (state.batches.size() < MAX_GLOBAL_BATCHES) { return };
    var oldest : ?StoredBatch = null;
    for (batch in state.batches.values()) {
      if (not isPending(batch)) {
        switch (oldest) {
          case null { oldest := ?batch };
          case (?previous) { if (batch.createdAt < previous.createdAt) { oldest := ?batch } };
        };
      };
    };
    switch (oldest) {
      case null {};
      case (?batch) {
        state.batches.remove(batch.id);
        switch (state.userBatches.get(batch.user)) {
          case null {};
          case (?ids) {
            ids.retain(func id = id != batch.id);
            if (ids.size() == 0) { state.userBatches.remove(batch.user) };
          };
        };
      };
    };
  };

  public func create(state : State, user : Principal, input : Types.AgentCallBatchInput) : StoredBatch {
    let ids = state.userBatches.get(user) ?? List.empty<Text>();
    var toRemove = if (ids.size() >= MAX_RETAINED_BATCHES) { Nat.sub(ids.size(), MAX_RETAINED_BATCHES - 1) } else { 0 };
    if (ids.size() >= MAX_RETAINED_BATCHES) {
      ids.retain(func id {
        if (toRemove == 0) { return true };
        switch (state.batches.get(id)) {
          case (?batch) {
            if (not isPending(batch)) {
              state.batches.remove(id);
              toRemove -= 1;
              return false;
            };
          };
          case null { toRemove -= 1; return false };
        };
        true;
      });
    };
    evictGlobalHistory(state);
    let batch : StoredBatch = {
      id = "acb_" # state.nextId.toText(); user; idempotencyKey = input.idempotencyKey;
      recipientPhones = input.recipientPhones; presetId = input.presetId;
      captureOptions = AgentLib.customerCapture(input.captureOptions);
      maxCallSeconds = input.maxCallSeconds; createdAt = Time.now();
      var status = #queued; var nextIndex = 0;
      jobs = Map.empty<Text, Types.AgentCallJob>(); var lastError = null;
    };
    state.nextId += 1;
    ids.add(batch.id);
    state.userBatches.add(user, ids);
    state.batches.add(batch.id, batch);
    batch;
  };

  /// Linking web and connector identities must preserve pending authorizations
  /// and fund subsequent targets from the new canonical account. History may
  /// temporarily exceed ten entries when two accounts both have pending work.
  public func mergeAccounts(state : State, secondary : Principal, primary : Principal) {
    if (secondary == primary) { return };
    let oldIds = state.userBatches.get(secondary) ?? (return);
    let primaryIds = state.userBatches.get(primary) ?? List.empty<Text>();
    for (id in oldIds.values()) {
      switch (state.batches.get(id)) {
        case null {};
        case (?batch) {
          state.batches.add(id, {
            id = batch.id; user = primary; idempotencyKey = batch.idempotencyKey;
            recipientPhones = batch.recipientPhones; presetId = batch.presetId;
            captureOptions = batch.captureOptions; maxCallSeconds = batch.maxCallSeconds;
            createdAt = batch.createdAt; var status = batch.status; var nextIndex = batch.nextIndex;
            jobs = batch.jobs; var lastError = batch.lastError;
          });
          primaryIds.add(id);
        };
      };
    };
    state.userBatches.add(primary, primaryIds);
    state.userBatches.remove(secondary);
    if (state.lastServedOwner == ?secondary) { state.lastServedOwner := ?primary };
  };

  public func toPublic(batch : StoredBatch, agent : AgentLib.State) : Types.AgentCallBatch {
    let jobs = batch.jobs.values().toArray().map(func snapshot {
      switch (agent.callJobs.get(snapshot.id)) {
        case (?job) { AgentLib.toCallJob(job) };
        case null { snapshot };
      };
    }).sort(func(a, b) { if (a.callId < b.callId) { #less } else if (a.callId > b.callId) { #greater } else { #equal } });
    {
      id = batch.id; user = batch.user; recipientPhones = batch.recipientPhones;
      presetId = batch.presetId; captureOptions = batch.captureOptions;
      maxCallSeconds = batch.maxCallSeconds; createdAt = batch.createdAt;
      status = if (batch.status == #queued and not isPending(batch)) {
        if (batch.nextIndex >= batch.recipientPhones.size()) { #completed } else { #canceled };
      } else { batch.status };
      attemptedCount = batch.nextIndex; remainingCount = remaining(batch); jobs;
      lastError = if (batch.status == #queued and Time.now() - batch.createdAt >= BATCH_TTL_NS) {
        ?"Undialed targets expired after 24 hours. Preview and submit a new authorized batch to continue.";
      } else { batch.lastError };
    };
  };

  public func listForUser(state : State, agent : AgentLib.State, user : Principal) : [Types.AgentCallBatch] {
    switch (state.userBatches.get(user)) {
      case null { [] };
      case (?ids) {
        ids.toArray().reverse().filterMap(func id {
          switch (state.batches.get(id)) { case (?batch) { ?toPublic(batch, agent) }; case null { null } };
        });
      };
    };
  };

  public func rememberPrunedJob(state : State, job : Types.AgentCallJob) {
    switch (state.userBatches.get(job.user)) {
      case null {};
      case (?ids) {
        for (id in ids.values()) {
          switch (state.batches.get(id)) {
            case (?batch) {
              if (batch.jobs.containsKey(job.id)) { batch.jobs.add(job.id, job) };
            };
            case null {};
          };
        };
      };
    };
  };
};
