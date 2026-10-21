import BillingTypes "billing";
import CallTypes "calls";

module {
  public type IcrcAccount = {
    owner : Principal;
    subaccount : ?Blob;
  };

  public type AgentProfile = {
    principal : Principal;
    displayName : Text;
    createdAt : Int;
    updatedAt : Int;
  };

  public type AgentInitializeResult = {
    #ok : AgentProfile;
    #err : Text;
  };

  public type AgentCapability = {
    name : Text;
    methodName : Text;
    description : Text;
    requiresUpdatePermission : Bool;
  };

  public type IcpPhoneTimePackage = {
    id : Text;
    name : Text;
    amountCents : Nat;
    seconds : Nat;
    priceE8s : Nat;
  };

  public type IcpPricing = {
    tokenSymbol : Text;
    tokenDecimals : Nat8;
    ledgerCanister : Principal;
    usdRate : Nat64;
    usdRateDecimals : Nat32;
    sourceTimestampSeconds : Nat64;
    updatedAt : Int;
    expiresAt : Int;
    isFresh : Bool;
    refreshCostCycles : Nat;
    packages : [IcpPhoneTimePackage];
  };

  public type AgentGuide = {
    appName : Text;
    apiVersion : Text;
    summary : Text;
    productionMcpUrl : Text;
    authentication : [Text];
    firstActions : [Text];
    requiredCallInformation : [Text];
    /// What the human must supply before the agent creates an answering preset.
    requiredAnsweringInformation : [Text];
    callWorkflow : [Text];
    /// Inbound AI answering (Twilio number → Grok voice) setup steps for agents.
    answeringWorkflow : [Text];
    paymentWorkflow : [Text];
    safetyAndConsent : [Text];
    capabilities : [AgentCapability];
    pricing : IcpPricing;
  };

  public type AgentAccount = {
    principal : Principal;
    ledgerCanister : Principal;
    depositAccount : IcrcAccount;
    legacyAccountId : Blob;
    legacyAccountIdHex : Text;
  };

  public type AgentAccountStatus = {
    account : AgentAccount;
    icpBalanceE8s : Nat;
    ledgerFeeE8s : Nat;
    billing : BillingTypes.BillingStatus;
    lowPhoneTime : Bool;
    message : Text;
    pricing : IcpPricing;
  };

  public type AgentAccountStatusResult = {
    #ok : AgentAccountStatus;
    #err : Text;
  };

  public type IcpPricingResult = {
    #ok : IcpPricing;
    #err : Text;
  };

  public type IcpPurchaseStatus = {
    #pending;
    #completed;
    #failed;
  };

  public type IcpPurchase = {
    id : Text;
    user : Principal;
    packageId : Text;
    amountE8s : Nat;
    seconds : Nat;
    createdAt : Int;
    status : IcpPurchaseStatus;
    blockIndex : ?Nat;
    error : ?Text;
  };

  public type StoredIcpPurchase = {
    id : Text;
    user : Principal;
    packageId : Text;
    amountE8s : Nat;
    seconds : Nat;
    createdAt : Int;
    createdAtNanos : Nat64;
    var status : IcpPurchaseStatus;
    var blockIndex : ?Nat;
    var error : ?Text;
  };

  public type IcpPurchaseResult = {
    #ok : IcpPurchase;
    #err : AgentError;
  };

  public type IcpTransferStatus = {
    #pending;
    #completed;
    #failed;
  };

  public type IcpTransfer = {
    id : Text;
    user : Principal;
    to : IcrcAccount;
    amountE8s : Nat;
    createdAt : Int;
    status : IcpTransferStatus;
    blockIndex : ?Nat;
    error : ?Text;
  };

  public type StoredIcpTransfer = {
    id : Text;
    user : Principal;
    to : IcrcAccount;
    amountE8s : Nat;
    createdAt : Int;
    createdAtNanos : Nat64;
    var status : IcpTransferStatus;
    var blockIndex : ?Nat;
    var error : ?Text;
  };

  public type IcpTransferResult = {
    #ok : IcpTransfer;
    #err : AgentError;
  };

  public type AgentCallCaptureOptions = {
    saveTranscript : Bool;
    recordAudio : Bool;
    /// Legacy name: customer capture authorization, not recipient consent.
    consentConfirmed : Bool;
  };

  public type AgentCallPreview = {
    recipientPhone : Text;
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    availableSeconds : Nat;
    existingJob : ?AgentCallJob;
    note : Text;
  };

  public type AgentCallPreviewResult = {
    #ok : AgentCallPreview;
    #err : AgentError;
  };

  /// Kept for stable-memory layout compatibility with canisters that already
  /// upgraded past cbb93ff. Not used by this restored cbb93ff-behavior build.
  public type TermsAcceptance = {
    version : Text;
    acceptedAt : Int;
  };

  public type TermsStatus = {
    version : Text;
    text : Text;
    acceptedVersion : ?Text;
    acceptedAt : ?Int;
    expiresAt : ?Int;
    current : Bool;
  };

  public type AgentConsentGrant = {
    placeCalls : Bool;
    saveTranscript : Bool;
    recordAudio : Bool;
    grantedAt : Int;
    expiresAt : Int;
  };

  public type ColonyCallGrant = {
    id : Nat;
    user : Principal;
    worker : Principal;
    recipientPhone : Text;
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    maxSeconds : Nat;
    genesisJobId : Nat;
    commissionPaymentId : Nat;
    expiresAt : Int;
    revoked : Bool;
    jobId : ?Text;
    idempotencyKey : Text;
  };

  public type ColonyCallGrantResult = { #ok : ColonyCallGrant; #err : Text };

  public type AgentCallInput = {
    recipientPhone : Text;
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    idempotencyKey : Text;
  };

  public type AgentCallBatchInput = {
    recipientPhones : [Text];
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    /// Whole minutes, from 60 through 600 seconds per call.
    maxCallSeconds : Nat;
    idempotencyKey : Text;
  };

  public type AgentCallBatchStatus = { #queued; #completed; #canceled };

  public type AgentCallBatch = {
    id : Text;
    user : Principal;
    recipientPhones : [Text];
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    maxCallSeconds : Nat;
    createdAt : Int;
    /// completed means every target was handed to the bridge, not that calls finished.
    status : AgentCallBatchStatus;
    attemptedCount : Nat;
    remainingCount : Nat;
    jobs : [AgentCallJob];
    lastError : ?Text;
  };

  public type AgentCallBatchResult = { #ok : AgentCallBatch; #err : AgentError };

  public type AgentCallBatchPreview = {
    recipientPhones : [Text];
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    maxCallSeconds : Nat;
    availableSeconds : Nat;
    existingBatch : ?AgentCallBatch;
    maxBatchSize : Nat;
    maxPendingNumbers : Nat;
    note : Text;
  };

  public type AgentCallBatchPreviewResult = { #ok : AgentCallBatchPreview; #err : AgentError };

  public type AgentCallJobStatus = {
    #queued;
    #claimed;
    #dispatched;
    #failed;
    #canceled;
  };

  public type AgentCallJob = {
    id : Text;
    user : Principal;
    reservationId : Text;
    callId : Nat;
    recipientPhone : Text;
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    createdAt : Int;
    expiresAt : Int;
    status : AgentCallJobStatus;
    claimedAt : ?Int;
    callSid : ?Text;
    serverSessionId : ?Text;
    error : ?Text;
    /// Present only after the voice bridge has started the call. Agents should
    /// show this listen-only URL to the user without waiting to be asked.
    liveAudioUrl : ?Text;
    liveAudioNote : ?Text;
  };

  public type StoredAgentCallJob = {
    id : Text;
    idempotencyKey : Text;
    user : Principal;
    reservationId : Text;
    callToken : Text;
    callId : Nat;
    recipientPhone : Text;
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    createdAt : Int;
    expiresAt : Int;
    var status : AgentCallJobStatus;
    var claimedAt : ?Int;
    var callSid : ?Text;
    var serverSessionId : ?Text;
    var error : ?Text;
  };

  public type AgentCallDispatch = {
    job : AgentCallJob;
    callToken : Text;
  };

  public type AgentCallResult = {
    #ok : AgentCallJob;
    #err : AgentError;
  };

  public type AgentError = {
    code : Text;
    message : Text;
    retryable : Bool;
    availablePhoneSeconds : Nat;
    pricing : [IcpPhoneTimePackage];
  };

  public type AgentCallArtifacts = {
    call : CallTypes.CallRecordPublic;
    transcript : ?Text;
    audioUrl : ?Text;
    audioMimeType : ?Text;
    diagnostics : ?CallTypes.CallDiagnostics;
    note : Text;
  };

  public type AgentLiveCallLink = {
    jobId : Text;
    callId : Nat;
    url : Text;
    expiresAt : Int;
    note : Text;
  };
};
