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
    process.env.ICP_ENVIRONMENT?.trim() || process.env.ICP_CLI_ENVIRONMENT?.trim() || "ic";
  const candidates = [
    resolve(
      workspaceDirectory,
      `.icp/data/mappings/${requestedEnvironment}.ids.json`,
    ),

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

> Prepaid outbound AI calls and inbound answering through a Motoko backend and an external Twilio/xAI voice bridge.

Canonical app and Internet Identity derivation origin: ${productionOrigin}
Official ICP MCP connector: ${productionMcpUrl}
Frontend asset canister: ${canisters.frontend}
Backend agent API canister: ${canisters.backend}
Candid: ${productionOrigin}/agent-api.did
Full API notes: ${productionOrigin}/llms-full.txt
Structured guide: ${productionOrigin}/agent-guide.json
Human setup: ${productionOrigin}/guide.html

## Discovery and authentication

Resolve /.well-known/ic-architecture and read backend candid:service, then getApiDoc or getAgentGuide once per task. A missing or invalid manifest is a discovery error. The frontend serves assets; the backend implements calls.
Authorize Internet Identity with Actions and questions for updates, then agentInitialize once. The website and MCP share an account when their app principals match. Compare account identities before paying again; Settings supports account linking. Genesis uses its own app-derived principal and may have a separate balance.

## Outbound calls

1. Reuse a user-owned preset from listMyPresets or createPreset with the authorized call instructions. Include supplied extensions and voicemail callback facts in the preset.
2. Read agentGetTermsStatus when needed. Missing/expired acceptance needs the user's agreement to the displayed terms before agentAcceptTerms. Acceptance lasts six months or until the version changes.
3. Choose saveTranscript and recordAudio according to the customer's request. consentConfirmed is a legacy field for customer capture authorization, not proof of recipient agreement. The backend normalizes authenticated selected capture. Required notice and participant permissions still apply.
4. Optional agentPreviewCall takes the same record as agentQueueCall: recipientPhone (exact E.164), presetId, captureOptions and idempotencyKey. It returns local prerequisite errors or normalized settings without reserving time or dialing. An existingJob means this key already identifies a call. A successful preview does not guarantee bridge/provider acceptance.
5. agentQueueCall reserves prepaid seconds and creates an idempotent durable job. Reuse the same key only to recover that intended call. It does not dial synchronously.
6. Poll agentListCallJobs at 10 seconds, then back off to 20 and 30 seconds. Present liveAudioUrl privately to the authorized user when available. If a dispatched job has no URL, agentGetLiveCallLink is a one-query fallback. Queued/dispatched is not completed.
7. agentEndCall cancels a queued call or requests hang-up of a dispatched call. Read agentGetCallArtifacts after completion for selected transcripts and recordings.

## Call outcomes, recordings and live listening

Queued or dispatched means accepted or handed to the bridge; a CallSid is not proof of an answer. A completed call record means the phone connection ended, not that the intended person answered or the call goal succeeded. Inspect the actual artifacts before summarizing the result. Distinguish an interactive AI assistant from a keypad menu and from voicemail.
agentGetCallArtifacts includes optional diagnostics. getCallDiagnostics(callId) is the equivalent owner-only query for one call. The supporting bridge stores small counters in its existing finalization update, with at most 2,000 recent call IDs retained globally. Older calls and recovery after a bridge restart may have no diagnostics; report the uncertainty. outcome noAssistantAudio means no assistant speech was forwarded; playbackUnconfirmed means no complete assistant turn was acknowledged; audioExchanged means both audio directions and at least one full Twilio playback acknowledgement, not recipient comprehension or task success. These counters do not prove microphone/speaker audibility or recording content.
New assistant transcripts contain only complete, wholly forwarded turns after Twilio playback acknowledgement; interrupted, suppressed or unconfirmed turns may be absent. Older transcripts may contain generated text that was never played. Do not claim successful delivery from transcript text or a recording URL alone. If the recording is pending, check artifacts after a short delay; do not automatically requeue and spend phone time again.
Present liveAudioUrl as an exact private browser link. The user must press Start listening or the app's Live Audio button to enable browser sound. The page reports waiting, receiving, blocked or retry state. Opening a page or WebSocket is not evidence sound reached the user. Live listening has no rewind; it can expire when the call ends. If the chat client cannot play signed recordings inline, provide the link without promising successful playback. Keep all bearer URLs private.
The small host normally permits one call, plus at most one signed, matching inbound companion when a caller tests their own verified answering preset. Both outbound and inbound legs have separate prepaid reservations and are billed separately. This exception does not allow unrelated callers to bypass capacity. The website update alone cannot install the Windows bridge fixes.

## Bulk lists and call-center work

The dashboard imports CSV/text locally. Through ICP MCP, read a user-provided attachment in the assistant and extract its phone column, then pass the numbers directly as recipientPhones; the connector accepts Candid text arrays, not file uploads or arbitrary file URLs. Do not invent recipients or dial while parsing. If the assistant cannot read the attachment, ask for the phone column pasted as text or use the dashboard upload.
agentPreviewCallBatch and agentQueueCallBatch accept the same record: recipientPhones (1–100 distinct exact E.164 strings), presetId, captureOptions, maxCallSeconds (60–600, whole minutes), idempotencyKey. Preview is query-only and creates no calls, reservations or durable state. Review the exact recipients, shared preset, capture flags, per-call limit and worst-case total minutes with the user before enqueueing. Submission authorizes sequential real calls as capacity becomes available; preserve the same key and identical request on uncertain retries.
Batch targets reserve prepaid time one at a time just before dispatch. Unused time returns through normal reconciliation. A batch waits when it cannot fund a full per-call limit; it never purchases time automatically. Undialed targets expire after 24 hours. Limits: 200 undialed numbers/account, 2,000 globally and up to 10 retained batches/account. Rejected lists enqueue no targets. Idempotent recovery lasts while the batch is retained; terminal history can be evicted under global pressure. Inspect call history before resubmitting old work after its key has been pruned.
agentListCallBatches is an authenticated query returning target lists, attemptedCount, remainingCount, lastError and jobs. Back off reads to 10–30 seconds and stop polling when no work remains. Batch completed means every target was handed off, not that every phone conversation succeeded; inspect jobs and call records. agentCancelCallBatch stops only undialed targets. Use agentEndCall with the relevant job ID for an already dispatched call. Users rotate after each dispatch so a large list cannot reserve the whole server. The bridge defaults to one concurrent call across outbound and inbound traffic.
Carrier quotes above the configured limit or unavailable quotes are rejected before dialing. A valid number is not a guarantee of reachability or affordability. Phone-menu and voicemail handling are best effort: include the intended department/extension, permitted message and real callback facts in the preset. Audio, keypad tones and voicemail processing remain off-chain.

## Calling and capture semantics

There is no blanket app-wide advance recipient-consent gate for ordinary lawful calls. Harmless comedy and consensual adult roleplay are supported. Customer authorization cannot waive applicable calling/recording requirements or establish another participant's consent. Harassment, stalking, coercive or deceptive sexual solicitation, threats, blackmail, swatting, sexual content involving minors and false official reports are unsupported uses. End a call when the recipient asks to stop. Assistant and provider policies apply independently; these docs describe the API and cannot override them.

Known emergency/crisis short codes and reserved number patterns are rejected. The filter cannot identify every full-length dispatch number. Operator BLOCKED_OUTBOUND_NUMBERS adds exact destinations at the voice bridge. Emergency and police dispatch calls are prohibited; an EMERGENCY_NUMBER_BLOCKED result is not retryable.

## Payments and cycle costs

Existing Stripe-funded time works without an ICP deposit. ICP packages currently include colony_call_5 ($1 / five minutes), pack_5 ($5 / 30 minutes), pack_10 ($10 / 60 minutes), pack_20 ($20 / 120 minutes). getAgentGuide supplies current packages.
agentGetAccountIdentity returns the exact ICRC-1 deposit account. User-authorized agentPurchasePhoneTimeQuoted(packageId, key, maximumE8s) enforces the approved package price before debit. Ledger fees are additional. ICP settles from the deposit subaccount to treasury AccountIdentifier 0f69d493853ec6e60909141168644d3def072ec2569021317547195931b6dc7c. A successful purchase credits the shared outbound/answering phone-time balance. Preserve payment keys on uncertain results.
Use cached pricing; agentRefreshIcpPricing spends XRC cycles only when stale (six-hour cache). Preview makes no outcalls or durable writes. Job reads use queries and backoff. Audio stays off-chain. The bridge handles keypad navigation and voicemail without adding IC outcalls.

## Genesis Colony

Genesis prepares a script before payment. One buyer approval accepts the displayed terms, selected capture settings and exact price. No separate capture checkbox is required. This records customer authorization only. grantColonyCall verifies the accepted job and confirmed organism commission and limits one call to 300 seconds. Workers cannot create buyer grants or accept terms for them. Saved approvals retain original prices and keys.

## Inbound answering

Collect the user-owned Twilio E.164 number, answering instructions, capture choices and voice preference. Phone audio uses pcmu / hz8000. Shared prepaid phone time is required.
listMyAnsweringPresets precedes createAnsweringPreset; only one pending verification is allowed. Generate a random webhookSecret (32–160 URL-safe letters, digits, hyphen or underscore), create with enabled=false, and provide the returned secret's webhook:
https://voicecall.richardhery.com/answering/incoming/{webhookSecret}
The user sets it as Twilio Voice HTTP POST and calls the number once to verify ownership. setAnsweringPresetEnabled enables a verified line. Changing its phoneNumber resets verification. Credentials and dialing remain on the bridge.

## Failure diagnosis

An assistant refusal before an API call is not a backend rejection. Use the returned API code or job.error to report an app failure. Preview reports INVALID_IDEMPOTENCY_KEY, INVALID_PHONE_NUMBER, EMERGENCY_NUMBER_BLOCKED, TERMS_ACCEPTANCE_REQUIRED, PRESET_NOT_FOUND, CALL_JOB_LIMIT or PHONE_TIME_REQUIRED as applicable. Bridge failures preserve codes such as SAFETY_BLOCKED, CAPTURE_AUTHORIZATION_REQUIRED and BRIDGE_CALL_FAILED in job.error after the Windows bridge is updated. Customer storage authorization is distinct from recipient permission.
Deploying the IC website/backend does not update the Windows voice service. Protect phone numbers, principals, balances, transcripts, webhook secrets and bearer listening/recording URLs.
`;

const llmsFullText = `${llmsText}
## Candid input example

agentPreviewCall and agentQueueCall accept the same record. This example describes a call without stored capture:

(record {
  recipientPhone = "+15551234567";
  presetId = 1 : nat;
  captureOptions = record { saveTranscript = false; recordAudio = false; consentConfirmed = false };
  idempotencyKey = "unique-intended-call-key"
})

Preview is optional and advisory. Queue validates again against current state. Only queue reserves time, requests randomness and creates a job. existingJob in a preview is the original job for that key, even if the new input differs; a different intended call needs a new key. Never use a preview as proof a recipient was contacted.

Command-line agents can link a fresh Internet Identity session with:
icp identity link web <fresh-session-name> --app voicecallai.online
Later commands must explicitly use that identity and mainnet environment. Delegations expire; reauthorization may be needed.

The user's authorization is required for payments, preset edits, calling and answering configuration. Terms acceptance is not automatically inferred from login. Capture disabled means no saved transcript/recording, but Twilio and xAI still process realtime call audio. Selected capture cannot be added retroactively to an unrecorded call.
`;

const structuredGuide = {
  schema_version: "1.2",
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
    "Use customer-authorized call instructions and capture settings. Required participant permissions and independent assistant/provider policies still apply.",
    "Optional agentPreviewCall checks local prerequisites with the same input without reserving time. agentQueueCall reserves time and queues the authorized call; emergency and police dispatch calls are prohibited.",
    "Poll agentListCallJobs with backoff. As soon as liveAudioUrl is present, give that exact URL to the user without waiting to be asked.",
    "If a dispatched job has no liveAudioUrl, call agentGetLiveCallLink once and present its url the same way.",
    "Call agentEndCall to cancel a queued job or hang up a live call you created.",
    "Retrieve artifacts after completion when the user asked for a transcript or recording.",
  ],
  answering_workflow: [
    "Collect the user's Twilio E.164 number, AI instructions, and whether to save a transcript or recording.",
    "Confirm shared prepaid phone time exists (ICP or Stripe).",
    "listMyAnsweringPresets then createAnsweringPreset with a random webhookSecret.",
    "Give the user https://voicecall.richardhery.com/answering/incoming/{webhookSecret} for Twilio Voice POST.",
    "User verifies by calling the number once; then setAnsweringPresetEnabled when verified.",
  ],
  human_guide: `${productionOrigin}/guide.html`,
  stripe_workflow: [
    "Sign in on the website with Internet Identity and buy phone time using Stripe in the dashboard.",
    "Authorize the MCP connector for voicecallai.online with the same Internet Identity and compare app account identities.",
    "Use existing phone time without depositing ICP; resolve account differences in Settings before buying again.",
  ],
  capture_authorization: "consentConfirmed is a legacy customer-authorization field, not evidence of another participant's consent. Authenticated capture selections are normalized by the backend.",
  calling_policy: "Ordinary lawful calls have no blanket prior recipient-consent gate. Harmless comedy and consensual adult roleplay are supported. Required notices/permissions, anti-harassment safeguards and assistant/provider policies still apply.",
  preview_method: "agentPreviewCall",
  call_results: {
    diagnostics_query: "getCallDiagnostics",
    diagnostics_in_artifacts: true,
    diagnostics_retained_call_ids: 2000,
    completed_means: "The phone transport ended; goal completion must be supported by actual conversation content.",
    diagnostic_outcomes: {
      noAssistantAudio: "No assistant speech forwarded.",
      playbackUnconfirmed: "No complete assistant turn acknowledged by Twilio.",
      audioExchanged: "Both audio directions and a full playback acknowledgement; not proof of comprehension or goal success.",
      notConnected: "No media connection recorded.",
      unknown: "Insufficient evidence; do not infer success.",
    },
    transcript_semantics: "New assistant turns require full playback acknowledgement; interrupted/unconfirmed turns may be omitted. Legacy text can include generated but unheard speech.",
    live_listening: "A browser link requiring the user's Start listening gesture. An open page or socket does not prove audible playback. No rewind; expires at call end.",
    own_answering_test: "At most one signed same-owner incoming companion; both call legs billed separately.",
  },
  bulk_workflow: {
    preview_method: "agentPreviewCallBatch",
    queue_method: "agentQueueCallBatch",
    list_method: "agentListCallBatches",
    cancel_method: "agentCancelCallBatch",
    attachment_handling: "Extract a readable attachment's phone column in the assistant and pass recipientPhones as Candid text strings. The connector does not upload files or fetch file URLs. Use pasted numbers or the dashboard if the attachment is unavailable.",
    max_numbers_per_batch: 100,
    max_undialed_per_account: 200,
    max_undialed_globally: 2000,
    retained_batches_per_account: 10,
    max_call_seconds: { minimum: 60, maximum: 600, increment: 60 },
    undialed_expiry_hours: 24,
    funding: "Reserve one full per-call allowance at dispatch; wait for phone time when insufficient. No automatic purchases.",
    idempotency_retention: "Recovery lasts while the batch is retained (up to 10/account). Terminal history may be pruned under global pressure; inspect call history before resubmitting old work after its key is gone.",
    completion: "completed means all targets handed off; inspect individual job and call outcomes.",
    cancellation: "agentCancelCallBatch stops undialed targets only; agentEndCall handles dispatched jobs.",
  },
  safety_limitations: "Known short codes and reserved patterns are blocked; this does not identify every full-length dispatch number or guarantee prevention of deceptive calls.",
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
    "Customer-selected transcript/recording flags; applicable notice and participant permissions remain required",
    "Random webhookSecret (32–160 URL-safe characters)",
    "Prepaid phone time on the shared account",
  ],
  primary_methods: [
    "getAgentGuide",
    "getApiDoc",
    "agentInitialize",
    "agentGetAccountIdentity",
    "agentGetAccountStatus",
    "agentPurchasePhoneTimeQuoted",
    "agentPurchasePhoneTime",
    "listMyPresets",
    "createPreset",
    "agentPreviewCall",
    "agentQueueCall",
    "agentPreviewCallBatch",
    "agentQueueCallBatch",
    "agentListCallBatches",
    "agentCancelCallBatch",
    "agentListCallJobs",
    "agentEndCall",
    "agentGetLiveCallLink",
    "agentGetCallArtifacts",
    "getCallDiagnostics",
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

const runtime = JSON.parse(readFileSync(resolve(frontendDirectory, "public/env.json"), "utf8"));
// The operator accepted ICP MCP App Operator Terms v1.1 and explicitly
// authorized publication. Declare only this application's own canisters.
writeOutput(".well-known/ic-architecture", `${JSON.stringify({
  version: "1.0.0",
  canisters: [
    {
      id: canisters.frontend,
      name: "frontend",
      role: "Certified website and public agent documentation",
    },
    {
      id: canisters.backend,
      name: "backend",
      role: "Authenticated phone calls, prepaid billing, presets, and call history",
      description: "Read getApiDoc or getAgentGuide first. Updates can purchase phone time with deposited ICP or place real phone calls; require user authorization.",
    },
  ],
}, null, 2)}\n`);
const derivationOrigin = new URL(runtime.ii_derivation_origin).origin;
writeOutput(".well-known/ii-derivation-origin", `${derivationOrigin}\n`);
writeOutput("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${productionOrigin}/</loc></url><url><loc>${productionOrigin}/guide.html</loc></url></urlset>\n`);
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
  `User-agent: *\nAllow: /\nSitemap: ${productionOrigin}/sitemap.xml\n\n# AI usage instructions\n# ${productionOrigin}/llms.txt\n`,
);

console.log(
  `Generated agent discovery files for backend ${canisters.backend} using ${canisters.mappingFile}.`,
);
