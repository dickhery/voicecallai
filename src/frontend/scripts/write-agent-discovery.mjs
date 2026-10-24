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

## Set up in the app or with an AI assistant

VoiceCall AI supports both paths: sign in and open AI Answering, or ask an assistant using the Internet Computer Protocol plugin in ChatGPT (where available) or the official ICP MCP connector to configure the service with your approval. An inquiry about setup can start with these choices and a useful example: “Set up an after-hours receptionist that answers our FAQs and takes callback requests.” The assistant gathers the details, creates or edits the app preset, and returns its setup checklist. It cannot edit Twilio or a phone carrier through ICP MCP alone.
Use cases: business front desk, after-hours message taking, FAQs, custom instructions, appointment booking, and personal call screening. Provide the actual business facts, greeting, and escalation instructions. Appointment booking is a separate account calendar: save office hours with setMySchedule, then bookAppointment saves the caller's name, E.164 phone, time slot, and notes. A spoken request is not a reservation until that call returns ok. There is no live transfer, SMS, or email delivery. Save transcripts if messages must remain available in History; capture off means no saved conversation. Do not promise automatic follow-up from spoken instructions alone.
The current bridge supports numbers provisioned in its operator-configured Twilio account. An unrelated customer Twilio account's webhook will not authenticate merely by pasting the URL. Users without a supported number need operator onboarding. Existing mobile/business lines can optionally forward to a supported Twilio number through their carrier; forwarding availability/cost and fallback are carrier settings. Avoid a forwarding loop.

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
For phone-time-only checks, use getMyBillingStatus or getAnsweringSetupStatus.availablePhoneSeconds, both local queries. agentGetAccountStatus calls the ledger for current deposited ICP and fee, so use it when those details are needed. Use cached pricing; agentRefreshIcpPricing spends XRC cycles only when stale (six-hour cache). Preview makes no outcalls or durable writes. Job reads use queries and backoff. Audio stays off-chain. The bridge handles keypad navigation and voicemail without adding IC outcalls.

## Genesis Colony

Genesis prepares a script before payment. One buyer approval accepts the displayed terms, selected capture settings and exact price. No separate capture checkbox is required. This records customer authorization only. grantColonyCall verifies the accepted job and confirmed organism commission and limits one call to 300 seconds. Workers cannot create buyer grants or accept terms for them. Saved approvals retain original prices and keys.

## Inbound answering

1. Confirm a supported Twilio E.164 number, short service name, role/greeting, known facts and message/escalation instructions. Ask whether to save transcripts or audio (both off by default), and for voice preference only if desired. Check current terms and shared phone time without purchasing automatically. Terms acceptance requires the user's agreement.
2. listMyAnsweringPresets before creating; reuse existing setup and resolve a pending verification first. After setup authorization, generate a cryptographically random webhookSecret (32–160 URL-safe letters, digits, hyphen or underscore) and call createAnsweringPresetSimple({name,phoneNumber,systemPrompt,voice:opt Voice,captureOptions,webhookSecret}). It selects safe telephony defaults and creates disabled. createAnsweringPreset remains available for advanced options. On an uncertain create response, list and match the intended number before retrying; create is not an idempotent payment/call API.
3. getAnsweringSetupStatus(id) is an owner-only query returning the exact private webhookUrl, webhookMethod, verificationStatus, enabled, termsCurrent, availablePhoneSeconds, readyForCalls and nextSteps. It makes no external probe or durable write. Give the URL privately to the user. The user or a separately authorized Twilio tool sets that number's “A call comes in” Voice webhook to HTTP POST and saves.
4. Call the number from another phone to verify signed routing. A disabled preset may play “unavailable” while still verifying; this first call is not proof the AI conversation works. Refresh status on request after the test. Once verified, use setAnsweringPresetEnabled(id,true) with user authorization, then make a second test call to hear the AI and check capture in History if selected. Outbound app tests also spend phone time, with both outbound and inbound legs billed. Do not initiate them without authorization.
5. readyForCalls means app prerequisites only, not live Twilio/provider health, spare bridge capacity or a successful end-to-end call. Verification is historical; after editing routing or forwarding, test again. Changing phoneNumber resets verification. Pause using setAnsweringPresetEnabled(id,false); this stops new answering calls but does not restore Twilio/carrier routing or end an existing call. Configure provider fallback separately. Keep credentials on the bridge and secrets/private URLs out of public outputs. Read readiness on demand, without timers or rapid polling.

## Appointment calendar

Booking is optional and separate from the answering preset. Ask before turning it on. Call suggestedSchedule for a Monday–Friday 09:00–17:00 UTC template, edit it with the user, and save with setMySchedule. weeklyHours has seven records, Sunday at index 0 through Saturday at index 6. timezoneOffsetMinutes is a fixed UTC offset, such as -300 or -240; daylight saving does not change it automatically. slotMinutes is 15, 30, 45, or 60. bookingWindowDays is 1–60. enabled true allows bookings.

listOpenSlots(fromMs, toMs) and listMyAppointments(fromMs, toMs) are authenticated queries. Times are Unix milliseconds. Open-slot queries return at most 48 slots and scan at most 14 days. Appointment lists cover at most 62 days and 100 rows. bookAppointment saves callerName, E.164 callerPhone, startsAtMs from listOpenSlots, optional presetId, serviceLabel, and notes. cancelAppointment, rescheduleAppointment, and updateAppointmentDetails change a booking. An account stores at most 200 appointments. None of these calls uses the ledger, HTTP, a timer, or phone time.

