import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import ConfigLib "lib/config";
import CallsLib "lib/calls";
import BillingLib "lib/billing";
import ConfigApi "mixins/config-api";
import CallsApi "mixins/calls-api";
import BillingApi "mixins/billing-api";

shared ({ caller = installer }) persistent actor class Backend() {
  // Capture the installer atomically so a public login cannot front-run admin setup.
  let accessControlState = AccessControl.initState();
  if (not accessControlState.adminAssigned) {
    AccessControl.initialize(accessControlState, installer);
  };
  include MixinAuthorization(accessControlState);

  // Domain state
  let configState = ConfigLib.initState();
  ConfigLib.clearLegacyServiceSecrets(configState);
  let callPresetVoiceIds = ConfigLib.initVoiceIdState();
  let twilioLineState = ConfigLib.initTwilioLineState();
  let answeringState = ConfigLib.initAnsweringState();
  let answeringPresetVoiceIds = ConfigLib.initVoiceIdState();
  let callsState = CallsLib.initState();
  let answeringLiveState = CallsLib.initAnsweringLiveState();
  let billingState = BillingLib.initState();

  // Domain mixins
  include ConfigApi(accessControlState, configState, callPresetVoiceIds, twilioLineState, answeringState, answeringPresetVoiceIds);
  include CallsApi(accessControlState, callsState, answeringLiveState, configState, callPresetVoiceIds);
  include BillingApi(accessControlState, billingState, callsState, configState, callPresetVoiceIds, answeringState, answeringPresetVoiceIds);
};
