import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";
import ConfigLib "../lib/config";
import IdentityLib "../lib/identity";
import ConfigTypes "../types/config";
import Common "../types/common";

mixin (
  accessControlState : AccessControl.AccessControlState,
  identityState : IdentityLib.State,
  configState : ConfigLib.State,
  callPresetVoiceIds : ConfigLib.VoiceIdState,
  twilioLineState : ConfigLib.TwilioLineState,
  answeringState : ConfigLib.AnsweringState,
  answeringPresetVoiceIds : ConfigLib.VoiceIdState,
) {
  private func configAccountOf(caller : Principal) : Principal {
    IdentityLib.resolve(identityState, caller);
  };
  // Admin: view non-secret line routing. Service-secret flags remain in the
  // response only for Candid compatibility and are always false.
  public query ({ caller }) func getAdminConfig() : async {
    twilioAccountSid : Text;
    twilioFromNumber : Text;
    twilioPhoneNumbers : [ConfigTypes.TwilioLine];
    hasXaiKey : Bool;
    hasTwilioAuth : Bool;
  } {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.getAdminConfig(configState, twilioLineState);
  };

  // Legacy Candid endpoint. Secret arguments are rejected; only the public
  // fallback phone number remains accepted for upgrade compatibility.
  public shared ({ caller }) func setAdminConfig(
    xaiApiKey : Text,
    twilioAccountSid : Text,
    twilioAuthToken : Text,
    twilioFromNumber : Text,
  ) : async () {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.setAdminConfig(configState, twilioLineState, xaiApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber);
  };

  public shared ({ caller }) func setTwilioLine(
    input : ConfigTypes.TwilioLineInput,
  ) : async ConfigTypes.TwilioLineMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.setTwilioLine(configState, twilioLineState, input);
  };

  public shared ({ caller }) func removeTwilioLine(
    phoneNumber : Text,
  ) : async ConfigTypes.TwilioLineMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.removeTwilioLine(configState, twilioLineState, phoneNumber);
  };

  public shared ({ caller }) func setTwilioLineEnabled(
    phoneNumber : Text,
    enabled : Bool,
  ) : async ConfigTypes.TwilioLineMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.setTwilioLineEnabled(configState, twilioLineState, phoneNumber, enabled);
  };

  public query ({ caller }) func getTwilioLineNumbersForServer() : async [Text] {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.listEnabledTwilioNumbers(configState, twilioLineState);
  };

  // Preset CRUD
  public shared ({ caller }) func createPreset(
    input : ConfigTypes.CallPresetInput,
  ) : async ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.createPreset(configState, callPresetVoiceIds, configAccountOf(caller), input);
  };

  public query ({ caller }) func getPreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (
          IdentityLib.sameAccount(identityState, caller, preset.ownerId) or
          AccessControl.isAdmin(accessControlState, caller)
        ) {
          ?preset;
        } else {
          null;
        };
      };
    };
  };

  public query ({ caller }) func getPresetForServer(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.getPreset(configState, callPresetVoiceIds, id);
  };

  public query ({ caller }) func listMyPresets() : async [ConfigTypes.CallPreset] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    // Union presets owned by any principal in the linked account group.
    let group = IdentityLib.accountGroup(identityState, caller);
    if (group.size() == 1) {
      return ConfigLib.listPresetsForUser(configState, callPresetVoiceIds, group[0]);
    };
    ConfigLib.listPresetsForUsers(configState, callPresetVoiceIds, group);
  };

  public shared ({ caller }) func updatePreset(
    id : Common.PresetId,
    input : ConfigTypes.CallPresetInput,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        // Keep historical owner id; linked sessions act as the owner via sameAccount.
        ConfigLib.updatePreset(configState, callPresetVoiceIds, preset.ownerId, id, input);
      };
    };
  };

  public shared ({ caller }) func updatePresetInstructions(
    id : Common.PresetId,
    systemPrompt : Text,
  ) : async ConfigTypes.CallPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { #err("Preset not found.") };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        ConfigLib.updatePresetInstructions(
          configState,
          callPresetVoiceIds,
          preset.ownerId,
          id,
          systemPrompt,
        );
      };
    };
  };

  public shared ({ caller }) func deletePreset(
    id : Common.PresetId,
  ) : async Bool {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { false };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        ConfigLib.deletePreset(configState, callPresetVoiceIds, preset.ownerId, id);
      };
    };
  };

  public shared ({ caller }) func duplicatePreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (
          IdentityLib.sameAccount(identityState, caller, preset.ownerId) or
          AccessControl.isAdmin(accessControlState, caller)
        ) {
          ConfigLib.duplicatePreset(configState, callPresetVoiceIds, configAccountOf(caller), id);
        } else {
          null;
        };
      };
    };
  };

  public shared ({ caller }) func createAnsweringPreset(
    input : ConfigTypes.AnsweringPresetInput,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.createAnsweringPreset(answeringState, answeringPresetVoiceIds, configAccountOf(caller), input);
  };

  public query ({ caller }) func listMyAnsweringPresets() : async [ConfigTypes.AnsweringPreset] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.listAnsweringPresetsForUser(
      answeringState,
      answeringPresetVoiceIds,
      configAccountOf(caller),
    );
  };

  public query ({ caller }) func getAnsweringPreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.AnsweringPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: can only view your own answering presets");
        };
        ?preset;
      };
    };
  };

  public shared ({ caller }) func updateAnsweringPreset(
    id : Common.PresetId,
    input : ConfigTypes.AnsweringPresetInput,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
      case null { #err("Answering preset not found.") };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        ConfigLib.updateAnsweringPreset(
          answeringState,
          answeringPresetVoiceIds,
          preset.ownerId,
          id,
          input,
        );
      };
    };
  };

  public shared ({ caller }) func updateAnsweringPresetInstructions(
    id : Common.PresetId,
    systemPrompt : Text,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
      case null { #err("Answering preset not found.") };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        ConfigLib.updateAnsweringPresetInstructions(
          answeringState,
          answeringPresetVoiceIds,
          preset.ownerId,
          id,
          systemPrompt,
        );
      };
    };
  };

  public shared ({ caller }) func deleteAnsweringPreset(
    id : Common.PresetId,
  ) : async Bool {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
      case null { false };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        ConfigLib.deleteAnsweringPreset(
          answeringState,
          answeringPresetVoiceIds,
          preset.ownerId,
          id,
        );
      };
    };
  };

  public shared ({ caller }) func setAnsweringPresetEnabled(
    id : Common.PresetId,
    enabled : Bool,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
      case null { #err("Answering preset not found.") };
      case (?preset) {
        if (
          not IdentityLib.sameAccount(identityState, caller, preset.ownerId) and
          not AccessControl.isAdmin(accessControlState, caller)
        ) {
          Runtime.trap("Unauthorized: not the owner");
        };
        ConfigLib.setAnsweringPresetEnabled(
          answeringState,
          answeringPresetVoiceIds,
          preset.ownerId,
          id,
          enabled,
        );
      };
    };
  };

  public query ({ caller }) func getAnsweringPresetForServer(
    webhookSecret : Text,
    phoneNumber : Text,
  ) : async ?ConfigTypes.AnsweringPreset {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.getAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber);
  };

  public shared ({ caller }) func verifyAnsweringPresetForServer(
    webhookSecret : Text,
    phoneNumber : Text,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.verifyAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber);
  };
};
