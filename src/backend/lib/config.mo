import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Char "mo:core/Char";
import Array "mo:core/Array";
import Order "mo:core/Order";
import Time "mo:core/Time";
import Types "../types/config";
import Common "../types/common";

module {
  private let MAX_AI_INSTRUCTIONS_CHARS : Nat = 8000;
  private let MAX_PRESET_NAME_CHARS : Nat = 80;
  private let MAX_CALL_PRESETS_PER_USER : Nat = 30;
  private let MAX_ANSWERING_PRESETS_PER_USER : Nat = 10;
  private let MAX_TWILIO_LINES : Nat = 25;
  private let MAX_TWILIO_LINE_NAME_CHARS : Nat = 60;

  public type State = {
    adminConfig : Types.AdminConfig;
    presets : Map.Map<Common.PresetId, Types.StoredCallPreset>;
    nextPresetId : { var value : Nat };
  };

  public type TwilioLineState = Map.Map<Text, Types.TwilioLine>;
  public type VoiceIdState = Map.Map<Common.PresetId, Text>;

  public type AnsweringState = {
    presets : Map.Map<Common.PresetId, Types.StoredAnsweringPreset>;
    presetIdsByOwner : Map.Map<Principal, List.List<Common.PresetId>>;
    presetIdByWebhookSecret : Map.Map<Text, Common.PresetId>;
    presetIdByPhoneNumber : Map.Map<Text, Common.PresetId>;
    nextAnsweringPresetId : { var value : Nat };
  };

  public func initState() : State {
    {
      adminConfig = {
        var xaiApiKey = "";
        var twilioAccountSid = "";
        var twilioAuthToken = "";
        var twilioFromNumber = "";
      };
      presets = Map.empty<Common.PresetId, Types.StoredCallPreset>();
      nextPresetId = { var value = 1 };
    };
  };

  public func clearLegacyServiceSecrets(state : State) {
    state.adminConfig.xaiApiKey := "";
    state.adminConfig.twilioAccountSid := "";
    state.adminConfig.twilioAuthToken := "";
  };

  public func initVoiceIdState() : VoiceIdState {
    Map.empty<Common.PresetId, Text>();
  };

  public func initTwilioLineState() : TwilioLineState {
    Map.empty<Text, Types.TwilioLine>();
  };

  public func initAnsweringState() : AnsweringState {
    {
      presets = Map.empty<Common.PresetId, Types.StoredAnsweringPreset>();
      presetIdsByOwner = Map.empty<Principal, List.List<Common.PresetId>>();
      presetIdByWebhookSecret = Map.empty<Text, Common.PresetId>();
      presetIdByPhoneNumber = Map.empty<Text, Common.PresetId>();
      nextAnsweringPresetId = { var value = 1 };
    };
  };

  private func isDigit(c : Char) : Bool {
    let code = c.toNat32();
    code >= 48 and code <= 57;
  };

  private func isAlpha(c : Char) : Bool {
    let code = c.toNat32();
    (code >= 65 and code <= 90) or (code >= 97 and code <= 122);
  };

  private func isNonZeroDigit(c : Char) : Bool {
    let code = c.toNat32();
    code >= 49 and code <= 57;
  };

  public func isE164(phoneNumber : Text) : Bool {
    let chars = phoneNumber.toArray();
    let size = chars.size();
    if (size < 3 or size > 16) {
      return false;
    };
    if (chars[0] != '+') {
      return false;
    };
    if (not isNonZeroDigit(chars[1])) {
      return false;
    };
    var i = 2;
    while (i < size) {
      if (not isDigit(chars[i])) {
        return false;
      };
      i += 1;
    };
    true;
  };

  private func compareLines(a : Types.TwilioLine, b : Types.TwilioLine) : Order.Order {
    Text.compare(a.phoneNumber, b.phoneNumber);
  };

  private func compareAnsweringNewestFirst(a : Types.AnsweringPreset, b : Types.AnsweringPreset) : Order.Order {
    switch (Int.compare(b.createdAt, a.createdAt)) {
      case (#equal) { Nat.compare(b.id, a.id) };
      case (order) { order };
    };
  };

  private func withStoredPresetDefaults(preset : Types.StoredCallPreset) : Types.StoredCallPreset {
    {
      preset with
      audioFormat = #pcmu;
      sampleRate = #hz8000;
      toolsEnabled = {
        webSearch = false;
        xSearch = false;
        functionCalling = false;
      };
    };
  };

  private func toPublicPreset(
    voiceIds : VoiceIdState,
    preset : Types.StoredCallPreset,
  ) : Types.CallPreset {
    let stored = withStoredPresetDefaults(preset);
    {
      id = stored.id;
      ownerId = stored.ownerId;
      name = stored.name;
      systemPrompt = stored.systemPrompt;
      voice = stored.voice;
      voiceId = voiceIds.get(stored.id);
      turnDetection = stored.turnDetection;
      audioFormat = stored.audioFormat;
      sampleRate = stored.sampleRate;
      toolsEnabled = stored.toolsEnabled;
    };
  };

  private func toPublicAnsweringPreset(
    voiceIds : VoiceIdState,
    preset : Types.StoredAnsweringPreset,
  ) : Types.AnsweringPreset {
    {
      id = preset.id;
      ownerId = preset.ownerId;
      name = preset.name;
      phoneNumber = preset.phoneNumber;
      systemPrompt = preset.systemPrompt;
      voice = preset.voice;
      voiceId = voiceIds.get(preset.id);
      turnDetection = preset.turnDetection;
      audioFormat = preset.audioFormat;
      sampleRate = preset.sampleRate;
      toolsEnabled = preset.toolsEnabled;
      captureOptions = preset.captureOptions;
      enabled = preset.enabled;
      verificationStatus = preset.verificationStatus;
      webhookSecret = preset.webhookSecret;
      createdAt = preset.createdAt;
      updatedAt = preset.updatedAt;
      verifiedAt = preset.verifiedAt;
      lastIncomingAt = preset.lastIncomingAt;
    };
  };

  private func setVoiceId(
    voiceIds : VoiceIdState,
    id : Common.PresetId,
    voiceId : ?Text,
  ) {
    switch (voiceId) {
      case null { voiceIds.remove(id) };
      case (?value) { voiceIds.add(id, value) };
    };
  };

  private func sanitizeInstructions(
    input : Text,
    requiredMessage : Text,
  ) : {
    #ok : Text;
    #err : Text;
  } {
    let prompt = input.trim(#char ' ');
    if (prompt == "") {
      return #err(requiredMessage);
    };
    if (prompt.toArray().size() > MAX_AI_INSTRUCTIONS_CHARS) {
      return #err("AI instructions must be 8000 characters or fewer.");
    };
    #ok(prompt);
  };

  private func isVoiceIdChar(c : Char) : Bool {
    isAlpha(c) or isDigit(c) or c == '-' or c == '_';
  };

  private func sanitizeVoiceId(input : ?Text) : {
    #ok : ?Text;
    #err : Text;
  } {
    switch (input) {
      case null { #ok(null) };
      case (?raw) {
        let value = raw.trim(#char ' ');
        if (value == "") {
          return #ok(null);
        };
        let chars = value.toArray();
        if (chars.size() > 80) {
          return #err("Voice ID must be 80 characters or fewer.");
        };
        for (char in chars.values()) {
          if (not isVoiceIdChar(char)) {
            return #err("Voice ID can only contain letters, numbers, dashes, and underscores.");
          };
        };
        #ok(?value);
      };
    };
  };

  private func requireCallPresetInput(input : Types.CallPresetInput) : Types.CallPresetInput {
    let name = input.name.trim(#char ' ');
    if (name == "") {
      Runtime.trap("Preset name is required.");
    };
    if (name.toArray().size() > MAX_PRESET_NAME_CHARS) {
      Runtime.trap("Preset name must be 80 characters or fewer.");
    };
    let prompt = switch (sanitizeInstructions(input.systemPrompt, "AI instructions are required.")) {
      case (#err(message)) { Runtime.trap(message) };
      case (#ok(value)) { value };
    };
    let voiceId = switch (sanitizeVoiceId(input.voiceId)) {
      case (#err(message)) { Runtime.trap(message) };
      case (#ok(value)) { value };
    };
    {
      input with
      name = name;
      systemPrompt = prompt;
      voiceId = voiceId;
      audioFormat = #pcmu;
      sampleRate = #hz8000;
      toolsEnabled = {
        webSearch = false;
        xSearch = false;
        functionCalling = false;
      };
    };
  };

  private func legacyTwilioLine(state : State) : ?Types.TwilioLine {
    let phoneNumber = state.adminConfig.twilioFromNumber;
    if (phoneNumber == "" or not isE164(phoneNumber)) {
      return null;
    };
    ?{
      phoneNumber;
      name = "Primary line";
      enabled = true;
    };
  };

  private func sanitizeLineInput(input : Types.TwilioLineInput) : {
    #ok : Types.TwilioLine;
    #err : Text;
  } {
    if (not isE164(input.phoneNumber)) {
      return #err("Phone number must be E.164 format, for example +15551234567.");
    };
    let name = input.name.trim(#char ' ');
    if (name.toArray().size() > MAX_TWILIO_LINE_NAME_CHARS) {
      return #err("Twilio line name must be 60 characters or fewer.");
    };
    #ok({
      phoneNumber = input.phoneNumber;
      name = if (name == "") { input.phoneNumber } else { name };
      enabled = input.enabled;
    });
  };

  private func isWebhookSecretChar(c : Char) : Bool {
    let code = c.toNat32();
    (code >= 48 and code <= 57) or
    (code >= 65 and code <= 90) or
    (code >= 97 and code <= 122) or
    c == '-' or c == '_';
  };

  private func isValidWebhookSecret(secret : Text) : Bool {
    let chars = secret.toArray();
    let size = chars.size();
    if (size < 32 or size > 160) {
      return false;
    };
    var i = 0;
    while (i < size) {
      if (not isWebhookSecretChar(chars[i])) {
        return false;
      };
      i += 1;
    };
    true;
  };

  private func sanitizeAnsweringInput(input : Types.AnsweringPresetInput) : {
    #ok : Types.AnsweringPresetInput;
    #err : Text;
  } {
    let name = input.name.trim(#char ' ');
    if (name == "") {
      return #err("Preset name is required.");
    };
    if (name.toArray().size() > MAX_PRESET_NAME_CHARS) {
      return #err("Preset name must be 80 characters or fewer.");
    };
    let prompt = switch (sanitizeInstructions(input.systemPrompt, "AI answering instructions are required.")) {
      case (#err(message)) { return #err(message) };
      case (#ok(value)) { value };
    };
    let voiceId = switch (sanitizeVoiceId(input.voiceId)) {
      case (#err(message)) { return #err(message) };
      case (#ok(value)) { value };
    };
    if (not isE164(input.phoneNumber)) {
      return #err("Twilio phone number must be E.164 format, for example +15551234567.");
    };
    if (not isValidWebhookSecret(input.webhookSecret)) {
      return #err("Webhook verification secret is invalid.");
    };
    if (
      (input.captureOptions.saveTranscript or input.captureOptions.recordAudio) and
      not input.captureOptions.consentConfirmed
    ) {
      return #err("Confirm caller consent before saving transcripts or recordings.");
    };
    #ok({
      input with
      name = name;
      systemPrompt = prompt;
      voiceId = voiceId;
      audioFormat = #pcmu;
      sampleRate = #hz8000;
      toolsEnabled = {
        webSearch = input.toolsEnabled.webSearch;
        xSearch = input.toolsEnabled.xSearch;
        functionCalling = false;
      };
    });
  };

  private func getExistingPendingAnsweringPreset(
    state : AnsweringState,
    owner : Principal,
  ) : ?Types.StoredAnsweringPreset {
    for (preset in state.presets.values()) {
      if (
        Principal.equal(preset.ownerId, owner) and
        preset.verificationStatus == #pendingVerification
      ) {
        return ?preset;
      };
    };
    null;
  };

  private func countCallPresetsForOwner(state : State, owner : Principal) : Nat {
    var count = 0;
    for (preset in state.presets.values()) {
      if (Principal.equal(preset.ownerId, owner)) {
        count += 1;
      };
    };
    count;
  };

  private func countAnsweringPresetsForOwner(
    state : AnsweringState,
    owner : Principal,
  ) : Nat {
    var count = 0;
    for (preset in state.presets.values()) {
      if (Principal.equal(preset.ownerId, owner)) {
        count += 1;
      };
    };
    count;
  };

  public func listTwilioLines(
    state : State,
    twilioLineState : TwilioLineState,
  ) : [Types.TwilioLine] {
    let configured = twilioLineState.values().toArray();
    if (configured.size() == 0) {
      switch (legacyTwilioLine(state)) {
        case null { [] };
        case (?line) { [line] };
      };
    } else {
      configured.sort(compareLines);
    };
  };

  public func listEnabledTwilioNumbers(
    state : State,
    twilioLineState : TwilioLineState,
  ) : [Text] {
    listTwilioLines(state, twilioLineState)
      .values()
      .filter(func(line) { line.enabled })
      .map(func(line) { line.phoneNumber })
      .toArray();
  };

  // Admin config
  public func getAdminConfig(
    state : State,
    twilioLineState : TwilioLineState,
  ) : {
    twilioAccountSid : Text;
    twilioFromNumber : Text;
    twilioPhoneNumbers : [Types.TwilioLine];
    hasXaiKey : Bool;
    hasTwilioAuth : Bool;
  } {
    {
      twilioAccountSid = "";
      twilioFromNumber = state.adminConfig.twilioFromNumber;
      twilioPhoneNumbers = listTwilioLines(state, twilioLineState);
      hasXaiKey = false;
      hasTwilioAuth = false;
    };
  };

  public func setAdminConfig(
    state : State,
    twilioLineState : TwilioLineState,
    xaiApiKey : Text,
    twilioAccountSid : Text,
    twilioAuthToken : Text,
    twilioFromNumber : Text,
  ) {
    if (xaiApiKey != "" or twilioAccountSid != "" or twilioAuthToken != "") {
      Runtime.trap(
        "Service secrets must be configured in src/server/.env, never stored on-chain.",
      );
    };
    if (twilioFromNumber != "") {
      state.adminConfig.twilioFromNumber := twilioFromNumber;
      if (isE164(twilioFromNumber)) {
        twilioLineState.add(twilioFromNumber, {
          phoneNumber = twilioFromNumber;
          name = "Primary line";
          enabled = true;
        });
      };
    };
  };

  public func setTwilioLine(
    state : State,
    twilioLineState : TwilioLineState,
    input : Types.TwilioLineInput,
  ) : Types.TwilioLineMutationResult {
    switch (sanitizeLineInput(input)) {
      case (#err(message)) { #err(message) };
      case (#ok(line)) {
        if (
          twilioLineState.get(line.phoneNumber) == null and
          listTwilioLines(state, twilioLineState).size() >= MAX_TWILIO_LINES
        ) {
          return #err("A maximum of 25 Twilio lines can be configured.");
        };
        twilioLineState.add(line.phoneNumber, line);
        if (state.adminConfig.twilioFromNumber == "") {
          state.adminConfig.twilioFromNumber := line.phoneNumber;
        };
        #ok(listTwilioLines(state, twilioLineState));
      };
    };
  };

  public func removeTwilioLine(
    state : State,
    twilioLineState : TwilioLineState,
    phoneNumber : Text,
  ) : Types.TwilioLineMutationResult {
    if (not isE164(phoneNumber)) {
      return #err("Phone number must be E.164 format, for example +15551234567.");
    };
    switch (twilioLineState.get(phoneNumber)) {
      case null {
        if (state.adminConfig.twilioFromNumber == phoneNumber) {
          state.adminConfig.twilioFromNumber := "";
        };
        #ok(listTwilioLines(state, twilioLineState));
      };
      case (?_) {
        twilioLineState.remove(phoneNumber);
        if (state.adminConfig.twilioFromNumber == phoneNumber) {
          state.adminConfig.twilioFromNumber := "";
        };
        #ok(listTwilioLines(state, twilioLineState));
      };
    };
  };

  public func setTwilioLineEnabled(
    state : State,
    twilioLineState : TwilioLineState,
    phoneNumber : Text,
    enabled : Bool,
  ) : Types.TwilioLineMutationResult {
    if (not isE164(phoneNumber)) {
      return #err("Phone number must be E.164 format, for example +15551234567.");
    };
    switch (twilioLineState.get(phoneNumber)) {
      case null {
        switch (legacyTwilioLine(state)) {
          case (?line) {
            if (line.phoneNumber == phoneNumber) {
              twilioLineState.add(phoneNumber, { line with enabled });
              return #ok(listTwilioLines(state, twilioLineState));
            };
          };
          case null {};
        };
        #err("Twilio line not found");
      };
      case (?line) {
        twilioLineState.add(phoneNumber, { line with enabled });
        #ok(listTwilioLines(state, twilioLineState));
      };
    };
  };

  public func getXaiApiKey(state : State) : Text {
    ignore state;
    "";
  };

  public func getTwilioCredentials(state : State) : {
    accountSid : Text;
    authToken : Text;
    fromNumber : Text;
  } {
    ignore state;
    {
      accountSid = "";
      authToken = "";
      fromNumber = "";
    };
  };

  // Preset CRUD
  public func createPreset(
    state : State,
    voiceIds : VoiceIdState,
    owner : Principal,
    input : Types.CallPresetInput,
  ) : Types.CallPreset {
    if (countCallPresetsForOwner(state, owner) >= MAX_CALL_PRESETS_PER_USER) {
      Runtime.trap("A maximum of 30 call presets can be stored per user.");
    };
    let cleanInput = requireCallPresetInput(input);
    let id = state.nextPresetId.value;
    state.nextPresetId.value += 1;
    let preset : Types.StoredCallPreset = withStoredPresetDefaults({
      id;
      ownerId = owner;
      name = cleanInput.name;
      systemPrompt = cleanInput.systemPrompt;
      voice = cleanInput.voice;
      turnDetection = cleanInput.turnDetection;
      audioFormat = cleanInput.audioFormat;
      sampleRate = cleanInput.sampleRate;
      toolsEnabled = cleanInput.toolsEnabled;
    });
    state.presets.add(id, preset);
    setVoiceId(voiceIds, id, cleanInput.voiceId);
    toPublicPreset(voiceIds, preset);
  };

  public func getPreset(
    state : State,
    voiceIds : VoiceIdState,
    id : Common.PresetId,
  ) : ?Types.CallPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?preset) { ?toPublicPreset(voiceIds, preset) };
    };
  };

  public func listPresetsForUser(
    state : State,
    voiceIds : VoiceIdState,
    userId : Principal,
  ) : [Types.CallPreset] {
    listPresetsForUsers(state, voiceIds, [userId]);
  };

  public func listPresetsForUsers(
    state : State,
    voiceIds : VoiceIdState,
    userIds : [Principal],
  ) : [Types.CallPreset] {
    if (userIds.size() == 0) {
      return [];
    };
    state.presets.values()
      .filter(
        func(p) {
          for (userId in userIds.values()) {
            if (Principal.equal(p.ownerId, userId)) {
              return true;
            };
          };
          false;
        }
      )
      .map(func(p) { toPublicPreset(voiceIds, p) })
      .toArray();
  };

  public func updatePreset(
    state : State,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
    input : Types.CallPresetInput,
  ) : ?Types.CallPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        let cleanInput = requireCallPresetInput(input);
        let updated : Types.StoredCallPreset = withStoredPresetDefaults({
          id = existing.id;
          ownerId = existing.ownerId;
          name = cleanInput.name;
          systemPrompt = cleanInput.systemPrompt;
          voice = cleanInput.voice;
          turnDetection = cleanInput.turnDetection;
          audioFormat = cleanInput.audioFormat;
          sampleRate = cleanInput.sampleRate;
          toolsEnabled = cleanInput.toolsEnabled;
        });
        state.presets.add(id, updated);
        setVoiceId(voiceIds, id, cleanInput.voiceId);
        ?toPublicPreset(voiceIds, updated);
      };
    };
  };

  public func updatePresetInstructions(
    state : State,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
    systemPrompt : Text,
  ) : Types.CallPresetMutationResult {
    switch (state.presets.get(id)) {
      case null { #err("Preset not found.") };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        switch (sanitizeInstructions(systemPrompt, "AI instructions are required.")) {
          case (#err(message)) { #err(message) };
          case (#ok(prompt)) {
            let updated : Types.StoredCallPreset = withStoredPresetDefaults({
              existing with
              systemPrompt = prompt;
            });
            state.presets.add(id, updated);
            #ok(toPublicPreset(voiceIds, updated));
          };
        };
      };
    };
  };

  public func deletePreset(
    state : State,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
  ) : Bool {
    switch (state.presets.get(id)) {
      case null { false };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        state.presets.remove(id);
        voiceIds.remove(id);
        true;
      };
    };
  };

  public func duplicatePreset(
    state : State,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
  ) : ?Types.CallPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?existing) {
        if (countCallPresetsForOwner(state, caller) >= MAX_CALL_PRESETS_PER_USER) {
          Runtime.trap("A maximum of 30 call presets can be stored per user.");
        };
        let newId = state.nextPresetId.value;
        state.nextPresetId.value += 1;
        let copy : Types.StoredCallPreset = withStoredPresetDefaults({
          id = newId;
          ownerId = caller;
          name = existing.name # " (copy)";
          systemPrompt = existing.systemPrompt;
          voice = existing.voice;
          turnDetection = existing.turnDetection;
          audioFormat = existing.audioFormat;
          sampleRate = existing.sampleRate;
          toolsEnabled = existing.toolsEnabled;
        });
        state.presets.add(newId, copy);
        setVoiceId(voiceIds, newId, voiceIds.get(existing.id));
        ?toPublicPreset(voiceIds, copy);
      };
    };
  };

  public func createAnsweringPreset(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    owner : Principal,
    input : Types.AnsweringPresetInput,
  ) : Types.AnsweringPresetMutationResult {
    if (
      countAnsweringPresetsForOwner(state, owner) >=
      MAX_ANSWERING_PRESETS_PER_USER
    ) {
      return #err("A maximum of 10 answering presets can be stored per user.");
    };
    switch (getExistingPendingAnsweringPreset(state, owner)) {
      case (?_) {
        return #err("Finish verifying your pending Twilio number before creating another answering preset.");
      };
      case null {};
    };
    switch (sanitizeAnsweringInput(input)) {
      case (#err(message)) { #err(message) };
      case (#ok(cleanInput)) {
        switch (state.presetIdByPhoneNumber.get(cleanInput.phoneNumber)) {
          case (?_) { return #err("That Twilio phone number is already assigned to an answering preset.") };
          case null {};
        };
        switch (state.presetIdByWebhookSecret.get(cleanInput.webhookSecret)) {
          case (?_) { return #err("Webhook verification secret is already in use.") };
          case null {};
        };

        let id = state.nextAnsweringPresetId.value;
        state.nextAnsweringPresetId.value += 1;
        let now = Time.now();
        let preset : Types.StoredAnsweringPreset = {
          id;
          ownerId = owner;
          name = cleanInput.name;
          phoneNumber = cleanInput.phoneNumber;
          systemPrompt = cleanInput.systemPrompt;
          voice = cleanInput.voice;
          turnDetection = cleanInput.turnDetection;
          audioFormat = #pcmu;
          sampleRate = #hz8000;
          toolsEnabled = cleanInput.toolsEnabled;
          captureOptions = cleanInput.captureOptions;
          enabled = cleanInput.enabled;
          verificationStatus = #pendingVerification;
          webhookSecret = cleanInput.webhookSecret;
          createdAt = now;
          updatedAt = now;
          verifiedAt = null;
          lastIncomingAt = null;
        };

        state.presets.add(id, preset);
        setVoiceId(voiceIds, id, cleanInput.voiceId);
        state.presetIdByWebhookSecret.add(preset.webhookSecret, id);
        state.presetIdByPhoneNumber.add(preset.phoneNumber, id);
        switch (state.presetIdsByOwner.get(owner)) {
          case null {
            let ids = List.empty<Common.PresetId>();
            ids.add(id);
            state.presetIdsByOwner.add(owner, ids);
          };
          case (?ids) { ids.add(id) };
        };
        #ok(toPublicAnsweringPreset(voiceIds, preset));
      };
    };
  };

  public func listAnsweringPresetsForUser(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    owner : Principal,
  ) : [Types.AnsweringPreset] {
    let presets = List.empty<Types.AnsweringPreset>();
    switch (state.presetIdsByOwner.get(owner)) {
      case null {};
      case (?ids) {
        ids.forEach(func(id) {
          switch (state.presets.get(id)) {
            case null {};
            case (?preset) { presets.add(toPublicAnsweringPreset(voiceIds, preset)) };
          };
        });
      };
    };
    presets.toArray().sort(compareAnsweringNewestFirst);
  };

  public func getAnsweringPreset(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    id : Common.PresetId,
  ) : ?Types.AnsweringPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?preset) { ?toPublicAnsweringPreset(voiceIds, preset) };
    };
  };

  public func getAnsweringPresetForServer(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    webhookSecret : Text,
    phoneNumber : Text,
  ) : ?Types.AnsweringPreset {
    switch (state.presetIdByWebhookSecret.get(webhookSecret)) {
      case null { null };
      case (?id) {
        switch (state.presets.get(id)) {
          case null { null };
          case (?preset) {
            if (preset.phoneNumber == phoneNumber) {
              ?toPublicAnsweringPreset(voiceIds, preset)
            } else {
              null
            };
          };
        };
      };
    };
  };

  public func getAnsweringPresetForIncoming(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    webhookSecret : Text,
    phoneNumber : Text,
  ) : { #ok : Types.AnsweringPreset; #err : Text } {
    switch (getAnsweringPresetForServer(state, voiceIds, webhookSecret, phoneNumber)) {
      case null { #err("Answering preset was not found for this Twilio number.") };
      case (?preset) {
        if (preset.verificationStatus != #verified) {
          return #err("Answering preset phone number is not verified yet.");
        };
        if (not preset.enabled) {
          return #err("Answering service is turned off for this preset.");
        };
        #ok(preset);
      };
    };
  };

  public func updateAnsweringPreset(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
    input : Types.AnsweringPresetInput,
  ) : Types.AnsweringPresetMutationResult {
    switch (state.presets.get(id)) {
      case null { #err("Answering preset not found.") };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        switch (sanitizeAnsweringInput(input)) {
          case (#err(message)) { #err(message) };
          case (#ok(cleanInput)) {
            if (cleanInput.phoneNumber != existing.phoneNumber) {
              switch (state.presetIdByPhoneNumber.get(cleanInput.phoneNumber)) {
                case (?otherId) {
                  if (otherId != id) {
                    return #err("That Twilio phone number is already assigned to an answering preset.");
                  };
                };
                case null {};
              };
            };
            if (cleanInput.webhookSecret != existing.webhookSecret) {
              switch (state.presetIdByWebhookSecret.get(cleanInput.webhookSecret)) {
                case (?otherId) {
                  if (otherId != id) {
                    return #err("Webhook verification secret is already in use.");
                  };
                };
                case null {};
              };
            };

            let phoneChanged = cleanInput.phoneNumber != existing.phoneNumber;
            if (phoneChanged) {
              state.presetIdByPhoneNumber.remove(existing.phoneNumber);
              state.presetIdByPhoneNumber.add(cleanInput.phoneNumber, id);
            };
            if (cleanInput.webhookSecret != existing.webhookSecret) {
              state.presetIdByWebhookSecret.remove(existing.webhookSecret);
              state.presetIdByWebhookSecret.add(cleanInput.webhookSecret, id);
            };

            let updated : Types.StoredAnsweringPreset = {
              id = existing.id;
              ownerId = existing.ownerId;
              name = cleanInput.name;
              phoneNumber = cleanInput.phoneNumber;
              systemPrompt = cleanInput.systemPrompt;
              voice = cleanInput.voice;
              turnDetection = cleanInput.turnDetection;
              audioFormat = #pcmu;
              sampleRate = #hz8000;
              toolsEnabled = cleanInput.toolsEnabled;
              captureOptions = cleanInput.captureOptions;
              enabled = if (phoneChanged) { false } else { cleanInput.enabled };
              verificationStatus = if (phoneChanged) { #pendingVerification } else { existing.verificationStatus };
              webhookSecret = cleanInput.webhookSecret;
              createdAt = existing.createdAt;
              updatedAt = Time.now();
              verifiedAt = if (phoneChanged) { null } else { existing.verifiedAt };
              lastIncomingAt = existing.lastIncomingAt;
            };
            state.presets.add(id, updated);
            setVoiceId(voiceIds, id, cleanInput.voiceId);
            #ok(toPublicAnsweringPreset(voiceIds, updated));
          };
        };
      };
    };
  };

  public func updateAnsweringPresetInstructions(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
    systemPrompt : Text,
  ) : Types.AnsweringPresetMutationResult {
    switch (state.presets.get(id)) {
      case null { #err("Answering preset not found.") };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        switch (sanitizeInstructions(systemPrompt, "AI answering instructions are required.")) {
          case (#err(message)) { #err(message) };
          case (#ok(prompt)) {
            let updated : Types.StoredAnsweringPreset = {
              existing with
              systemPrompt = prompt;
              updatedAt = Time.now();
            };
            state.presets.add(id, updated);
            #ok(toPublicAnsweringPreset(voiceIds, updated));
          };
        };
      };
    };
  };

  public func deleteAnsweringPreset(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
  ) : Bool {
    switch (state.presets.get(id)) {
      case null { false };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        state.presets.remove(id);
        voiceIds.remove(id);
        state.presetIdByWebhookSecret.remove(existing.webhookSecret);
        state.presetIdByPhoneNumber.remove(existing.phoneNumber);
        switch (state.presetIdsByOwner.get(existing.ownerId)) {
          case null {};
          case (?ids) {
            ids.retain(func(presetId) { presetId != id });
          };
        };
        true;
      };
    };
  };

  public func setAnsweringPresetEnabled(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    caller : Principal,
    id : Common.PresetId,
    enabled : Bool,
  ) : Types.AnsweringPresetMutationResult {
    switch (state.presets.get(id)) {
      case null { #err("Answering preset not found.") };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        if (enabled and existing.verificationStatus != #verified) {
          return #err("Verify this Twilio number before turning on the answering service.");
        };
        let updated : Types.StoredAnsweringPreset = {
          existing with
          enabled = enabled;
          updatedAt = Time.now();
        };
        state.presets.add(id, updated);
        #ok(toPublicAnsweringPreset(voiceIds, updated));
      };
    };
  };

  public func verifyAnsweringPresetForServer(
    state : AnsweringState,
    voiceIds : VoiceIdState,
    webhookSecret : Text,
    phoneNumber : Text,
  ) : Types.AnsweringPresetMutationResult {
    if (not isE164(phoneNumber)) {
      return #err("Twilio phone number must be E.164 format.");
    };
    switch (state.presetIdByWebhookSecret.get(webhookSecret)) {
      case null { #err("Answering preset was not found for this Twilio number.") };
      case (?id) {
        switch (state.presets.get(id)) {
          case null { #err("Answering preset was not found for this Twilio number.") };
          case (?existing) {
            if (existing.phoneNumber != phoneNumber) {
              return #err("Answering preset was not found for this Twilio number.");
            };
            let now = Time.now();
            let updated : Types.StoredAnsweringPreset = {
              existing with
              verificationStatus = #verified;
              verifiedAt = ?now;
              updatedAt = now;
            };
            state.presets.add(existing.id, updated);
            #ok(toPublicAnsweringPreset(voiceIds, updated));
          };
        };
      };
    };
  };

  public func markAnsweringPresetIncoming(
    state : AnsweringState,
    id : Common.PresetId,
  ) {
    switch (state.presets.get(id)) {
      case null {};
      case (?existing) {
        state.presets.add(id, { existing with lastIncomingAt = ?Time.now() });
      };
    };
  };
};
