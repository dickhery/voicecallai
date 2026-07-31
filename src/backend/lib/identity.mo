import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types/identity";

module {
  private let LINK_OFFER_TTL_NS : Int = 900_000_000_000; // 15 minutes
  private let MAX_LINK_OFFERS : Nat = 200;
  private let MAX_GROUP_SIZE : Nat = 8;
  private let CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  public type State = {
    /// secondary session principal -> canonical account principal
    aliases : Map.Map<Principal, Principal>;
    /// primary -> linked secondaries (does not include primary)
    secondariesByPrimary : Map.Map<Principal, List.List<Principal>>;
    linkOffers : Map.Map<Text, Types.LinkOffer>;
    nextOfferNonce : { var value : Nat };
  };

  public func initState() : State {
    {
      aliases = Map.empty<Principal, Principal>();
      secondariesByPrimary = Map.empty<Principal, List.List<Principal>>();
      linkOffers = Map.empty<Text, Types.LinkOffer>();
      nextOfferNonce = { var value = 1 };
    };
  };

  public func resolve(state : State, caller : Principal) : Principal {
    if (caller.isAnonymous()) {
      return caller;
    };
    switch (state.aliases.get(caller)) {
      case (?primary) { primary };
      case null { caller };
    };
  };

  public func sameAccount(
    state : State,
    caller : Principal,
    owner : Principal,
  ) : Bool {
    Principal.equal(resolve(state, caller), resolve(state, owner));
  };

  public func accountGroup(state : State, caller : Principal) : [Principal] {
    let primary = resolve(state, caller);
    switch (state.secondariesByPrimary.get(primary)) {
      case null { [primary] };
      case (?secondaries) {
        let items = secondaries.toArray();
        Array.tabulate<Principal>(
          items.size() + 1,
          func(i) {
            if (i == 0) { primary } else { items[i - 1] };
          },
        );
      };
    };
  };

  public func describe(state : State, caller : Principal) : Types.AccountIdentity {
    let accountPrincipal = resolve(state, caller);
    let groupPrincipals = accountGroup(state, caller);
    {
      sessionPrincipal = caller;
      accountPrincipal;
      groupPrincipals;
      isLinked = groupPrincipals.size() > 1 or not Principal.equal(caller, accountPrincipal);
    };
  };

  private func pruneExpiredOffers(state : State) {
    let now = Time.now();
    let expired = List.empty<Text>();
    state.linkOffers.forEach(func(code, offer) {
      if (offer.expiresAt <= now) {
        expired.add(code);
      };
    });
    for (code in expired.values()) {
      state.linkOffers.remove(code);
    };
    // Bound map size for cycle/memory safety.
    if (state.linkOffers.size() <= MAX_LINK_OFFERS) {
      return;
    };
    var oldestCode : ?Text = null;
    var oldestAt : Int = 0;
    state.linkOffers.forEach(func(code, offer) {
      switch (oldestCode) {
        case null {
          oldestCode := ?code;
          oldestAt := offer.createdAt;
        };
        case (?_) {
          if (offer.createdAt < oldestAt) {
            oldestCode := ?code;
            oldestAt := offer.createdAt;
          };
        };
      };
    });
    switch (oldestCode) {
      case (?code) { state.linkOffers.remove(code) };
      case null {};
    };
  };

  private func generateCode(state : State, issuer : Principal) : Text {
    state.nextOfferNonce.value += 1;
    let now = Time.now();
    // Cheap deterministic mix of principal bytes + time + nonce (no RNG / cycles).
    var mix : Nat = state.nextOfferNonce.value;
    mix += Int.abs(now % 1_000_000_000_000);
    for (byte in issuer.toBlob().values()) {
      mix := mix * 131 + byte.toNat() + 17;
    };
    let alphabet = CODE_ALPHABET.toArray();
    let alphabetSize = alphabet.size();
    var n = mix;
    let chars = List.empty<Char>();
    var i = 0;
    while (i < 8) {
      let index = n % alphabetSize;
      chars.add(alphabet[index]);
      n := n / alphabetSize + (i + 3) * 17;
      i += 1;
    };
    Text.fromArray(chars.toArray());
  };

  public func createLinkOffer(
    state : State,
    issuer : Principal,
  ) : Types.CreateLinkOfferResult {
    if (issuer.isAnonymous()) {
      return #err("Authenticate before creating a link code.");
    };
    pruneExpiredOffers(state);
    let primary = resolve(state, issuer);
    let group = accountGroup(state, issuer);
    if (group.size() >= MAX_GROUP_SIZE) {
      return #err("This account already has the maximum number of linked identities.");
    };
    var code = generateCode(state, issuer);
    var attempts = 0;
    while (state.linkOffers.get(code) != null and attempts < 5) {
      code := generateCode(state, issuer);
      attempts += 1;
    };
    if (state.linkOffers.get(code) != null) {
      return #err("Unable to allocate a unique link code. Retry shortly.");
    };
    let now = Time.now();
    let offer : Types.LinkOffer = {
      code;
      issuer;
      primary;
      createdAt = now;
      expiresAt = now + LINK_OFFER_TTL_NS;
    };
    state.linkOffers.add(code, offer);
    #ok({
      code;
      expiresAt = offer.expiresAt;
      accountPrincipal = primary;
    });
  };

  public type ClaimOutcome = {
    identity : Types.AccountIdentity;
    /// Secondary principal that was attached (claimer before claim).
    secondary : Principal;
    /// Canonical primary after claim.
    primary : Principal;
  };

  public func claimLinkOffer(
    state : State,
    claimer : Principal,
    rawCode : Text,
  ) : { #ok : ClaimOutcome; #err : Text } {
    if (claimer.isAnonymous()) {
      return #err("Authenticate before claiming a link code.");
    };
    pruneExpiredOffers(state);
    let code = rawCode.trim(#char(' ')).toUpper();
    if (code.toArray().size() < 6 or code.toArray().size() > 16) {
      return #err("Link code format is invalid.");
    };
    let offer = switch (state.linkOffers.get(code)) {
      case null { return #err("Link code is unknown or expired.") };
      case (?value) { value };
    };
    state.linkOffers.remove(code);
    if (offer.expiresAt <= Time.now()) {
      return #err("Link code has expired. Create a new one.");
    };

    let primary = resolve(state, offer.primary);
    let claimerAccount = resolve(state, claimer);
    if (Principal.equal(claimerAccount, primary)) {
      return #err("These identities already share the same account.");
    };

    // Refuse to attach a primary that already has its own secondaries as a secondary.
    switch (state.secondariesByPrimary.get(claimerAccount)) {
      case (?list) {
        if (list.size() > 0) {
          return #err("Unlink or merge the claimer's existing group before linking to another account.");
        };
      };
      case null {};
    };

    let primaryGroup = accountGroup(state, primary);
    if (primaryGroup.size() >= MAX_GROUP_SIZE) {
      return #err("Target account already has the maximum number of linked identities.");
    };

    // Point claimer (and any alias that already resolved to claimerAccount) at primary.
    state.aliases.add(claimer, primary);
    if (not Principal.equal(claimer, claimerAccount)) {
      state.aliases.add(claimerAccount, primary);
    };

    let secondaries = switch (state.secondariesByPrimary.get(primary)) {
      case (?list) { list };
      case null {
        let list = List.empty<Principal>();
        state.secondariesByPrimary.add(primary, list);
        list;
      };
    };
    if (not secondaries.any(func(p) { Principal.equal(p, claimer) })) {
      secondaries.add(claimer);
    };
    if (
      not Principal.equal(claimer, claimerAccount) and
      not secondaries.any(func(p) { Principal.equal(p, claimerAccount) })
    ) {
      secondaries.add(claimerAccount);
    };

    // If claimer was previously a primary with no secondaries, drop empty map entry.
    state.secondariesByPrimary.remove(claimerAccount);

    #ok({
      identity = describe(state, claimer);
      secondary = claimerAccount;
      primary;
    });
  };
};