Tell the user to review bookings at ${productionOrigin}/user/schedule or by asking you to list them. Mention booking in the answering instructions. A live call can use list_open_times and book_appointment only after the Windows voice bridge running this release is restarted. Deploying this website does not update that bridge. Do not call getScheduleForServer, listOpenSlotsForServer, or bookAppointmentForServer.

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
  schema_version: "1.4",
  name: "VoiceCall AI",
  canonical_origin: productionOrigin,
  summary:
    "Place real AI calls and configure inbound answering in the app or through the Internet Computer Protocol plugin / ICP MCP. Incoming lines must be supported by the operator's configured Twilio bridge account.",
  discovery_warning:
    "The frontend canister is an asset canister. If it is the only canister initially discovered, continue with the declared backend canister before deciding telephony is unavailable.",
  mcp: {
    name: "Official Internet Computer MCP / Agent Identity",
    url: productionMcpUrl,
    authentication: "Internet Identity",
    required_permission: "Actions and questions",
  },
  setup_options: {
    web: `${productionOrigin}/user/answering`,
    assistant: "Use the Internet Computer Protocol plugin in ChatGPT if available, or add the official ICP MCP connector in an MCP client. Internet Identity authorizes app-specific actions.",
    example_request: "Help me set up an after-hours receptionist for my business. Gather my number, greeting, business facts and message-taking preferences, show me the setup, then help me connect and test it.",
    human_guide: `${productionOrigin}/guide.html#answering`,
    external_steps: "ICP MCP changes app configuration only. Twilio webhook configuration and optional carrier forwarding require the user or a separately authorized tool.",
    number_requirement: "Number provisioned in the operator bridge's configured Twilio account. A separate customer Twilio account is not supported by webhook URL alone; contact the operator for onboarding.",
  },
  answering_use_cases: ["Business front desk", "After-hours messages", "Business FAQs", "Custom answering instructions", "Appointment booking", "Personal call screening"],
  answering_limitations: "No live transfer, SMS/email notifications, or automatic follow-up. Appointment booking uses the account calendar and does not spend phone time. A request is reserved only after bookAppointment succeeds. Messages remain in History only with selected saved capture; realtime audio still passes through Twilio/xAI. Bridge capacity and provider availability apply. Live in-call booking requires the updated voice bridge.",
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
    "Confirm a supported Twilio number in the bridge's configured account, service name, business facts/greeting, instructions and saved capture choices. Defaults keep capture off.",
    "Read current terms for user agreement and check shared prepaid phone time (ICP or Stripe); purchases require authorization.",
    "listMyAnsweringPresets then createAnsweringPresetSimple with name, phoneNumber, systemPrompt, optional voice, captureOptions and a cryptographically random webhookSecret. Defaults create disabled; advanced createAnsweringPreset is still supported. Resolve pending setup before another create.",
    "getAnsweringSetupStatus(id) returns the exact private webhookUrl and HTTP POST. User or a separately authorized Twilio tool configures and saves it in Twilio Voice settings.",
    "User calls the number to verify. Disabled verification may play unavailable. Recheck on demand; when verified, enable with user authorization, then make a second test call to hear the AI and inspect selected capture in History.",
    "readyForCalls reports app prerequisites only, not Twilio configuration/provider health or available bridge capacity. Do not equate it to successful end-to-end testing.",
    "Disabling stops new AI answering, not an ongoing call or carrier forwarding. Arrange fallback in the carrier/Twilio configuration.",
    "For appointments, save office hours with setMySchedule, check listOpenSlots, and book with bookAppointment. Show the Calendar page for review. Booking is a local update and does not buy or spend phone time.",
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
    "Twilio number in E.164 provisioned in the operator bridge's configured account; contact operator for a supported number",
    "Ability to set Twilio Voice webhook",
    "Answering AI instructions and name",
    "Customer-selected transcript/recording flags; applicable notice and participant permissions remain required",
    "Random webhookSecret (32–160 URL-safe characters)",
    "Prepaid phone time on the shared account",
    "Optional calendar: fixed UTC offset, seven weekday hours, slot length, notice, booking window, service label, and notes",
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
    "createAnsweringPresetSimple",
    "getAnsweringSetupStatus",
    "createAnsweringPreset",
    "setAnsweringPresetEnabled",
    "suggestedSchedule",
    "getMySchedule",
    "setMySchedule",
    "listOpenSlots",
    "listMyAppointments",
    "bookAppointment",
    "cancelAppointment",
    "rescheduleAppointment",
    "updateAppointmentDetails",
    "updateAnsweringPreset",
    "deleteAnsweringPreset",
  ],
  cycle_guidance: [
    "Read and cache the guide once per task.",
    "Do not repeatedly call live balance queries.",
    "Poll job state at 10 seconds, then back off to 20 and 30 seconds.",
    "Read the transient live call link at most once per dispatched call.",
    "Refresh ICP pricing only when the cached quote is stale.",
    "Answering readiness is query-only; read after a setup change or user test, without background polling.",
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
