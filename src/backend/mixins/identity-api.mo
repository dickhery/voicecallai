import AccessControl "mo:caffeineai-authorization/access-control";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import BillingLib "../lib/billing";
import IdentityLib "../lib/identity";
import IdentityTypes "../types/identity";

/// Shared human/agent account identity for Internet Identity principals.
/// Session principals that belong to the same user (web app vs MCP) can be
/// linked so phone-time balances, call history, and deposit accounts match.
mixin (
  accessControlState : AccessControl.AccessControlState,
  identityState : IdentityLib.State,
  billingState : BillingLib.State,
) {
  /// Returns the caller's session principal, canonical account principal, and
  /// linked group. Cheap query — no inter-canister calls.
  public query ({ caller }) func getMyAccountIdentity() : async IdentityTypes.AccountIdentity {
    if (caller.isAnonymous()) {
      Runtime.trap("Unauthorized: authenticate through Internet Identity");
    };
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    IdentityLib.describe(identityState, caller);
  };

  /// Create a short-lived code that another authenticated principal (same human
  /// or agent session) can claim to share this account. Cycle-cheap pure state.
  public shared ({ caller }) func createAccountLinkOffer() : async IdentityTypes.CreateLinkOfferResult {
    if (caller.isAnonymous()) {
      return #err("Authenticate before creating a link code.");
    };
    AccessControl.initialize(accessControlState, caller);
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      return #err("Unauthorized: must be logged in");
    };
    IdentityLib.createLinkOffer(identityState, caller);
  };

  /// Claim a link code issued by another principal. Attaches this session to
  /// that account and moves unreserved phone-time seconds into the primary.
  public shared ({ caller }) func claimAccountLinkOffer(
    code : Text,
  ) : async IdentityTypes.ClaimLinkOfferResult {
    if (caller.isAnonymous()) {
      return #err("Authenticate before claiming a link code.");
    };
    AccessControl.initialize(accessControlState, caller);
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      return #err("Unauthorized: must be logged in");
    };
    switch (IdentityLib.claimLinkOffer(identityState, caller, code)) {
      case (#err(message)) { #err(message) };
      case (#ok(outcome)) {
        // Move free prepaid seconds so Stripe/ICP top-ups become visible on
        // the shared primary without leaving residual balance on the secondary.
        ignore BillingLib.moveAvailableBalance(
          billingState,
          outcome.secondary,
          outcome.primary,
        );
        #ok(outcome.identity);
      };
    };
  };
};
