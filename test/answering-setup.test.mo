import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Config "../src/backend/lib/config";
import ConfigTypes "../src/backend/types/config";

let owner = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let linkedOwner = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let unrelated = Principal.fromText("2vxsx-fae");
let state = Config.initAnsweringState();
let voices = Config.initVoiceIdState();
let simple : ConfigTypes.AnsweringPresetSimpleInput = {
  name = "After-hours messages";
  phoneNumber = "+12025550100";
  systemPrompt = "Greet callers, collect their name and callback details, and say our team will follow up.";
  voice = null;
  captureOptions = { saveTranscript = true; recordAudio = false; consentConfirmed = false };
  webhookSecret = "answering-setup-test-0123456789abcdef";
};
let input = Config.simpleAnsweringInput(simple);
let draft = switch (Config.createAnsweringPreset(state, voices, owner, input)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};

// A first-time verification callback cannot turn the simple draft into a paid
// answering line. Capture follows the customer's chosen flags.
assert not draft.enabled;
assert draft.voice == #eve;
assert draft.audioFormat == #pcmu and draft.sampleRate == #hz8000;
assert draft.turnDetection.serverVad;
assert not draft.toolsEnabled.webSearch and not draft.toolsEnabled.xSearch and not draft.toolsEnabled.functionCalling;
assert draft.captureOptions.saveTranscript and not draft.captureOptions.recordAudio;
assert draft.captureOptions.consentConfirmed;
let initial = Config.answeringSetupStatus(draft, 0, false);
assert not initial.readyForCalls;
assert initial.webhookUrl == "https://voicecall.richardhery.com/answering/incoming/" # simple.webhookSecret;
assert initial.webhookMethod == "POST";
assert initial.nextSteps.size() == 6;
assert initial.note.contains(#text("not a live check"));
assert not Config.answeringSetupStatus(draft, 300, true).readyForCalls;
switch (Config.setAnsweringPresetEnabled(state, voices, owner, draft.id, true)) {
  case (#err(_)) {};
  case (#ok(_)) { assert false };
};
// Editing settings must not provide a second path to pre-arm a pending line:
// otherwise its verification callback would immediately start paid answering.
switch (Config.updateAnsweringPreset(state, voices, owner, draft.id, { input with enabled = true })) {
  case (#err(_)) {};
  case (#ok(_)) { assert false };
};
assert Config.getAnsweringPreset(state, voices, draft.id) == ?draft;
let verified = switch (Config.verifyAnsweringPresetForServer(state, voices, simple.webhookSecret, simple.phoneNumber)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
assert not verified.enabled;
assert not Config.answeringSetupStatus(verified, 300, true).readyForCalls;
let enabled = switch (Config.setAnsweringPresetEnabled(state, voices, owner, draft.id, true)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
let ready = Config.answeringSetupStatus(enabled, 300, true);
assert ready.readyForCalls and ready.nextSteps.size() == 1;
assert not Config.answeringSetupStatus(enabled, 0, true).readyForCalls;
assert not Config.answeringSetupStatus(enabled, 300, false).readyForCalls;

// Guided setup still uses all existing route and input validation.
switch (Config.createAnsweringPreset(state, voices, linkedOwner, { input with webhookSecret = "different-test-secret-0123456789abcdef" })) {
  case (#err(_)) {};
  case (#ok(_)) { assert false };
};
switch (Config.createAnsweringPreset(state, voices, linkedOwner, { input with phoneNumber = "202-555-0101" })) {
  case (#err(_)) {};
  case (#ok(_)) { assert false };
};
let second = switch (Config.createAnsweringPreset(state, voices, linkedOwner, {
  input with
  phoneNumber = "+12025550101";
  webhookSecret = "second-setup-test-secret-0123456789abcdef";
})) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
assert Config.listAnsweringPresetsForUsers(state, voices, [owner, linkedOwner]).size() == 2;
assert Config.listAnsweringPresetsForUsers(state, voices, [unrelated]).size() == 0;

// Re-pointing an existing line invalidates its prior verification and readiness.
let rerouted = switch (Config.updateAnsweringPreset(state, voices, owner, enabled.id, { input with phoneNumber = "+12025550102"; enabled = true })) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
assert rerouted.verificationStatus == #pendingVerification;
assert not Config.answeringSetupStatus(rerouted, 300, true).readyForCalls;
assert second.id != rerouted.id;
