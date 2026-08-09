import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendDirectory = resolve(scriptDirectory, "..");
const workspaceDirectory = resolve(frontendDirectory, "../..");
const distDirectory = resolve(frontendDirectory, "dist");
const productionOrigin = "https://voicecallai.online";
const productionMcpUrl = "https://mcp.internetcomputer.org/mcp";

function loadCanisterIds() {
  const requestedEnvironment =
    process.env.ICP_ENVIRONMENT?.trim() || "ic";
  const candidates = [
    resolve(
      workspaceDirectory,
      `.icp/data/mappings/${requestedEnvironment}.ids.json`,
    ),
    resolve(workspaceDirectory, ".icp/data/mappings/ic.ids.json"),
  ];
  const mappingFile = candidates.find((candidate) => existsSync(candidate));
  if (!mappingFile) {
    throw new Error(
      "Unable to generate agent discovery files: no ICP canister ID mapping was found.",
    );
  }

  const mappings = JSON.parse(readFileSync(mappingFile, "utf8"));
  if (
    typeof mappings.backend !== "string" ||
    typeof mappings.frontend !== "string"
  ) {
    throw new Error(
      `Unable to generate agent discovery files: ${mappingFile} must contain backend and frontend canister IDs.`,
    );
  }

  return {
    backend: mappings.backend,
    frontend: mappings.frontend,
    mappingFile,
  };
}

