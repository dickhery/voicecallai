import Array "mo:core/Array";
import Blob "mo:core/Blob";
import List "mo:core/List";
import Map "mo:core/Map";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import AgentTypes "../types/agent";
import BillingTypes "../types/billing";
import CallTypes "../types/calls";

module {
  public let XRC_REFRESH_COST_CYCLES : Nat = 1_000_000_000;

  private let PRICING_TTL_NS : Int = 21_600_000_000_000;
  private let CLAIM_TTL_NS : Int = 120_000_000_000;
  private let MAX_AGENT_JOB_RESULTS : Nat = 100;
  private let MAX_SERVER_JOB_RESULTS : Nat = 20;
  private let MAX_STORED_CALL_JOBS_PER_USER : Nat = 200;
  private let MAX_PENDING_CALL_JOBS_PER_USER : Nat = 5;
  private let MAX_PAYMENT_OPERATIONS_PER_USER : Nat = 500;
  private let LOW_PHONE_TIME_SECONDS : Nat = 300;

  public type State = {
    profiles : Map.Map<Principal, AgentTypes.AgentProfile>;
    purchases : Map.Map<Text, AgentTypes.StoredIcpPurchase>;
    transfers : Map.Map<Text, AgentTypes.StoredIcpTransfer>;
    callJobs : Map.Map<Text, AgentTypes.StoredAgentCallJob>;
    callJobIdempotencyIndex : Map.Map<Text, Text>;
    userCallJobs : Map.Map<Principal, List.List<Text>>;
    paymentOperationCounts : Map.Map<Principal, Nat>;
    nextPurchaseId : { var value : Nat };
    nextTransferId : { var value : Nat };
    nextCallJobId : { var value : Nat };
    var usdRate : Nat64;
    var usdRateDecimals : Nat32;
    var pricingSourceTimestampSeconds : Nat64;
    var pricingUpdatedAt : Int;
    var pricingExpiresAt : Int;
    var pricingLastAttemptAt : Int;
  };

  public func initState() : State {
    {
      profiles = Map.empty<Principal, AgentTypes.AgentProfile>();
      purchases = Map.empty<Text, AgentTypes.StoredIcpPurchase>();
      transfers = Map.empty<Text, AgentTypes.StoredIcpTransfer>();
      callJobs = Map.empty<Text, AgentTypes.StoredAgentCallJob>();
      callJobIdempotencyIndex = Map.empty<Text, Text>();
      userCallJobs = Map.empty<Principal, List.List<Text>>();
      paymentOperationCounts = Map.empty<Principal, Nat>();
      nextPurchaseId = { var value = 1 };
      nextTransferId = { var value = 1 };
      nextCallJobId = { var value = 1 };
      // Bootstrap quote: 1 ICP = $2.10. Purchases require a fresh XRC quote.
      var usdRate = 210_000_000;
      var usdRateDecimals = 8;
      var pricingSourceTimestampSeconds = 0;
      var pricingUpdatedAt = 0;
      var pricingExpiresAt = 0;
      var pricingLastAttemptAt = 0;
    };
  };

  public func register(
    state : State,
    user : Principal,
    displayName : Text,
  ) : AgentTypes.AgentProfile {
    let now = Time.now();
    let cleanName = displayName.trim(#char(' '));
    let profile = switch (state.profiles.get(user)) {
      case (?existing) {
        {
          principal = user;
          displayName = if (cleanName == "") { existing.displayName } else { cleanName };
          createdAt = existing.createdAt;
          updatedAt = now;
        };
      };
      case null {
        {
          principal = user;
          displayName = cleanName;
          createdAt = now;
          updatedAt = now;
        };
      };
    };
    state.profiles.add(user, profile);
    profile;
  };

  public func getProfile(state : State, user : Principal) : ?AgentTypes.AgentProfile {
    state.profiles.get(user);
  };

  public func subaccountFor(user : Principal) : Blob {
    let principalBytes = user.toBlob().toArray();
    Blob.fromArray(
      Array.tabulate<Nat8>(
        32,
        func(index) {
          if (index == 0) {
            Nat8.fromNat(principalBytes.size());
          } else if (index <= principalBytes.size()) {
            principalBytes[index - 1];
          } else {
            0;
          };
        },
      )
    );
  };

  public func accountFor(
    canisterPrincipal : Principal,
    user : Principal,
  ) : AgentTypes.AgentAccount {
    let subaccount = subaccountFor(user);
    let legacyAccountId = canisterPrincipal.toLedgerAccount(?subaccount);
    {
      principal = user;
      ledgerCanister = icpLedgerCanister();
      depositAccount = {
        owner = canisterPrincipal;
        subaccount = ?subaccount;
      };
      legacyAccountId;
      legacyAccountIdHex = blobToHex(legacyAccountId);
    };
  };

  public func pricing(state : State) : AgentTypes.IcpPricing {
    let now = Time.now();
    {
      tokenSymbol = "ICP";
      tokenDecimals = 8;
      ledgerCanister = icpLedgerCanister();
      usdRate = state.usdRate;
      usdRateDecimals = state.usdRateDecimals;
      sourceTimestampSeconds = state.pricingSourceTimestampSeconds;
      updatedAt = state.pricingUpdatedAt;
      expiresAt = state.pricingExpiresAt;
      isFresh = state.pricingExpiresAt > now;
      refreshCostCycles = XRC_REFRESH_COST_CYCLES;
      packages = icpPackages(state);
    };
  };

  public func icpPackages(state : State) : [AgentTypes.IcpPhoneTimePackage] {
    [
      packageFromUsd(state, "pack_5", "$5 - 45 minutes", 500, 45 * 60),
      packageFromUsd(state, "pack_10", "$10 - 90 minutes", 1_000, 90 * 60),
      packageFromUsd(state, "pack_20", "$20 - 180 minutes", 2_000, 180 * 60),
    ];
  };

  public func getIcpPackage(
    state : State,
    packageId : Text,
  ) : ?AgentTypes.IcpPhoneTimePackage {
    for (phonePackage in icpPackages(state).values()) {
      if (phonePackage.id == packageId) {
        return ?phonePackage;
      };
    };
    null;
  };

  public func markPricingAttempt(state : State) {
    state.pricingLastAttemptAt := Time.now();
  };

  public func pricingLastAttemptAt(state : State) : Int {
    state.pricingLastAttemptAt;
  };

  public func setPricing(
    state : State,
    usdRate : Nat64,
    usdRateDecimals : Nat32,
    sourceTimestampSeconds : Nat64,
  ) {
    let now = Time.now();
    state.usdRate := usdRate;
    state.usdRateDecimals := usdRateDecimals;
    state.pricingSourceTimestampSeconds := sourceTimestampSeconds;
    state.pricingUpdatedAt := now;
    state.pricingExpiresAt := now + PRICING_TTL_NS;
  };

  public func guide(state : State) : AgentTypes.AgentGuide {
    {
      appName = "VoiceCall AI";
      apiVersion = "2026-07-agent-v2";
      summary = "Place real outbound AI phone calls, configure voice presets, fund prepaid phone time with ICP, manage answering presets, and retrieve approved call transcripts or recording links through ICP MCP.";
      productionMcpUrl = "https://mcp.internetcomputer.org/mcp";
      authentication = [
        "VoiceCall AI's telephony action is on this backend canister. The frontend canister only serves assets; do not conclude phone calling is unavailable after inspecting only that canister.",
        "Authorize the official ICP MCP / Agent Identity connector with Internet Identity and grant Actions and questions when you want the agent to place calls or move ICP.",
        "Resolve this app, obtain the app-specific principal, then call agentInitialize once. The principal is the account boundary for presets, phone time, call history, and the in-app ICP deposit subaccount.",
        "Internet Identity grants expire. Re-authorize the connector when an authenticated call reports an expired delegation.",
      ];
      firstActions = [
        "Read https://voicecallai.online/llms.txt. If app discovery returns only the frontend asset canister, use the declared backend canister and its Candid interface.",
        "Call getAgentGuide once before planning work, then cache it for the current task.",
        "Call agentInitialize with a short agent or workspace name.",
        "Call listMyPresets and listMyCalls before creating duplicates.",
        "Call agentGetAccountStatus only when a current ICP, ledger-fee, phone-time, or pricing check is relevant.",
      ];
      requiredCallInformation = [
        "Recipient phone number in E.164 format, such as +15551234567.",
        "A user-owned preset ID. Create one with createPreset when none fits.",
        "Whether transcripts or audio may be saved. consentConfirmed must be true whenever either capture option is enabled.",
        "A unique idempotencyKey for every intended purchase, transfer, or call. Reuse the same key only when retrying that same action.",
      ];
      callWorkflow = [
        "Check agentGetAccountStatus once when a live balance is needed. If available phone time is low, tell the user the exact ICP package prices before purchasing.",
        "Create or select a call preset, confirm the recipient, purpose, preset, capture choices, and consent, then call agentQueueCall. Agents do not need separate Twilio or xAI tools: the off-chain voice bridge securely claims the job and places the call.",
        "Poll agentListCallJobs after about 10 seconds, then back off to 20 and 30 seconds while waiting. Use agentGetCallArtifacts after completion for the transcript and a signed audio URL when capture was enabled.",
        "Report queued, dispatched, in-progress, or completed according to returned state. Never claim a call was placed or completed without supporting job or call-record state.",
      ];
      paymentWorkflow = [
        "Fund depositAccount from agentGetAccountIdentity using an ICRC-1 ICP transfer. The deposit subaccount is controlled by this canister and isolated by app principal.",
        "If pricing is stale, call agentRefreshIcpPricing. The quote is cached for six hours to limit XRC cycle use.",
        "Call agentPurchasePhoneTime with a package ID and idempotency key. Stripe remains the separate payment path for human web users.",
        "Use agentTransferIcp to withdraw or transfer unspent ICP from this app-principal subaccount.",
      ];
      safetyAndConsent = [
        "Confirm the recipient, purpose, preset, and capture choices with the user before placing a call.",
        "Do not enable transcript or audio capture without the user's confirmation that applicable participant consent requirements are satisfied.",
        "Do not use the app for threats, harassment, fraud, credential theft, unlawful impersonation, or other harmful activity.",
        "Phone numbers, transcripts, and recording links are sensitive. Reveal them only in the authorized user's chat.",
      ];
      capabilities = [
        capability("Initialize agent access", "agentInitialize", "Register the authenticated app principal and create its isolated in-app ICP account identity.", true),
        capability("Check balances", "agentGetAccountStatus", "Read ICP deposit balance, ledger fee, prepaid phone time, low-balance guidance, and ICP pricing.", true),
        capability("Refresh ICP pricing", "agentRefreshIcpPricing", "Refresh the cached ICP/USD quote from the Exchange Rate Canister at most once per six-hour pricing window.", true),
        capability("Buy phone time", "agentPurchasePhoneTime", "Pay from the principal's ICP deposit subaccount and credit the same phone-time packages sold through Stripe.", true),
        capability("Transfer ICP", "agentTransferIcp", "Transfer unspent ICP from the in-app subaccount to an ICRC-1 account.", true),
        capability("Manage presets", "createPreset", "Create, list, update, duplicate, and delete outbound call presets.", true),
        capability("Queue a call", "agentQueueCall", "Reserve phone time and queue an idempotent outbound voice-server job.", true),
        capability("Call history", "listMyCalls", "Read the authenticated principal's bounded call history.", false),
        capability("Call artifacts", "agentGetCallArtifacts", "Return a completed call's transcript and signed recording URL when available.", false),
        capability("Answering presets", "createAnsweringPreset", "Create, update, enable, and delete inbound AI answering presets.", true),
      ];
      pricing = pricing(state);
    };
  };

  public func makeError(
    state : State,
    code : Text,
    message : Text,
    retryable : Bool,
    availablePhoneSeconds : Nat,
  ) : AgentTypes.AgentError {
    {
      code;
      message;
      retryable;
      availablePhoneSeconds;
      pricing = icpPackages(state);
    };
  };

  public func purchaseKey(user : Principal, idempotencyKey : Text) : Text {
    "purchase:" # user.toText() # ":" # idempotencyKey;
  };

  public func getPurchase(
    state : State,
    user : Principal,
    idempotencyKey : Text,
  ) : ?AgentTypes.StoredIcpPurchase {
    state.purchases.get(purchaseKey(user, idempotencyKey));
  };

  public func createPurchase(
    state : State,
    user : Principal,
    idempotencyKey : Text,
    phonePackage : AgentTypes.IcpPhoneTimePackage,
  ) : AgentTypes.StoredIcpPurchase {
    let now = Time.now();
    let purchase : AgentTypes.StoredIcpPurchase = {
      id = "icpp_" # state.nextPurchaseId.value.toText();
      user;
      packageId = phonePackage.id;
      amountE8s = phonePackage.priceE8s;
      seconds = phonePackage.seconds;
      createdAt = now;
      createdAtNanos = Nat64.fromNat(Int.abs(now));
      var status = #pending;
      var blockIndex = null;
      var error = null;
    };
    state.nextPurchaseId.value += 1;
    state.purchases.add(purchaseKey(user, idempotencyKey), purchase);
    purchase;
  };

  public func reservePaymentOperationSlot(
    state : State,
    user : Principal,
  ) : Bool {
    let current = switch (state.paymentOperationCounts.get(user)) {
      case (?count) { count };
      case null { 0 };
    };
    if (current >= MAX_PAYMENT_OPERATIONS_PER_USER) {
      return false;
    };
    state.paymentOperationCounts.add(user, current + 1);
    true;
  };

  public func toPurchase(purchase : AgentTypes.StoredIcpPurchase) : AgentTypes.IcpPurchase {
    {
      id = purchase.id;
      user = purchase.user;
      packageId = purchase.packageId;
      amountE8s = purchase.amountE8s;
      seconds = purchase.seconds;
      createdAt = purchase.createdAt;
      status = purchase.status;
      blockIndex = purchase.blockIndex;
      error = purchase.error;
    };
  };

  public func completePurchase(
    purchase : AgentTypes.StoredIcpPurchase,
    blockIndex : Nat,
  ) {
    purchase.status := #completed;
    purchase.blockIndex := ?blockIndex;
    purchase.error := null;
  };

  public func failPurchase(
    purchase : AgentTypes.StoredIcpPurchase,
    message : Text,
    definitive : Bool,
  ) {
    purchase.status := if (definitive) { #failed } else { #pending };
    purchase.error := ?message;
  };

  public func transferKey(user : Principal, idempotencyKey : Text) : Text {
    "transfer:" # user.toText() # ":" # idempotencyKey;
  };

  public func getTransfer(
    state : State,
    user : Principal,
    idempotencyKey : Text,
  ) : ?AgentTypes.StoredIcpTransfer {
    state.transfers.get(transferKey(user, idempotencyKey));
  };

  public func createTransfer(
    state : State,
    user : Principal,
    idempotencyKey : Text,
    to : AgentTypes.IcrcAccount,
    amountE8s : Nat,
  ) : AgentTypes.StoredIcpTransfer {
    let now = Time.now();
    let transfer : AgentTypes.StoredIcpTransfer = {
      id = "icpt_" # state.nextTransferId.value.toText();
      user;
      to;
      amountE8s;
      createdAt = now;
      createdAtNanos = Nat64.fromNat(Int.abs(now));
      var status = #pending;
      var blockIndex = null;
      var error = null;
    };
    state.nextTransferId.value += 1;
    state.transfers.add(transferKey(user, idempotencyKey), transfer);
    transfer;
  };

  public func toTransfer(transfer : AgentTypes.StoredIcpTransfer) : AgentTypes.IcpTransfer {
    {
      id = transfer.id;
      user = transfer.user;
      to = transfer.to;
      amountE8s = transfer.amountE8s;
      createdAt = transfer.createdAt;
      status = transfer.status;
      blockIndex = transfer.blockIndex;
      error = transfer.error;
    };
  };

  public func completeTransfer(
    transfer : AgentTypes.StoredIcpTransfer,
    blockIndex : Nat,
  ) {
    transfer.status := #completed;
    transfer.blockIndex := ?blockIndex;
    transfer.error := null;
  };

  public func failTransfer(
    transfer : AgentTypes.StoredIcpTransfer,
    message : Text,
    definitive : Bool,
  ) {
    transfer.status := if (definitive) { #failed } else { #pending };
    transfer.error := ?message;
  };

  public func callJobKey(user : Principal, idempotencyKey : Text) : Text {
    "call:" # user.toText() # ":" # idempotencyKey;
  };

  public func getCallJobByIdempotency(
    state : State,
    user : Principal,
    idempotencyKey : Text,
  ) : ?AgentTypes.StoredAgentCallJob {
    switch (state.callJobIdempotencyIndex.get(callJobKey(user, idempotencyKey))) {
      case (?jobId) { state.callJobs.get(jobId) };
      case null { null };
    };
  };

  public func createCallJob(
    state : State,
    user : Principal,
    idempotencyKey : Text,
    reservation : BillingTypes.CallReservationPublic,
    callToken : Text,
    captureOptions : AgentTypes.AgentCallCaptureOptions,
  ) : AgentTypes.StoredAgentCallJob {
    let job : AgentTypes.StoredAgentCallJob = {
      id = "acj_" # state.nextCallJobId.value.toText();
      idempotencyKey;
      user;
      reservationId = reservation.id;
      callToken;
      callId = reservation.callId;
      recipientPhone = reservation.recipientPhone;
      presetId = reservation.presetId;
      captureOptions;
      createdAt = reservation.createdAt;
      expiresAt = reservation.expiresAt;
      var status = #queued;
      var claimedAt = null;
      var callSid = null;
      var serverSessionId = null;
      var error = null;
    };
    state.nextCallJobId.value += 1;
    state.callJobs.add(job.id, job);
    state.callJobIdempotencyIndex.add(callJobKey(user, idempotencyKey), job.id);
    switch (state.userCallJobs.get(user)) {
      case (?jobs) { jobs.add(job.id) };
      case null {
        let jobs = List.empty<Text>();
        jobs.add(job.id);
        state.userCallJobs.add(user, jobs);
      };
    };
    job;
  };

  public func canCreateCallJob(
    state : State,
    user : Principal,
  ) : Bool {
    switch (state.userCallJobs.get(user)) {
      case null { true };
      case (?ids) {
        if (ids.size() >= MAX_STORED_CALL_JOBS_PER_USER) {
          return false;
        };
        var pending : Nat = 0;
        for (id in ids.values()) {
          switch (state.callJobs.get(id)) {
            case (?job) {
              switch (job.status) {
                case (#queued) { pending += 1 };
                case (#claimed) { pending += 1 };
                case _ {};
              };
            };
            case null {};
          };
        };
        pending < MAX_PENDING_CALL_JOBS_PER_USER;
      };
    };
  };

  public func getCallJob(state : State, id : Text) : ?AgentTypes.StoredAgentCallJob {
    state.callJobs.get(id);
  };

  public func toCallJob(job : AgentTypes.StoredAgentCallJob) : AgentTypes.AgentCallJob {
    {
      id = job.id;
      user = job.user;
      reservationId = job.reservationId;
      callId = job.callId;
      recipientPhone = job.recipientPhone;
      presetId = job.presetId;
      captureOptions = job.captureOptions;
      createdAt = job.createdAt;
      expiresAt = job.expiresAt;
      status = job.status;
      claimedAt = job.claimedAt;
      callSid = job.callSid;
      serverSessionId = job.serverSessionId;
      error = job.error;
    };
  };

  public func listCallJobsForUser(
    state : State,
    user : Principal,
  ) : [AgentTypes.AgentCallJob] {
    switch (state.userCallJobs.get(user)) {
      case null { [] };
      case (?ids) {
        let results = List.empty<AgentTypes.AgentCallJob>();
        let total = ids.size();
        let start = if (total > MAX_AGENT_JOB_RESULTS) {
          Nat.sub(total, MAX_AGENT_JOB_RESULTS);
        } else {
          0;
        };
        for (id in ids.sliceToArray(start, total).values()) {
          switch (state.callJobs.get(id)) {
            case (?job) { results.add(toCallJob(job)) };
            case null {};
          };
        };
        results.toArray().reverse();
      };
    };
  };

  public func listPendingCallJobs(
    state : State,
    limit : Nat,
  ) : [AgentTypes.AgentCallJob] {
    let results = List.empty<AgentTypes.AgentCallJob>();
    let safeLimit = Nat.min(limit, MAX_SERVER_JOB_RESULTS);
    let now = Time.now();
    for (job in state.callJobs.values()) {
      if (results.size() >= safeLimit) {
        return results.toArray();
      };
      let pending = switch (job.status) {
        case (#queued) { true };
        case (#claimed) {
          switch (job.claimedAt) {
            case (?claimedAt) { now - claimedAt > CLAIM_TTL_NS };
            case null { true };
          };
        };
        case _ { false };
      };
      if (pending) {
        results.add(toCallJob(job));
      };
    };
    results.toArray();
  };

  public func claimCallJob(
    state : State,
    id : Text,
  ) : ?AgentTypes.AgentCallDispatch {
    switch (state.callJobs.get(id)) {
      case null { null };
      case (?job) {
        let now = Time.now();
        let claimable = switch (job.status) {
          case (#queued) { true };
          case (#claimed) {
            switch (job.claimedAt) {
              case (?claimedAt) { now - claimedAt > CLAIM_TTL_NS };
              case null { true };
            };
          };
          case _ { false };
        };
        if (not claimable) {
          return null;
        };
        job.status := #claimed;
        job.claimedAt := ?now;
        job.error := null;
        ?{
          job = toCallJob(job);
          callToken = job.callToken;
        };
      };
    };
  };

  public func completeCallDispatch(
    state : State,
    id : Text,
    callSid : ?Text,
    serverSessionId : ?Text,
  ) : Bool {
    switch (state.callJobs.get(id)) {
      case null { false };
      case (?job) {
        job.status := #dispatched;
        job.callSid := callSid;
        job.serverSessionId := serverSessionId;
        job.error := null;
        true;
      };
    };
  };

  public func failCallDispatch(
    state : State,
    id : Text,
    message : Text,
  ) : Bool {
    switch (state.callJobs.get(id)) {
      case null { false };
      case (?job) {
        job.status := #failed;
        job.error := ?message;
        true;
      };
    };
  };

  public func cancelCallJob(
    state : State,
    id : Text,
    user : Principal,
  ) : ?Text {
    switch (state.callJobs.get(id)) {
      case null { null };
      case (?job) {
        if (job.user != user) {
          return null;
        };
        switch (job.status) {
          case (#queued) {};
          case (#claimed) {};
          case _ { return null };
        };
        job.status := #canceled;
        job.error := ?"Canceled before dispatch";
        ?job.reservationId;
      };
    };
  };

  public func artifacts(call : CallTypes.CallRecordPublic) : AgentTypes.AgentCallArtifacts {
    let audioUrl = switch (call.transcript) {
      case (?transcript) { extractRecordingUrl(transcript) };
      case null { null };
    };
    {
      call;
      transcript = call.transcript;
      audioUrl;
      audioMimeType = switch (audioUrl) {
        case (?url) {
          if (url.contains(#text("/bridge-recordings/")) or url.contains(#text(".wav"))) {
            ?"audio/wav";
          } else {
            ?"audio/mpeg";
          };
        };
        case null { null };
      };
      note = switch (audioUrl) {
        case (?_) { "The audio URL is signed by the voice bridge. Whether the chat can play it inline depends on the MCP client; otherwise present it as a link." };
        case null { "No saved audio URL is available. Audio is never stored in the canister." };
      };
    };
  };

  private func capability(
    name : Text,
    methodName : Text,
    description : Text,
    requiresUpdatePermission : Bool,
  ) : AgentTypes.AgentCapability {
    { name; methodName; description; requiresUpdatePermission };
  };

  private func packageFromUsd(
    state : State,
    id : Text,
    name : Text,
    amountCents : Nat,
    seconds : Nat,
  ) : AgentTypes.IcpPhoneTimePackage {
    let scale = pow10(state.usdRateDecimals);
    let numerator = amountCents * scale * 100_000_000;
    let denominator = state.usdRate.toNat() * 100;
    let priceE8s = if (denominator == 0) {
      0;
    } else {
      let quotient = numerator / denominator;
      if (numerator % denominator == 0) { quotient } else { quotient + 1 };
    };
    { id; name; amountCents; seconds; priceE8s };
  };

  private func pow10(decimals : Nat32) : Nat {
    let safeDecimals = Nat.min(decimals.toNat(), 18);
    var value : Nat = 1;
    var index : Nat = 0;
    while (index < safeDecimals) {
      value *= 10;
      index += 1;
    };
    value;
  };

  private func extractRecordingUrl(source : Text) : ?Text {
    for (line in source.split(#char('\n'))) {
      switch (line.stripStart(#text("Recording URL:"))) {
        case (?value) {
          let clean = value.trim(#char(' '));
          if (clean != "" and clean != "pending") {
            return ?clean;
          };
        };
        case null {};
      };
    };
    null;
  };

  private func blobToHex(value : Blob) : Text {
    var result = "";
    for (byte in value.toArray().values()) {
      result #= byteToHex(byte);
    };
    result;
  };

  private func byteToHex(byte : Nat8) : Text {
    let alphabet = "0123456789abcdef".toArray();
    let value = byte.toNat();
    Text.fromChar(alphabet[value / 16]) # Text.fromChar(alphabet[value % 16]);
  };

  public func lowPhoneTimeThresholdSeconds() : Nat {
    LOW_PHONE_TIME_SECONDS;
  };

  public func icpLedgerCanister() : Principal {
    Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
  };
};
