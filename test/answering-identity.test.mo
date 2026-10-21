import Principal "mo:core/Principal";
import Identity "../src/backend/lib/identity";
import Billing "../src/backend/lib/billing";
import Config "../src/backend/lib/config";
import Calls "../src/backend/lib/calls";
import ConfigTypes "../src/backend/types/config";

let primary = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let presetCreator = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let identities = Identity.initState();
let billing = Billing.initState();
let answering = Config.initAnsweringState();
let voices = Config.initVoiceIdState();
let calls = Calls.initState();
let input : ConfigTypes.AnsweringPresetInput = {
  name = "Linked answering preset";
  phoneNumber = "+12025550100";
  systemPrompt = "Answer callers and help with their questions.";
  voice = #eve;
  voiceId = null;
  turnDetection = { serverVad = true; threshold = 0.5; silenceDurationMs = 500; prefixPaddingMs = 200 };
  audioFormat = #pcmu;
  sampleRate = #hz8000;
  toolsEnabled = { webSearch = false; xSearch = false; functionCalling = false };
  captureOptions = { saveTranscript = false; recordAudio = false; consentConfirmed = false };
  enabled = true;
  webhookSecret = "test-answering-secret-0123456789abcdef";
};
let preset = switch (Config.createAnsweringPreset(answering, voices, presetCreator, input)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
switch (Config.verifyAnsweringPresetForServer(answering, voices, input.webhookSecret, input.phoneNumber)) {
  case (#err(_)) { assert false };
  case (#ok(_)) {};
};
ignore Billing.creditPhoneSeconds(billing, presetCreator, 300);

// Linking moves prepaid funds, while existing presets retain their original
// creator. Incoming calls and outbound calls must use the same resolved payer.
let offer = switch (Identity.createLinkOffer(identities, primary)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
switch (Identity.claimLinkOffer(identities, presetCreator, offer.code)) {
  case (#err(_)) { assert false };
  case (#ok(link)) {
    assert Billing.moveAvailableBalance(billing, link.secondary, link.primary) == 300;
  };
};
let incomingPreset = switch (Config.getAnsweringPresetForIncoming(answering, voices, input.webhookSecret, input.phoneNumber)) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
assert incomingPreset.ownerId == presetCreator;
assert Billing.getAvailableSeconds(billing, incomingPreset.ownerId) == 0;
let payer = Identity.resolve(identities, incomingPreset.ownerId);
assert payer == primary;
assert Identity.sameAccount(identities, presetCreator, payer);
let call = Calls.createCallRecord(calls, payer, "+12025550101", preset.id + 1_000_000_000);
let reservation = switch (Billing.createReservation(billing, payer, call.recipientPhone, call.presetId, call.id, "test-call-token")) {
  case (#err(_)) { assert false; loop {} };
  case (#ok(value)) { value };
};
assert reservation.user == primary and call.userId == primary;
assert reservation.allowedSeconds > 0;
assert Billing.getAvailableSeconds(billing, presetCreator) == 0;
assert Billing.getAvailableSeconds(billing, primary) + reservation.allowedSeconds == 300;
ignore Billing.cancelReservation(billing, reservation.id, "admission changed after reservation");
assert Billing.getAvailableSeconds(billing, primary) == 300;

// A previously valid snapshot cannot authorize an incoming call after an
// intervening disable or route change. Re-fetching must reject the old route.
ignore Config.setAnsweringPresetEnabled(answering, voices, presetCreator, preset.id, false);
switch (Config.getAnsweringPresetForIncoming(answering, voices, input.webhookSecret, input.phoneNumber)) {
  case (#err(_)) {};
  case (#ok(_)) { assert false };
};
ignore Config.setAnsweringPresetEnabled(answering, voices, presetCreator, preset.id, true);
ignore Config.updateAnsweringPreset(answering, voices, presetCreator, preset.id, { input with phoneNumber = "+12025550102" });
switch (Config.getAnsweringPresetForIncoming(answering, voices, input.webhookSecret, input.phoneNumber)) {
  case (#err(_)) {};
  case (#ok(_)) { assert false };
};
assert Billing.getAvailableSeconds(billing, primary) == 300;
