module {
  public type LinkOffer = {
    code : Text;
    issuer : Principal;
    primary : Principal;
    createdAt : Int;
    expiresAt : Int;
  };

  public type AccountIdentity = {
    /// Principal used for this HTTP request / session (raw caller).
    sessionPrincipal : Principal;
    /// Canonical account principal used for balances, deposits, and new writes.
    accountPrincipal : Principal;
    /// All principals in the linked account group (for history/preset reads).
    groupPrincipals : [Principal];
    isLinked : Bool;
  };

  public type CreateLinkOfferResult = {
    #ok : { code : Text; expiresAt : Int; accountPrincipal : Principal };
    #err : Text;
  };

  public type ClaimLinkOfferResult = {
    #ok : AccountIdentity;
    #err : Text;
  };

  public type GetAccountIdentityResult = {
    #ok : AccountIdentity;
    #err : Text;
  };
};
