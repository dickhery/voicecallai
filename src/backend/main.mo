import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import ConfigLib "lib/config";
import CallsLib "lib/calls";
import BillingLib "lib/billing";
import AgentLib "lib/agent";
import IdentityLib "lib/identity";
import ConfigApi "mixins/config-api";
import CallsApi "mixins/calls-api";
import BillingApi "mixins/billing-api";
import AgentApi "mixins/agent-api";
import IdentityApi "mixins/identity-api";
import Principal "mo:core/Principal";

shared ({ caller = installer }) persistent actor class Backend() = this {
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
  // New stable collection for remote hang-up requests (empty on first upgrade).
  let callEndState = CallsLib.initCallEndState();
  let billingState = BillingLib.initState();
  let agentState = AgentLib.initState();
  // Retained for memory-compatible upgrade onto post-cbb93ff canisters.
  // Behavior matches cbb93ff; consent APIs are not exposed.
  let agentConsentState = AgentLib.initConsentState();
  // Links web-app and MCP session principals that belong to the same human.
  let identityState = IdentityLib.initState();

  // Domain mixins
  include IdentityApi(accessControlState, identityState, billingState);
  include ConfigApi(accessControlState, identityState, configState, callPresetVoiceIds, twilioLineState, answeringState, answeringPresetVoiceIds);
  include CallsApi(accessControlState, identityState, callsState, answeringLiveState, callEndState, configState, callPresetVoiceIds, billingState);
  include BillingApi(accessControlState, identityState, billingState, callsState, configState, callPresetVoiceIds, answeringState, answeringPresetVoiceIds);
  include AgentApi(
    Principal.fromActor(this),
    accessControlState,
    identityState,
    agentState,
    billingState,
    callsState,
    callEndState,
    configState,
    callPresetVoiceIds,
  );

  // Keep the binding live so the Motoko compiler does not drop it.
  ignore agentConsentState;
};
