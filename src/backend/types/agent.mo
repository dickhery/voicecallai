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
    callWorkflow : [Text];
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
    consentConfirmed : Bool;
  };

  public type AgentCallInput = {
    recipientPhone : Text;
    presetId : Nat;
    captureOptions : AgentCallCaptureOptions;
    idempotencyKey : Text;
  };

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
    note : Text;
  };
};