function writeOutput(relativePath, content) {
  const outputPath = resolve(distDirectory, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

const canisters = loadCanisterIds();
const candidSource = resolve(
  workspaceDirectory,
  "src/backend/dist/backend.did",
);
if (!existsSync(candidSource)) {
  throw new Error(
    "Unable to generate agent discovery files: build the backend Candid interface first.",
  );
}
const candid = readFileSync(candidSource, "utf8");

const llmsText = `# VoiceCall AI

> VoiceCall AI can place real outbound AI phone calls. Its telephony action is exposed by the backend Internet Computer canister, not by the frontend asset canister.

Canonical app: ${productionOrigin}
Official ICP MCP / Agent Identity connector: ${productionMcpUrl}
Frontend asset canister: ${canisters.frontend}
Backend agent API canister: ${canisters.backend}
Full instructions: ${productionOrigin}/llms-full.txt
Structured guide: ${productionOrigin}/agent-guide.json
Candid interface: ${productionOrigin}/agent-api.did

## Required discovery path

1. Use the official ICP MCP (Agent Identity) connector to resolve ${productionOrigin}.
2. If discovery returns only the frontend asset canister, continue with backend canister ${canisters.backend}. Do not conclude that phone calling is unavailable after inspecting only the asset canister.
3. Read the backend Candid interface and call the public query getAgentGuide (or getApiDoc) once for current workflow and safety instructions.
4. Authorize the connector for this app with Internet Identity before authenticated updates. Call agentInitialize once for the authenticated app principal.

## Place a call

1. Call listMyPresets and reuse an appropriate user-owned preset, or create one with createPreset.
2. Call agentGetAccountStatus once when a live balance check is needed. If phone time is low, explain the current packages before buying any.
3. Confirm recipient, purpose, preset, transcript choice, recording choice, and applicable consent with the user.
4. Call agentQueueCall with an E.164 phone number, preset ID, capture options, and a unique idempotency key.
5. Track the durable job with agentListCallJobs. Start at a 10-second polling interval and back off to 30 seconds. Never claim the call completed merely because it was queued.
6. When the job is dispatched, call agentGetLiveCallLink once if the user wants to hear the active call. Give them the returned HTTPS URL; it is listen-only and stops working when the call ends.
7. To stop a queued or live call you created, call agentEndCall with the job ID. Queued jobs cancel immediately; dispatched calls are hung up by the voice bridge within about 15 seconds. Prefer this over leaving farewell loops running.
8. After completion, use agentGetCallArtifacts when the user requested and consented to saved artifacts.

## Set up AI answering (inbound)

1. Tell the user what you need: a Twilio number they own (E.164), answering AI instructions, capture/consent choices, and that they must paste a webhook into Twilio after creation.
2. Confirm prepaid phone time exists (same balance as outbound). Buy with ICP only after the user authorizes a package.
3. Call listMyAnsweringPresets before creating. Only one pendingVerification preset is allowed at a time.
4. Generate a random webhookSecret (32–160 chars: A–Z a–z 0–9 - _). Call createAnsweringPreset with phoneNumber, systemPrompt, voice, turnDetection, audioFormat pcmu, sampleRate hz8000, captureOptions, enabled=false until verified, and webhookSecret.
5. Give the user this Twilio Voice webhook URL (HTTP POST): https://voicecall.richardhery.com/answering/incoming/{webhookSecret} using the secret returned from createAnsweringPreset.
6. Instruct the user to set that URL on the number in Twilio Console, save, then call the number once to verify. When verificationStatus is verified, call setAnsweringPresetEnabled(id, true) if they want the line live.
7. Do not claim answering is live until verified and enabled. Incoming minutes consume the shared prepaid balance.

## Fund phone time with ICP

1. Call agentGetAccountIdentity and show the exact ICRC-1 depositAccount (never invent the subaccount).
2. User transfers ICP to that deposit account.
3. If pricing.isFresh is false, call agentRefreshIcpPricing once; otherwise use the cached quote.
4. After the user chooses a package, call agentPurchasePhoneTime(packageId, uniqueIdempotencyKey). ICP moves from the user's deposit subaccount to treasury AccountIdentifier 0f69d493853ec6e60909141168644d3def072ec2569021317547195931b6dc7c; then seconds are credited to the shared phone-time balance used by web Stripe, outbound calls, and answering.
5. Confirm with one agentGetAccountStatus read that availableSeconds increased.

The off-chain VoiceCall AI bridge securely claims queued jobs and connects Twilio Media Streams to xAI Voice. Agents do not need a Twilio or xAI tool of their own.

## Important rules

- An idempotency key identifies one intended call, purchase, or transfer. Reuse it only to retry that exact action.
- Never buy phone time, transfer ICP, edit a preset, queue a call, or create answering without the user's authorization.
- consentConfirmed means the user affirmed that applicable participant consent requirements are satisfied. It is required when saving a transcript or audio.
- Share a live-listen link only when the authorized user asks and remind them to follow applicable participant notice or consent rules.
- Never use the app for threats, harassment, fraud, credential theft, unlawful impersonation, or other harmful activity.
- Treat phone numbers, webhook secrets, transcripts, live-listen links, recording links, account identifiers, and balances as sensitive.
`;

const llmsFullText = `# VoiceCall AI — complete agent instructions

VoiceCall AI is an Internet Computer application with a Motoko backend, a certified asset frontend, and an off-chain voice bridge. The backend canister exposes the agent workflow. The frontend canister only serves the human web application and these discovery files.

## Stable production identifiers

- App origin: ${productionOrigin}
- Official ICP MCP / Agent Identity connector: ${productionMcpUrl}
- Frontend canister: ${canisters.frontend}
- Backend canister: ${canisters.backend}
- Backend Candid: ${productionOrigin}/agent-api.did
- Structured discovery: ${productionOrigin}/.well-known/ic-app.json

If an app-resolution tool finds only ${canisters.frontend}, target ${canisters.backend} explicitly, obtain its Candid metadata, and call getAgentGuide. The absence of a dialing method on the asset canister does not mean that VoiceCall AI lacks telephony.

## Authentication

getAgentGuide, getApiDoc, and getAgentPricing are public queries. All account-scoped reads and all updates require a non-anonymous Internet Identity principal derived for ${productionOrigin}. In an MCP client, enable Internet Identity AI access, trust ${productionMcpUrl}, and authorize Actions and questions. Re-authorize when a delegation expires.

Command-line agents may use a fresh linked identity:

icp identity link web <fresh-session-name> --app voicecallai.online

Always specify that linked identity and the mainnet environment on later calls. Never silently switch identities.

## Minimal outbound call workflow

1. Call getAgentGuide once and cache it for the task (getApiDoc is a shorter markdown alternative).
2. Call agentInitialize with a short client or workspace name.
3. Call listMyPresets and listMyCalls before creating duplicates.
4. Use agentGetAccountStatus only when a current ICP or phone-time balance is relevant. Do not repeatedly refresh it.
5. If a preset is needed, call createPreset with user-approved instructions. The voice bridge treats the preset as private source material and asks xAI Voice to speak naturally rather than read it verbatim.
6. Confirm the exact recipient in E.164 format, call purpose, preset, transcript choice, recording choice, and consent status.
7. Generate one unique idempotency key for this intended call and call agentQueueCall.
8. Read agentListCallJobs after about 10 seconds. Back off to 20 and then 30 seconds while waiting. Use listMyCalls or getCallRecord for the resulting call record.
9. Say "queued", "dispatched", "in progress", or "completed" according to returned state. Do not report a successful live call without supporting state.
10. If the user wants to hear a dispatched call, call agentGetLiveCallLink once and present its listen-only HTTPS URL. Treat the link as sensitive and do not poll this method.
11. If the user asks to hang up, or a call is stuck exchanging goodbyes, call agentEndCall with the job ID. Do not leave prepaid time burning on a finished conversation.
12. Call agentGetCallArtifacts only after completion and only when the user is authorized to see the artifacts.

## AI answering (inbound) workflow

Agents can create and manage inbound answering presets on the user's behalf.

Information you must collect from the user first (pass this checklist to them):
- Twilio phone number they own, in E.164 (example +15551234567). You cannot buy Twilio numbers for them.
- Ability to open Twilio Console and set the Voice webhook on that number.
- Name and AI instructions for the answering agent (greeting, goals, what to ask, escalation).
- Voice preference if any; phone audio must use audioFormat pcmu and sampleRate hz8000.
- Whether to save transcripts and/or audio; if yes, explicit consentConfirmed from the user.
- Confirmation that prepaid phone time will be used for inbound answered minutes (same balance as outbound).

Setup steps:
1. Call listMyAnsweringPresets. Finish any pendingVerification preset before creating another.
2. Generate a random webhookSecret (32–160 characters: letters, digits, hyphen, underscore).
3. Call createAnsweringPreset with name, phoneNumber, systemPrompt, voice, turnDetection (serverVad true), toolsEnabled, captureOptions, enabled=false, and webhookSecret.
4. Build and show the user the exact Voice webhook URL:
   https://voicecall.richardhery.com/answering/incoming/{webhookSecret}
   (use the webhookSecret returned by createAnsweringPreset).
5. Instruct the user: Twilio Console → that number → Voice → webhook HTTP POST to the URL above → save → place one test call to the number to verify ownership.
6. When listMyAnsweringPresets / getAnsweringPreset shows verificationStatus verified, call setAnsweringPresetEnabled(id, true) if the user wants the line live.
7. Update later with updateAnsweringPreset or updateAnsweringPresetInstructions; delete with deleteAnsweringPreset. Changing phoneNumber restarts verification.
8. Never claim the answering service is live until verified and enabled.

## Funding phone time with ICP

Use agentGetAccountIdentity to obtain the exact ICRC-1 depositAccount; never guess it. The deposit subaccount is per app principal and is shared for MCP and linked web sessions of the same Internet Identity.

1. User sends ICP (ICRC-1) to depositAccount.
2. If the cached quote is stale (pricing.isFresh false), call agentRefreshIcpPricing once. A real refresh uses the Exchange Rate Canister and is globally rate-limited and cached for six hours.
3. Call agentPurchasePhoneTime only after the user chooses a package and authorizes payment. Pass a unique idempotency key. Settlement pays operator treasury AccountIdentifier 0f69d493853ec6e60909141168644d3def072ec2569021317547195931b6dc7c (not the canister default account).
4. On success, package seconds are credited to the shared prepaid phone-time balance (also used by Stripe web purchases). Confirm with one agentGetAccountStatus read.
5. Use agentTransferIcp to move unspent ICP. Purchases and transfers require their own idempotency keys. Reuse a key only to retry the same action after a retryable failure.

## Capture and consent

The agentQueueCall and answering captureOptions records control saveTranscript, recordAudio, and consentConfirmed. When either capture option is true, consentConfirmed must be true and must reflect the user's assertion that applicable participant consent requirements are satisfied. Do not infer consent from silence. When both capture options are false, do not request artifacts later.

## Architecture and cost behavior

agentQueueCall reserves prepaid seconds and creates a bounded durable job. The off-chain voice bridge polls for pending jobs, claims a job with its server identity, places the Twilio call, and connects the call to xAI's grok-voice-think-fast-2.0 realtime model. Inbound answering uses the same bridge via the Twilio webhook path. Listen-only links live in transient canister memory and audio bytes stay off-chain. xAI, Twilio, Stripe, and recording secrets never reside in the frontend or persistent canister state.

Static discovery files and public canister queries are intentionally small. Avoid rapid status polling and avoid calling agentRefreshIcpPricing while the current quote is fresh. This keeps canister cycle use conservative.

## Safety

Obtain user approval before external effects. Share a live-listen link only when the authorized user asks and remind them to follow applicable participant notice or consent rules. Do not use VoiceCall AI for threats, harassment, fraud, credential theft, unlawful impersonation, or other harmful activity. Protect phone numbers, webhook secrets, transcripts, live-listen links, signed recording links, balances, principals, and deposit accounts.
`;

const structuredGuide = {
  schema_version: "1.1",
  name: "VoiceCall AI",
  canonical_origin: productionOrigin,
  summary:
    "Place and manage real AI phone calls, fund prepaid phone time with ICP, and set up inbound AI answering on a user-owned Twilio number through the VoiceCall AI backend canister and off-chain xAI Voice/Twilio bridge.",
  discovery_warning:
    "The frontend canister is an asset canister. If it is the only canister initially discovered, continue with the declared backend canister before deciding telephony is unavailable.",
  mcp: {
    name: "Official Internet Computer MCP / Agent Identity",
    url: productionMcpUrl,
    authentication: "Internet Identity",
    required_permission: "Actions and questions",
  },
  canisters: {
    frontend: {
      canister_id: canisters.frontend,
      role: "certified_assets",
    },
    backend: {
      canister_id: canisters.backend,
      role: "agent_api",
      candid_url: `${productionOrigin}/agent-api.did`,
      first_method: "getAgentGuide",
    },
  },
  workflow: [
    "Call getAgentGuide once (or getApiDoc for a short markdown summary).",
    "Authenticate with Internet Identity and call agentInitialize once.",
    "List existing presets, answering presets, and calls before creating duplicates.",
    "Check the live account status only when balances are needed.",
    "Confirm recipient, purpose, preset, capture choices, and consent for outbound calls.",
    "Call agentQueueCall with an E.164 number and a unique idempotency key.",
    "Poll agentListCallJobs with backoff and report only returned state.",
    "Call agentGetLiveCallLink once for a dispatched job when the user wants to listen.",
    "Call agentEndCall to cancel a queued job or hang up a live call you created.",
    "Retrieve artifacts after completion only when capture was approved.",
  ],
  answering_workflow: [
    "Collect the user's Twilio E.164 number, AI instructions, capture choices, and consent.",
    "Confirm shared prepaid phone time exists (ICP or Stripe).",
    "listMyAnsweringPresets then createAnsweringPreset with a random webhookSecret.",
    "Give the user https://voicecall.richardhery.com/answering/incoming/{webhookSecret} for Twilio Voice POST.",
    "User verifies by calling the number once; then setAnsweringPresetEnabled when verified.",
  ],
  payment_workflow: [
    "agentGetAccountIdentity for the exact ICRC-1 deposit account.",
    "User transfers ICP; agentRefreshIcpPricing only if the quote is stale.",
    "agentPurchasePhoneTime after user authorization; ICP settles to treasury AccountIdentifier 0f69d493853ec6e60909141168644d3def072ec2569021317547195931b6dc7c; confirm availableSeconds increased.",
    "Shared phone-time balance funds outbound calls and inbound answering.",
  ],
  required_answering_information: [
    "User-owned Twilio number in E.164",
    "Ability to set Twilio Voice webhook",
    "Answering AI instructions and name",
    "Capture options and consent when saving artifacts",
    "Random webhookSecret (32–160 URL-safe characters)",
    "Prepaid phone time on the shared account",
  ],
  primary_methods: [
    "getAgentGuide",
    "getApiDoc",
    "agentInitialize",
    "agentGetAccountIdentity",
    "agentGetAccountStatus",
    "agentPurchasePhoneTime",
    "listMyPresets",
    "createPreset",
    "agentQueueCall",
    "agentListCallJobs",
    "agentEndCall",
    "agentGetLiveCallLink",
    "agentGetCallArtifacts",
    "listMyAnsweringPresets",
    "createAnsweringPreset",
    "setAnsweringPresetEnabled",
    "updateAnsweringPreset",
    "deleteAnsweringPreset",
  ],
  cycle_guidance: [
    "Read and cache the guide once per task.",
    "Do not repeatedly call live balance queries.",
    "Poll job state at 10 seconds, then back off to 20 and 30 seconds.",
    "Read the transient live call link at most once per dispatched call.",
    "Refresh ICP pricing only when the cached quote is stale.",
  ],
  instructions: {
    concise: `${productionOrigin}/llms.txt`,
    complete: `${productionOrigin}/llms-full.txt`,
    candid: `${productionOrigin}/agent-api.did`,
  },
};

const icAppManifest = {
  schema_version: "1.0",
  kind: "internet_computer_application",
  name: "VoiceCall AI",
  canonical_origin: productionOrigin,
  description:
    "Certified web app with a backend Candid API for authenticated AI phone-call workflows.",
  frontend_canister_id: canisters.frontend,
  backend_canister_id: canisters.backend,
  canister_ids: [canisters.frontend, canisters.backend],
  canisters: structuredGuide.canisters,
  agent_api: {
    canister_id: canisters.backend,
    guide_method: "getAgentGuide",
    api_doc_method: "getApiDoc",
    candid_url: `${productionOrigin}/agent-api.did`,
    mcp_url: productionMcpUrl,
  },
  instructions: structuredGuide.instructions,
};

writeOutput("llms.txt", llmsText);
writeOutput("llms-full.txt", llmsFullText);
writeOutput("agent-guide.json", `${JSON.stringify(structuredGuide, null, 2)}\n`);
writeOutput(
  ".well-known/ic-app.json",
  `${JSON.stringify(icAppManifest, null, 2)}\n`,
);
writeOutput("ic-app.json", `${JSON.stringify(icAppManifest, null, 2)}\n`);
writeOutput("agent-api.did", candid);
writeOutput(
  "robots.txt",
  `User-agent: *\nAllow: /\n\n# AI usage instructions\n# ${productionOrigin}/llms.txt\n`,
);

console.log(
  `Generated agent discovery files for backend ${canisters.backend} using ${canisters.mappingFile}.`,
);
