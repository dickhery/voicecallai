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
3. Read the backend Candid interface and call the public query getAgentGuide once for current workflow and safety instructions.
4. Authorize the connector for this app with Internet Identity before authenticated updates. Call agentInitialize once for the authenticated app principal.

## Place a call

1. Call listMyPresets and reuse an appropriate user-owned preset, or create one with createPreset.
2. Call agentGetAccountStatus once when a live balance check is needed. If phone time is low, explain the current packages before buying any.
3. Confirm recipient, purpose, preset, transcript choice, recording choice, and applicable consent with the user.
4. Call agentQueueCall with an E.164 phone number, preset ID, capture options, and a unique idempotency key.
5. Track the durable job with agentListCallJobs. Start at a 10-second polling interval and back off to 30 seconds. Never claim the call completed merely because it was queued.
6. After completion, use agentGetCallArtifacts when the user requested and consented to saved artifacts.

The off-chain VoiceCall AI bridge securely claims queued jobs and connects Twilio Media Streams to xAI Voice. Agents do not need a Twilio or xAI tool of their own.

## Important rules

- An idempotency key identifies one intended call, purchase, or transfer. Reuse it only to retry that exact action.
- Never buy phone time, transfer ICP, edit a preset, or queue a call without the user's authorization.
- consentConfirmed means the user affirmed that applicable participant consent requirements are satisfied. It is required when saving a transcript or audio.
- Never use the app for threats, harassment, fraud, credential theft, unlawful impersonation, or other harmful activity.
- Treat phone numbers, transcripts, recording links, account identifiers, and balances as sensitive.
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

getAgentGuide and getAgentPricing are public queries. All account-scoped reads and all updates require a non-anonymous Internet Identity principal derived for ${productionOrigin}. In an MCP client, enable Internet Identity AI access, trust ${productionMcpUrl}, and authorize Actions and questions. Re-authorize when a delegation expires.

Command-line agents may use a fresh linked identity:

icp identity link web <fresh-session-name> --app voicecallai.online

Always specify that linked identity and the mainnet environment on later calls. Never silently switch identities.

## Minimal workflow

1. Call getAgentGuide once and cache it for the task.
2. Call agentInitialize with a short client or workspace name.
3. Call listMyPresets and listMyCalls before creating duplicates.
4. Use agentGetAccountStatus only when a current ICP or phone-time balance is relevant. Do not repeatedly refresh it.
5. If a preset is needed, call createPreset with user-approved instructions. The voice bridge treats the preset as private source material and asks xAI Voice to speak naturally rather than read it verbatim.
6. Confirm the exact recipient in E.164 format, call purpose, preset, transcript choice, recording choice, and consent status.
7. Generate one unique idempotency key for this intended call and call agentQueueCall.
8. Read agentListCallJobs after about 10 seconds. Back off to 20 and then 30 seconds while waiting. Use listMyCalls or getCallRecord for the resulting call record.
9. Say "queued", "dispatched", "in progress", or "completed" according to returned state. Do not report a successful live call without supporting state.
10. Call agentGetCallArtifacts only after completion and only when the user is authorized to see the artifacts.

## Funding phone time with ICP

Use agentGetAccountIdentity to obtain the exact ICRC-1 depositAccount; never guess it. If the cached quote is stale, call agentRefreshIcpPricing once. A real refresh uses the Exchange Rate Canister and is globally rate-limited and cached for six hours. Call agentPurchasePhoneTime only after the user chooses a package and authorizes payment. Use agentTransferIcp to move unspent ICP. Purchases and transfers require their own idempotency keys.

## Capture and consent

The agentQueueCall captureOptions record controls saveTranscript, recordAudio, and consentConfirmed. When either capture option is true, consentConfirmed must be true and must reflect the user's assertion that applicable participant consent requirements are satisfied. Do not infer consent from silence. When both capture options are false, do not request artifacts later.

## Architecture and cost behavior

agentQueueCall reserves prepaid seconds and creates a bounded durable job. The off-chain voice bridge polls for pending jobs, claims a job with its server identity, places the Twilio call, and connects the call to xAI's grok-voice-latest realtime model. xAI, Twilio, Stripe, and recording secrets never reside in the frontend or canister.

Static discovery files and public canister queries are intentionally small. Avoid rapid status polling and avoid calling agentRefreshIcpPricing while the current quote is fresh. This keeps canister cycle use conservative.

## Safety

Obtain user approval before external effects. Do not use VoiceCall AI for threats, harassment, fraud, credential theft, unlawful impersonation, or other harmful activity. Protect phone numbers, transcripts, signed recording links, balances, principals, and deposit accounts.
`;

const structuredGuide = {
  schema_version: "1.0",
  name: "VoiceCall AI",
  canonical_origin: productionOrigin,
  summary:
    "Place and manage real AI phone calls through the VoiceCall AI backend canister and its off-chain xAI Voice/Twilio bridge.",
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
    "Call getAgentGuide once.",
    "Authenticate with Internet Identity and call agentInitialize once.",
    "List existing presets and calls before creating duplicates.",
    "Check the live account status only when balances are needed.",
    "Confirm recipient, purpose, preset, capture choices, and consent.",
    "Call agentQueueCall with an E.164 number and a unique idempotency key.",
    "Poll agentListCallJobs with backoff and report only returned state.",
    "Retrieve artifacts after completion only when capture was approved.",
  ],
  primary_methods: [
    "getAgentGuide",
    "agentInitialize",
    "agentGetAccountIdentity",
    "agentGetAccountStatus",
    "listMyPresets",
    "createPreset",
    "agentQueueCall",
    "agentListCallJobs",
    "agentGetCallArtifacts",
  ],
  cycle_guidance: [
    "Read and cache the guide once per task.",
    "Do not repeatedly call live balance queries.",
    "Poll job state at 10 seconds, then back off to 20 and 30 seconds.",
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
