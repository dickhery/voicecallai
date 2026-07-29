import Blob "mo:core/Blob";
import Cycles "mo:core/Cycles";
import Error "mo:core/Error";
import Int "mo:core/Int";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import AccessControl "mo:caffeineai-authorization/access-control";
import AgentLib "../lib/agent";
import BillingLib "../lib/billing";
import CallsLib "../lib/calls";
import ConfigLib "../lib/config";
import AgentTypes "../types/agent";

mixin (
  canisterPrincipal : Principal,
  accessControlState : AccessControl.AccessControlState,
  agentState : AgentLib.State,
  billingState : BillingLib.State,
  callsState : CallsLib.State,
  configState : ConfigLib.State,
  callPresetVoiceIds : ConfigLib.VoiceIdState,
) {
  type TransferArg = {
    from_subaccount : ?Blob;
    to : AgentTypes.IcrcAccount;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };

  type AssetClass = { #Cryptocurrency; #FiatCurrency };
  type Asset = { symbol : Text; class_ : AssetClass };
  type GetExchangeRateRequest = {
    base_asset : Asset;
    quote_asset : Asset;
    timestamp : ?Nat64;
  };
  type ExchangeRateMetadata = {
    decimals : Nat32;
    base_asset_num_received_rates : Nat64;
    base_asset_num_queried_sources : Nat64;
    quote_asset_num_received_rates : Nat64;
    quote_asset_num_queried_sources : Nat64;
    standard_deviation : Nat64;
    forex_timestamp : ?Nat64;
  };
  type ExchangeRate = {
    base_asset : Asset;
    quote_asset : Asset;
    timestamp : Nat64;
    rate : Nat64;
    metadata : ExchangeRateMetadata;
  };
  type ExchangeRateError = {
    #AnonymousPrincipalNotAllowed;
    #Pending;
    #CryptoBaseAssetNotFound;
    #CryptoQuoteAssetNotFound;
    #StablecoinRateNotFound;
    #StablecoinRateTooFewRates;
    #StablecoinRateZeroRate;
    #ForexInvalidTimestamp;
    #ForexBaseAssetNotFound;
    #ForexQuoteAssetNotFound;
    #ForexAssetsNotFound;
    #RateLimited;
    #NotEnoughCycles;
    #FailedToAcceptCycles;
    #InconsistentRatesReceived;
    #Other : { code : Nat32; description : Text };
  };

  transient let icpLedger = actor ("ryjl3-tyaaa-aaaaa-aaaba-cai") : actor {
    icrc1_balance_of : shared query AgentTypes.IcrcAccount -> async Nat;
    icrc1_fee : shared query () -> async Nat;
    icrc1_transfer : shared TransferArg -> async {
      #Ok : Nat;
      #Err : TransferError;
    };
  };

  transient let exchangeRateCanister = actor ("uf6dk-hyaaa-aaaaq-qaaaq-cai") : actor {
    get_exchange_rate : shared GetExchangeRateRequest -> async {
      #Ok : ExchangeRate;
      #Err : ExchangeRateError;
    };
  };

  transient let ledgerLocks = Map.empty<Principal, Bool>();
  transient let callLocks = Map.empty<Principal, Bool>();
  transient let pricingRefreshLock = { var active = false };

  private let MAX_DISPLAY_NAME_CHARS : Nat = 80;
  private let MAX_IDEMPOTENCY_KEY_CHARS : Nat = 120;
  private let MAX_TRANSFER_E8S : Nat = 100_000_000_000_000;
  private let PRICING_RETRY_COOLDOWN_NS : Int = 1_800_000_000_000;
  private let MAX_CALL_CAPTURE_ERROR_CHARS : Nat = 500;

  /// First call for an ICP MCP client. Registers the authenticated app
  /// principal and creates its deterministic in-app ICP deposit account.
  public shared ({ caller }) func agentInitialize(
    displayName : Text,
  ) : async AgentTypes.AgentInitializeResult {
    if (caller.isAnonymous()) {
      return #err("Anonymous agents cannot initialize an account. Authenticate with Internet Identity through the ICP MCP connector.");
    };
    if (displayName.toArray().size() > MAX_DISPLAY_NAME_CHARS) {
      return #err("Agent display name must be 80 characters or fewer.");
    };
    AccessControl.initialize(accessControlState, caller);
    #ok(AgentLib.register(agentState, caller, displayName));
  };

  /// Agent-readable onboarding, workflow, consent rules, current packages,
  /// and discoverable method names. This query is intentionally public.
  public query func getAgentGuide() : async AgentTypes.AgentGuide {
    AgentLib.guide(agentState);
  };

  /// Current cached ICP prices. A stale quote can be refreshed with
  /// agentRefreshIcpPricing; ordinary reads never spend XRC cycles.
  public query func getAgentPricing() : async AgentTypes.IcpPricing {
    AgentLib.pricing(agentState);
  };

  /// Returns the authenticated principal's deterministic deposit account
  /// without making an inter-canister ledger call.
  public query ({ caller }) func agentGetAccountIdentity() : async AgentTypes.AgentAccount {
    requireAgent(caller);
    AgentLib.accountFor(canisterPrincipal, caller);
  };

  /// Checks the in-app ICP ledger balance, current ledger fee, prepaid phone
  /// time, low-balance status, and current package pricing.
  public shared ({ caller }) func agentGetAccountStatus() : async AgentTypes.AgentAccountStatusResult {
    requireAgent(caller);
    let account = AgentLib.accountFor(canisterPrincipal, caller);
    try {
      let icpBalanceE8s = await icpLedger.icrc1_balance_of(account.depositAccount);
      let ledgerFeeE8s = await icpLedger.icrc1_fee();
      let billing = BillingLib.getBillingStatus(billingState, caller);
      let lowPhoneTime = billing.availableSeconds < AgentLib.lowPhoneTimeThresholdSeconds();
      let pricing = AgentLib.pricing(agentState);
      let message = if (lowPhoneTime) {
        "Phone time is low. Tell the user the ICP package prices in this response and ask before purchasing more.";
      } else {
        "The account has enough phone time to queue a call.";
      };
      #ok({
        account;
        icpBalanceE8s;
        ledgerFeeE8s;
        billing;
        lowPhoneTime;
        message;
        pricing;
      });
    } catch (error) {
      #err("Unable to read the ICP ledger: " # error.message());
    };
  };

  /// Refreshes ICP/USD from the Exchange Rate Canister. Fresh quotes are
  /// returned from cache; at most one paid XRC refresh is allowed per window.
  public shared ({ caller }) func agentRefreshIcpPricing() : async AgentTypes.IcpPricingResult {
    requireAgent(caller);
    let cached = AgentLib.pricing(agentState);
    if (cached.isFresh) {
      return #ok(cached);
    };
    let now = Time.now();
    if (pricingRefreshLock.active) {
      return #err("An ICP pricing refresh is already in progress. Retry shortly.");
    };
    if (
      AgentLib.pricingLastAttemptAt(agentState) > 0 and
      now - AgentLib.pricingLastAttemptAt(agentState) < PRICING_RETRY_COOLDOWN_NS
    ) {
      return #err("ICP pricing was refreshed or attempted recently. Retry after thirty minutes.");
    };

    pricingRefreshLock.active := true;
    AgentLib.markPricingAttempt(agentState);
    try {
      let result = await (with cycles = AgentLib.XRC_REFRESH_COST_CYCLES) exchangeRateCanister.get_exchange_rate({
        base_asset = { symbol = "ICP"; class_ = #Cryptocurrency };
        quote_asset = { symbol = "USD"; class_ = #FiatCurrency };
        timestamp = null;
      });
      switch (result) {
        case (#Ok(rate)) {
          if (rate.rate == 0 or rate.metadata.decimals > 18) {
            #err("The Exchange Rate Canister returned an unusable ICP/USD quote.");
          } else {
            AgentLib.setPricing(
              agentState,
              rate.rate,
              rate.metadata.decimals,
              rate.timestamp,
            );
            #ok(AgentLib.pricing(agentState));
          };
        };
        case (#Err(error)) {
          #err("Unable to refresh ICP pricing: " # exchangeRateErrorText(error));
        };
      };
    } catch (error) {
      #err("Unable to call the Exchange Rate Canister: " # error.message());
    } finally {
      pricingRefreshLock.active := false;
    };
  };

  /// Admin fallback for setting a verified ICP/USD quote when XRC is
  /// temporarily unavailable. rate is scaled by 10^decimals.
  public shared ({ caller }) func adminSetIcpUsdRate(
    rate : Nat64,
    decimals : Nat32,
    sourceTimestampSeconds : Nat64,
  ) : async AgentTypes.IcpPricingResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    if (rate == 0 or decimals > 18) {
      return #err("ICP/USD rate must be positive and use 18 decimals or fewer.");
    };
    AgentLib.setPricing(agentState, rate, decimals, sourceTimestampSeconds);
    #ok(AgentLib.pricing(agentState));
  };

  /// Buys the same phone-time package offered to Stripe users, paying ICP
  /// from the caller's isolated canister subaccount. Safe retries must reuse
  /// the same idempotency key.
  public shared ({ caller }) func agentPurchasePhoneTime(
    packageId : Text,
    idempotencyKey : Text,
  ) : async AgentTypes.IcpPurchaseResult {
    requireAgent(caller);
    switch (validateIdempotencyKey(idempotencyKey)) {
      case (?message) {
        return #err(agentError("INVALID_IDEMPOTENCY_KEY", message, false, caller));
      };
      case null {};
    };
    if (not acquireLock(ledgerLocks, caller)) {
      return #err(agentError("PAYMENT_IN_PROGRESS", "Another ICP operation is already in progress for this account.", true, caller));
    };

    let purchase = switch (AgentLib.getPurchase(agentState, caller, idempotencyKey)) {
      case (?existing) {
        if (existing.packageId != packageId) {
          releaseLock(ledgerLocks, caller);
          return #err(agentError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key belongs to a different purchase. Use a new key for a new action.",
            false,
            caller,
          ));
        };
        switch (existing.status) {
          case (#completed) {
            releaseLock(ledgerLocks, caller);
            return #ok(AgentLib.toPurchase(existing));
          };
          case (#failed) {
            releaseLock(ledgerLocks, caller);
            return #err(agentError(
              "PURCHASE_FAILED",
              optionText(existing.error, "The previous purchase attempt failed. Use a new idempotency key after resolving the problem."),
              false,
              caller,
            ));
          };
          case (#pending) {};
        };
        existing;
      };
      case null {
        if (not AgentLib.pricing(agentState).isFresh) {
          releaseLock(ledgerLocks, caller);
          return #err(agentError(
            "STALE_ICP_PRICING",
            "ICP pricing is stale. Call agentRefreshIcpPricing before buying phone time.",
            true,
            caller,
          ));
        };
        let phonePackage = switch (AgentLib.getIcpPackage(agentState, packageId)) {
          case (?value) { value };
          case null {
            releaseLock(ledgerLocks, caller);
            return #err(agentError("UNKNOWN_PACKAGE", "Unknown phone-time package.", false, caller));
          };
        };
        if (phonePackage.priceE8s == 0) {
          releaseLock(ledgerLocks, caller);
          return #err(agentError("INVALID_PRICE", "The cached ICP package price is invalid.", true, caller));
        };
        if (not AgentLib.reservePaymentOperationSlot(agentState, caller)) {
          releaseLock(ledgerLocks, caller);
          return #err(agentError(
            "PAYMENT_HISTORY_LIMIT",
            "This app account has reached its retained ICP payment-history limit. Contact the app operator before creating another payment.",
            false,
            caller,
          ));
        };
        AgentLib.createPurchase(agentState, caller, idempotencyKey, phonePackage);
      };
    };

    try {
      let result = await icpLedger.icrc1_transfer({
        from_subaccount = ?AgentLib.subaccountFor(caller);
        to = { owner = canisterPrincipal; subaccount = null };
        amount = purchase.amountE8s;
        fee = null;
        memo = null;
        created_at_time = ?purchase.createdAtNanos;
      });
      switch (result) {
        case (#Ok(blockIndex)) {
          finishIcpPurchase(purchase, blockIndex);
        };
        case (#Err(#Duplicate({ duplicate_of }))) {
          finishIcpPurchase(purchase, duplicate_of);
        };
        case (#Err(error)) {
          let message = transferErrorText(error);
          let retryable = isRetryableTransferError(error);
          AgentLib.failPurchase(purchase, message, not retryable);
          #err(agentError("ICP_TRANSFER_FAILED", message, retryable, caller));
        };
      };
    } catch (error) {
      let message = "ICP ledger call outcome is not confirmed: " # error.message() # ". Retry with the same idempotency key.";
      AgentLib.failPurchase(purchase, message, false);
      #err(agentError("ICP_TRANSFER_UNCONFIRMED", message, true, caller));
    } finally {
      releaseLock(ledgerLocks, caller);
    };
  };

  /// Transfers unspent ICP from the caller's isolated in-app subaccount to
  /// another ICRC-1 account. Safe retries reuse the same idempotency key.
  public shared ({ caller }) func agentTransferIcp(
    to : AgentTypes.IcrcAccount,
    amountE8s : Nat,
    idempotencyKey : Text,
  ) : async AgentTypes.IcpTransferResult {
    requireAgent(caller);
    switch (validateIdempotencyKey(idempotencyKey)) {
      case (?message) {
        return #err(agentError("INVALID_IDEMPOTENCY_KEY", message, false, caller));
      };
      case null {};
    };
    if (amountE8s == 0 or amountE8s > MAX_TRANSFER_E8S) {
      return #err(agentError("INVALID_TRANSFER_AMOUNT", "ICP transfer amount is outside the allowed range.", false, caller));
    };
    switch (to.subaccount) {
      case (?subaccount) {
        if (subaccount.size() != 32) {
          return #err(agentError("INVALID_SUBACCOUNT", "ICRC-1 subaccounts must be exactly 32 bytes.", false, caller));
        };
      };
      case null {};
    };
    if (not acquireLock(ledgerLocks, caller)) {
      return #err(agentError("TRANSFER_IN_PROGRESS", "Another ICP operation is already in progress for this account.", true, caller));
    };

    let transfer = switch (AgentLib.getTransfer(agentState, caller, idempotencyKey)) {
      case (?existing) {
        if (existing.to != to or existing.amountE8s != amountE8s) {
          releaseLock(ledgerLocks, caller);
          return #err(agentError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key belongs to a different transfer. Use a new key for a new action.",
            false,
            caller,
          ));
        };
        switch (existing.status) {
          case (#completed) {
            releaseLock(ledgerLocks, caller);
            return #ok(AgentLib.toTransfer(existing));
          };
          case (#failed) {
            releaseLock(ledgerLocks, caller);
            return #err(agentError(
              "TRANSFER_FAILED",
              optionText(existing.error, "The previous transfer failed. Use a new idempotency key after resolving the problem."),
              false,
              caller,
            ));
          };
          case (#pending) {};
        };
        existing;
      };
      case null {
        if (not AgentLib.reservePaymentOperationSlot(agentState, caller)) {
          releaseLock(ledgerLocks, caller);
          return #err(agentError(
            "PAYMENT_HISTORY_LIMIT",
            "This app account has reached its retained ICP payment-history limit. Contact the app operator before creating another transfer.",
            false,
            caller,
          ));
        };
        AgentLib.createTransfer(agentState, caller, idempotencyKey, to, amountE8s);
      };
    };

    try {
      let result = await icpLedger.icrc1_transfer({
        from_subaccount = ?AgentLib.subaccountFor(caller);
        to;
        amount = transfer.amountE8s;
        fee = null;
        memo = null;
        created_at_time = ?transfer.createdAtNanos;
      });
      switch (result) {
        case (#Ok(blockIndex)) {
          AgentLib.completeTransfer(transfer, blockIndex);
          #ok(AgentLib.toTransfer(transfer));
        };
        case (#Err(#Duplicate({ duplicate_of }))) {
          AgentLib.completeTransfer(transfer, duplicate_of);
          #ok(AgentLib.toTransfer(transfer));
        };
        case (#Err(error)) {
          let message = transferErrorText(error);
          let retryable = isRetryableTransferError(error);
          AgentLib.failTransfer(transfer, message, not retryable);
          #err(agentError("ICP_TRANSFER_FAILED", message, retryable, caller));
        };
      };
    } catch (error) {
      let message = "ICP ledger call outcome is not confirmed: " # error.message() # ". Retry with the same idempotency key.";
      AgentLib.failTransfer(transfer, message, false);
      #err(agentError("ICP_TRANSFER_UNCONFIRMED", message, true, caller));
    } finally {
      releaseLock(ledgerLocks, caller);
    };
  };

  /// Reserves prepaid phone time and queues a call for the external voice
  /// bridge. It never exposes Twilio/xAI secrets or the reservation token.
  public shared ({ caller }) func agentQueueCall(
    input : AgentTypes.AgentCallInput,
  ) : async AgentTypes.AgentCallResult {
    requireAgent(caller);
    switch (validateIdempotencyKey(input.idempotencyKey)) {
      case (?message) {
        return #err(agentError("INVALID_IDEMPOTENCY_KEY", message, false, caller));
      };
      case null {};
    };
    switch (AgentLib.getCallJobByIdempotency(agentState, caller, input.idempotencyKey)) {
      case (?existing) { return #ok(AgentLib.toCallJob(existing)) };
      case null {};
    };
    if (not ConfigLib.isE164(input.recipientPhone)) {
      return #err(agentError(
        "INVALID_PHONE_NUMBER",
        "Phone number must be E.164 format, for example +15551234567.",
        false,
        caller,
      ));
    };
    if (
      (input.captureOptions.saveTranscript or input.captureOptions.recordAudio) and
      not input.captureOptions.consentConfirmed
    ) {
      return #err(agentError(
        "CAPTURE_CONSENT_REQUIRED",
        "consentConfirmed must be true before saving transcripts or recordings.",
        false,
        caller,
      ));
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, input.presetId)) {
      case null {
        return #err(agentError("PRESET_NOT_FOUND", "Preset not found.", false, caller));
      };
      case (?preset) {
        if (preset.ownerId != caller and not AccessControl.isAdmin(accessControlState, caller)) {
          return #err(agentError("PRESET_NOT_FOUND", "Preset not found.", false, caller));
        };
      };
    };
    if (not AgentLib.canCreateCallJob(agentState, caller)) {
      return #err(agentError(
        "CALL_JOB_LIMIT",
        "This app account has too many retained or pending MCP call jobs. Wait for pending calls to finish or contact the app operator.",
        true,
        caller,
      ));
    };
    let available = BillingLib.getAvailableSeconds(billingState, caller);
    if (available == 0) {
      return #err(agentError(
        "PHONE_TIME_REQUIRED",
        "There is no available phone time. Tell the user the current ICP package prices and ask before buying a package.",
        false,
        caller,
      ));
    };
    if (not acquireLock(callLocks, caller)) {
      return #err(agentError("CALL_REQUEST_IN_PROGRESS", "Another call request is already being prepared for this account.", true, caller));
    };

    try {
      let callToken = await agentRandomCallToken();
      switch (AgentLib.getCallJobByIdempotency(agentState, caller, input.idempotencyKey)) {
        case (?existing) { #ok(AgentLib.toCallJob(existing)) };
        case null {
          let callRecord = CallsLib.createCallRecord(
            callsState,
            caller,
            input.recipientPhone,
            input.presetId,
          );
          let reservation = BillingLib.createReservation(
            billingState,
            caller,
            input.recipientPhone,
            input.presetId,
            callRecord.id,
            callToken,
          );
          switch (reservation) {
            case (#err(message)) {
              ignore CallsLib.updateCallRecord(
                callsState,
                callRecord.id,
                #failed,
                null,
                ?Time.now(),
                ?message,
              );
              #err(agentError("CALL_RESERVATION_FAILED", message, false, caller));
            };
            case (#ok(reserved)) {
              let job = AgentLib.createCallJob(
                agentState,
                caller,
                input.idempotencyKey,
                reserved,
                callToken,
                input.captureOptions,
              );
              CallsLib.addSystemLog(
                callsState,
                #info,
                "Queued MCP agent call job " # job.id # " for call " # callRecord.id.toText(),
                ?callRecord.id,
              );
              #ok(AgentLib.toCallJob(job));
            };
          };
        };
      };
    } catch (error) {
      #err(agentError(
        "CALL_QUEUE_FAILED",
        "Unable to create a secure call token: " # error.message(),
        true,
        caller,
      ));
    } finally {
      releaseLock(callLocks, caller);
    };
  };

  /// Lists the authenticated principal's recent MCP-created call jobs.
  public query ({ caller }) func agentListCallJobs() : async [AgentTypes.AgentCallJob] {
    requireAgent(caller);
    AgentLib.listCallJobsForUser(agentState, caller);
  };

  /// Cancels a queued/claimed MCP call before dispatch and releases reserved
  /// phone time. Dispatched calls must be ended through the voice bridge.
  public shared ({ caller }) func agentCancelQueuedCall(
    jobId : Text,
  ) : async Bool {
    requireAgent(caller);
    switch (AgentLib.cancelCallJob(agentState, jobId, caller)) {
      case null { false };
      case (?reservationId) {
        ignore BillingLib.cancelReservation(
          billingState,
          reservationId,
          "Canceled by the authenticated agent before dispatch",
        );
        switch (AgentLib.getCallJob(agentState, jobId)) {
          case (?job) {
            ignore CallsLib.updateCallRecord(
              callsState,
              job.callId,
              #failed,
              null,
              ?Time.now(),
              ?"Canceled before dispatch",
            );
          };
          case null {};
        };
        true;
      };
    };
  };

  /// Structured transcript and signed recording link for a call owned by the
  /// authenticated principal. Audio bytes remain off-chain.
  public query ({ caller }) func agentGetCallArtifacts(
    callId : Nat,
  ) : async ?AgentTypes.AgentCallArtifacts {
    requireAgent(caller);
    switch (CallsLib.getCallRecord(callsState, callId)) {
      case null { null };
      case (?call) {
        if (call.userId != caller and not AccessControl.isAdmin(accessControlState, caller)) {
          return null;
        };
        ?AgentLib.artifacts(CallsLib.toPublic(call));
      };
    };
  };

  /// Voice-server query. Returns only bounded public job metadata.
  public query ({ caller }) func listPendingAgentCallsForServer(
    limit : Nat,
  ) : async [AgentTypes.AgentCallJob] {
    requireServer(caller);
    AgentLib.listPendingCallJobs(agentState, limit);
  };

  /// Voice-server claim. The private reservation token is revealed only to
  /// the authenticated server administrator after an atomic claim.
  public shared ({ caller }) func claimAgentCallForServer(
    jobId : Text,
  ) : async ?AgentTypes.AgentCallDispatch {
    requireServer(caller);
    AgentLib.claimCallJob(agentState, jobId);
  };

  /// Voice-server acknowledgement after /initiate-call accepts the job.
  public shared ({ caller }) func completeAgentCallDispatchForServer(
    jobId : Text,
    callSid : ?Text,
    serverSessionId : ?Text,
  ) : async Bool {
    requireServer(caller);
    AgentLib.completeCallDispatch(agentState, jobId, callSid, serverSessionId);
  };

  /// Voice-server failure path. Cancels the reservation and finalizes the
  /// call record so phone time is not stranded.
  public shared ({ caller }) func failAgentCallDispatchForServer(
    jobId : Text,
    errorMessage : Text,
  ) : async Bool {
    requireServer(caller);
    let cleanMessage = truncate(errorMessage, MAX_CALL_CAPTURE_ERROR_CHARS);
    switch (AgentLib.getCallJob(agentState, jobId)) {
      case null { false };
      case (?job) {
        ignore AgentLib.failCallDispatch(agentState, jobId, cleanMessage);
        ignore BillingLib.cancelReservation(billingState, job.reservationId, cleanMessage);
        ignore CallsLib.updateCallRecord(
          callsState,
          job.callId,
          #failed,
          null,
          ?Time.now(),
          ?cleanMessage,
        );
        CallsLib.addSystemLog(
          callsState,
          #warn,
          "MCP agent call dispatch failed for " # jobId # ": " # cleanMessage,
          ?job.callId,
        );
        true;
      };
    };
  };

  private func finishIcpPurchase(
    purchase : AgentTypes.StoredIcpPurchase,
    blockIndex : Nat,
  ) : AgentTypes.IcpPurchaseResult {
    switch (BillingLib.creditPhoneSeconds(billingState, purchase.user, purchase.seconds)) {
      case (#err(message)) {
        AgentLib.failPurchase(purchase, message, false);
        #err(agentError("PHONE_TIME_CREDIT_FAILED", message # ". Retry with the same idempotency key.", true, purchase.user));
      };
      case (#ok(_)) {
        AgentLib.completePurchase(purchase, blockIndex);
        CallsLib.addSystemLog(
          callsState,
          #info,
          "Credited " # purchase.seconds.toText() # " seconds from ICP ledger block " # blockIndex.toText(),
          null,
        );
        #ok(AgentLib.toPurchase(purchase));
      };
    };
  };

  private func agentError(
    code : Text,
    message : Text,
    retryable : Bool,
    user : Principal,
  ) : AgentTypes.AgentError {
    AgentLib.makeError(
      agentState,
      code,
      message,
      retryable,
      BillingLib.getAvailableSeconds(billingState, user),
    );
  };

  private func requireAgent(caller : Principal) {
    if (caller.isAnonymous()) {
      Runtime.trap("Unauthorized: authenticate through Internet Identity");
    };
    switch (AgentLib.getProfile(agentState, caller)) {
      case null { Runtime.trap("Unauthorized: call agentInitialize first") };
      case (?_) {};
    };
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: call agentInitialize first");
    };
  };

  private func requireServer(caller : Principal) {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
  };

  private func validateIdempotencyKey(value : Text) : ?Text {
    let size = value.toArray().size();
    if (size < 8) {
      ?"Idempotency key must be at least 8 characters.";
    } else if (size > MAX_IDEMPOTENCY_KEY_CHARS) {
      ?"Idempotency key must be 120 characters or fewer.";
    } else {
      null;
    };
  };

  private func acquireLock(
    locks : Map.Map<Principal, Bool>,
    caller : Principal,
  ) : Bool {
    switch (locks.get(caller)) {
      case (?_) { false };
      case null {
        locks.add(caller, true);
        true;
      };
    };
  };

  private func releaseLock(
    locks : Map.Map<Principal, Bool>,
    caller : Principal,
  ) {
    locks.remove(caller);
  };

  private func agentRandomCallToken() : async Text {
    let entropy = await Random.blob();
    var token = "ct_";
    for (byte in entropy.toArray().values()) {
      token #= agentByteToHex(byte);
    };
    token;
  };

  private func agentByteToHex(byte : Nat8) : Text {
    let alphabet = "0123456789abcdef".toArray();
    let value = byte.toNat();
    Text.fromChar(alphabet[value / 16]) # Text.fromChar(alphabet[value % 16]);
  };

  private func optionText(value : ?Text, fallback : Text) : Text {
    switch (value) {
      case (?text) { text };
      case null { fallback };
    };
  };

  private func truncate(value : Text, maxChars : Nat) : Text {
    let chars = value.toArray();
    if (chars.size() <= maxChars) {
      value;
    } else {
      Text.fromArray(chars.sliceToArray(0, maxChars));
    };
  };

  private func transferErrorText(error : TransferError) : Text {
    switch (error) {
      case (#BadFee({ expected_fee })) { "ICP ledger fee changed; expected " # expected_fee.toText() # " e8s." };
      case (#BadBurn({ min_burn_amount })) { "Transfer is below the minimum burn amount of " # min_burn_amount.toText() # " e8s." };
      case (#InsufficientFunds({ balance })) { "Insufficient ICP balance. Current balance is " # balance.toText() # " e8s plus the ledger fee." };
      case (#TooOld) { "The transfer timestamp is too old. Use a new idempotency key." };
      case (#CreatedInFuture(_)) { "The transfer timestamp is in the future. Check network time and retry." };
      case (#Duplicate({ duplicate_of })) { "Duplicate of ledger block " # duplicate_of.toText() # "." };
      case (#TemporarilyUnavailable) { "The ICP ledger is temporarily unavailable." };
      case (#GenericError({ error_code; message })) { "ICP ledger error " # error_code.toText() # ": " # message };
    };
  };

  private func isRetryableTransferError(error : TransferError) : Bool {
    switch (error) {
      case (#TemporarilyUnavailable) { true };
      case (#CreatedInFuture(_)) { true };
      case _ { false };
    };
  };

  private func exchangeRateErrorText(error : ExchangeRateError) : Text {
    switch (error) {
      case (#Pending) { "the rate is pending" };
      case (#RateLimited) { "the rate service is temporarily rate limited" };
      case (#NotEnoughCycles) { "the canister needs at least one billion cycles for the refresh" };
      case (#FailedToAcceptCycles) { "the rate service could not accept cycles" };
      case (#InconsistentRatesReceived) { "source rates were too inconsistent" };
      case (#CryptoBaseAssetNotFound) { "ICP was not found by the source exchanges" };
      case (#CryptoQuoteAssetNotFound) { "USD quote data was not found" };
      case (#StablecoinRateNotFound) { "a stablecoin reference rate was not found" };
      case (#StablecoinRateTooFewRates) { "too few stablecoin rates were available" };
      case (#StablecoinRateZeroRate) { "a stablecoin reference rate was zero" };
      case (#ForexInvalidTimestamp) { "the forex timestamp was invalid" };
      case (#ForexBaseAssetNotFound) { "the forex base asset was not found" };
      case (#ForexQuoteAssetNotFound) { "the forex quote asset was not found" };
      case (#ForexAssetsNotFound) { "forex assets were not found" };
      case (#AnonymousPrincipalNotAllowed) { "anonymous XRC calls are not allowed" };
      case (#Other({ code; description })) { "XRC error " # code.toText() # ": " # description };
    };
  };
};
