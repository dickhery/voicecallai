# VoiceCall AI

VoiceCall AI is an IC-hosted app with a separate Node.js voice bridge for Twilio Media Streams and xAI Realtime Voice.

The Twilio error happened because the old code generated this webhook URL:

```text
https://<twilio-account-sid>.icp0.io/twilio-webhook
```

That is not a valid IC canister URL. Twilio reached the IC gateway, but the gateway could not resolve a canister, so it returned `canister_id_not_resolved` instead of TwiML XML.

This version keeps the IC canister for auth, presets, and history, but moves these live network calls to `src/server`:

- Twilio REST `calls.create`
- Twilio TwiML `/twiml`
- Twilio Media Streams WebSocket `/media`
- xAI Realtime Voice WebSocket
- Stripe Checkout Session creation and webhook fulfillment

## ICP Deployment Setup

This repository was exported from Caffeine, but deployment now uses the current
ICP CLI workflow directly:

- `icp.yaml` uses `@dfinity/motoko@v5.0.0` and
  `@dfinity/asset-canister@v2.2.1`.
- Mops is pinned in the root package instead of relying on an older global
  installation.
- `@icp-sdk/bindgen` generates frontend bindings from the committed backend
  Candid file.
- The frontend reads canister IDs and the network root key from the certified
  asset canister's `ic_env` cookie.
- Internet Identity uses the current `@icp-sdk/auth` client. The canonical
  derivation origin is retained for the existing custom domains.
- Caffeine blob storage and deployment manifests were removed. The
  `caffeineai-authorization` Motoko package remains because the backend still
  uses its access-control mixin.

The original deployment failures came from a missing `caffeine-bindgen`
executable, mixed old/new SDK packages, an outdated global Mops runner, and an
obsolete Motoko v4 recipe configuration. On macOS, files offloaded by iCloud
can also make build tools appear to hang; keep the repository downloaded
locally or move it outside an optimized iCloud folder.

The deployed frontend canister is
`2nukr-cyaaa-aaaak-qy2ja-cai`. Open it at
`https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io`, not at an
`icp-api.io` URL. `icp-api.io` is for agents and CLI tooling.

References:

- Twilio Media Streams overview: https://www.twilio.com/docs/voice/media-streams
- Twilio Stream TwiML: https://www.twilio.com/docs/voice/twiml/stream
- Twilio WebSocket message format: https://www.twilio.com/docs/voice/media-streams/websocket-messages
- xAI Speech-to-Speech: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
- xAI Text-to-Speech: https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- xAI Speech-to-Text: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text

## Security Boundary

The IC canister stores application state only. Never put xAI, Twilio, Stripe,
recording-access, or server-identity secrets in canister arguments, stable
state, `src/frontend/public/env.json`, or frontend source. Put them only in
`src/server/.env` (or the secret store used by the deployed Node service).

The backend retains its former credential fields solely for stable-upgrade
compatibility. On install or upgrade it clears those legacy secret values, and
the admin UI reports bridge configuration without displaying or accepting
credentials.

## Project Layout

```text
src/backend      Motoko canister: auth, presets, call history, phone-time balances
src/frontend     Vite frontend deployed as an IC asset canister
src/server       Windows-friendly Node.js Twilio/xAI/Stripe bridge
icp.yaml         icp-cli deployment config
```

## Natural Voice Presets

Saved presets are treated by the Node voice bridge as private source material, not as a script to read. `src/server/server.js` wraps each preset before sending it to xAI Realtime Voice so the agent internalizes the role, facts, goals, and boundaries, then paraphrases them naturally during the call.

Good presets describe the agent's role, goal, must-cover facts, and boundaries. Avoid long numbered scripts or "say exactly this" wording unless a fixed phrase, name, date, phone number, URL, price, or compliance statement must stay exact.

## Ready-made Agent Catalog

The frontend ships a cycle-friendly catalog of professional and fun agents (`src/frontend/src/lib/agent-presets.ts`). Templates live in the asset bundle only — they are not stored as global canister state — so the catalog can grow without heap growth or upgrade migrations. One-click “Add” creates a normal user-owned preset via the existing create APIs.

- **Outbound call agents** appear on the Dashboard and Settings pages (appointment confirmation, lead qual, support callback, research briefing, pizza mix-up, alien tourism, and more).
- **Inbound answering agents** appear on the AI Answering page (front desk, after-hours, tech intake, pirate reception, wizard tower, and more).
- Templates may embed a hidden `[[vc:session]]` block with Grok Voice options (reasoning effort, speech speed, language hint, idle re-engage timeout, keyterms, force opening). The UI strips this block while editing; the voice bridge applies it on `session.update`.

## Grok Voice Session Features

The Node bridge is compatible with Grok Voice Think Fast 2.0 and enables the
current Speech-to-Speech session parameters when placing calls:

- Production default `grok-voice-think-fast-2.0` (override with `XAI_MODEL`)
- `reasoning.effort` (`high` / `none`)
- `turn_detection.idle_timeout_ms` for re-engagement after silence
- `audio.output.speed`
- `audio.input.transcription.language_hint` and `keyterms`
- Opted-in saved transcripts use the realtime session's
  `grok-transcribe` input transcription instead of opening a second STT
  WebSocket and sending caller audio twice
- Session resumption (`resumption.enabled`)
- Optional inbound `force_message` openings for fixed greetings

Think Fast 2.0 is API-compatible with the existing realtime event flow, so no
preset rewrite is required. xAI announced better telephony/noise transcription,
tool reliability, conversational dynamics, and time to first audio. The
versioned model is pinned here so a future `grok-voice-latest` rollover cannot
change production behavior without staging validation. The model is priced by
xAI at `$0.08/min` of audio, so review prepaid package margins together with
Twilio costs before changing package duration or price.

After pulling server changes on the Windows voice host, re-run `scripts/update-voicecall-service.ps1` so live calls pick up the bridge updates.

## Prepaid Phone Time

The app now sells prepaid phone time and enforces it before and during calls.

Packages:

```text
$5  = 30 minutes
$10 = 60 minutes
$20 = 120 minutes
```

Payment flow:

1. The logged-in user selects a package in the dashboard.
2. The frontend creates a `purchaseIntent` in the IC backend.
3. The Node server creates a Stripe Checkout Session.
4. Stripe calls the Node webhook after payment.
5. The Node server verifies the webhook and credits seconds in the IC backend.
6. Before a call starts, the frontend reserves paid seconds in the IC backend.
7. `/initiate-call` refuses to dial unless the reservation token verifies.
8. The Node server ends the Twilio call when the reserved paid time runs out.

Admin users receive Stripe test-mode Checkout Sessions. Non-admin users receive live-mode Checkout Sessions.

## AI Chat Access Through ICP MCP

VoiceCall AI exposes an agent-oriented Candid surface for the official DFINITY
ICP MCP connector:

```text
https://mcp.internetcomputer.org/mcp
```

The production frontend also exposes small, cacheable discovery documents so
an agent can find the backend without mistaking the asset canister for the
whole application:

```text
https://voicecallai.online/llms.txt
https://voicecallai.online/llms-full.txt
https://voicecallai.online/agent-guide.json
https://voicecallai.online/.well-known/ic-app.json
https://voicecallai.online/agent-api.did
```

The frontend build generates these from the committed mainnet canister mapping
and the built backend Candid interface. It also assigns explicit text or JSON
content types and cross-origin read access, avoiding the SPA fallback that
previously returned `index.html` at discovery paths.

The beta Internet Identity test connector is:

```text
https://mcp.beta.id.ai/mcp-beta
```

Use the production connector for this mainnet app. In Internet Identity,
enable **AI access**, trust the connector, then add the connector to ChatGPT,
Claude, or another MCP client. Grant **Actions and questions** when the agent
needs to buy phone time, transfer ICP, edit presets, or place calls.

The agent should discover and call these methods in order:

1. `getAgentGuide` — public onboarding, consent rules, required call inputs,
   current packages, and the rest of the agent API.
2. `agentInitialize` — registers the authenticated app principal. The same
   Internet Identity app principal is the account boundary for presets, call
   history, prepaid time, and the in-app ICP deposit account.
3. `agentGetAccountStatus` — checks deposited ICP, ledger fee, available phone
   time, low-balance guidance, and cached ICP pricing.
4. `agentRefreshIcpPricing` — refreshes ICP/USD through the Exchange Rate
   Canister only when the six-hour cache is stale.
5. `agentPurchasePhoneTime` — pays from the principal's deposit subaccount and
   credits the same `$5 / $10 / $20` packages used by Stripe.
6. `agentQueueCall` — reserves time and writes a durable job for the external
   voice server. It requires E.164 phone number, preset ID, capture choices,
   consent confirmation when saving artifacts, and an idempotency key.
7. `agentListCallJobs` and `listMyCalls` — track dispatch and call state.
8. `agentGetLiveCallLink` — after dispatch, returns a short-lived,
   listen-only HTTPS page that the agent can give the authorized user.
9. `agentGetCallArtifacts` — after completion, returns approved transcripts
   and a signed recording link.

Every authenticated app principal receives a deterministic ICRC-1 subaccount
owned by the backend canister. Fund the `depositAccount` returned by
`agentGetAccountIdentity`; do not send funds to a guessed address. Unspent ICP
can be moved with `agentTransferIcp`. Purchases and transfers require an
idempotency key so an MCP client can safely retry an uncertain result without
paying twice.

The voice server polls only a bounded public job list, exponentially backs off
from 10 to 30 seconds while that list is empty, performs an update call only
when it claims or finalizes a real job, and reuses the existing paid-call
reservation and reconciliation flow. Audio remains on the voice server/Twilio
(never on the Motoko canister), so playback does not consume IC cycles.
Answering-service bridge recordings are written under
`src/server/data/bridge-recordings/` (or `BRIDGE_RECORDING_DIR`) with a default
30-day retention (`BRIDGE_RECORDING_TTL_MS`) so history links survive process
restarts. Outbound Twilio recordings continue to stream through Twilio.
Listen-only links use a token distinct from the call-control token and are kept
in transient canister memory, so an upgrade invalidates them and no live token
is added to stable state. An agent reads the link with one query only when the
user asks to listen. This keeps stable storage and cycle usage conservative.

The Settings page includes a human-readable setup panel with the connector
URL, ICP account identifiers, balance checks, and current ICP package prices.
The existing Stripe web checkout remains unchanged.

## Where To Put Canister IDs

For a new deployment, `icp deploy` writes IDs under:

```text
.icp/data/mappings/
```

Do not delete that folder after deployment.

If you already have existing mainnet canisters, copy the example file:

```powershell
New-Item -ItemType Directory -Force .icp\data\mappings
Copy-Item .icp\data\mappings\ic.ids.example.json .icp\data\mappings\ic.ids.json
notepad .icp\data\mappings\ic.ids.json
```

Then replace the placeholders with the real IDs:

```json
{
  "backend": "aaaaa-aaaaa-aaaaa-aaaaa-cai",
  "frontend": "bbbbb-bbbbb-bbbbb-bbbbb-cai"
}
```

The frontend reads non-secret runtime settings from:

```text
src/frontend/public/env.json
```

Use the helper scripts rather than editing this file by hand:

```powershell
pnpm configure:frontend:local
pnpm configure:frontend:ic -- --voice-server-url https://your-public-voice-server
```

The helper reads the frontend ID from `.icp/data/mappings/` when available,
writes `src/frontend/public/env.json`, and prints the URL you should open.
Backend IDs are supplied automatically by the asset canister and are no longer
duplicated in `env.json`.

If you edit `src/frontend/public/env.json` directly, set:

- `voice_server_url`: your Cloudflare Tunnel or deployed Node server URL
- `ii_derivation_origin`: the canonical frontend canister origin used by
  Internet Identity, normally `https://<frontend-id>.icp0.io`

The frontend build fails when the runtime URL is a placeholder, malformed, or
blocked by the asset canister CSP.

## Windows Setup

Open PowerShell as your normal user.

### 1. Install tools

```powershell
winget install OpenJS.NodeJS.LTS
corepack enable
corepack prepare pnpm@latest --activate
npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm ic-mops
```

Verify:

```powershell
node --version
pnpm --version
icp --version
ic-wasm --version
mops --version
```

Use Node.js 22 or newer.

### 2. Install project dependencies

```powershell
cd C:\path\to\voicecall-ai
pnpm install --prefer-offline
pnpm exec mops install
```

### 3. Configure the voice server

```powershell
Copy-Item src\server\.env.example src\server\.env
notepad src\server\.env
```

Fill these values:

```text
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+13366098857
TWILIO_PHONE_NUMBERS=+13366098857,+17016077987
XAI_API_KEY=xai-...
XAI_MODEL=grok-voice-think-fast-2.0
HOSTNAME=
FRONTEND_ORIGIN=https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_CANISTER_ID=2nukr-cyaaa-aaaak-qy2ja-cai
BACKEND_CANISTER_ID=2dwhz-ziaaa-aaaak-qy2ia-cai
BACKEND_HOST=https://icp-api.io
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...
STRIPE_TEST_PRICE_5=price_...
STRIPE_TEST_PRICE_10=price_...
STRIPE_TEST_PRICE_20=price_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_...
STRIPE_LIVE_PRICE_5=price_...
STRIPE_LIVE_PRICE_10=price_...
STRIPE_LIVE_PRICE_20=price_...
```

The Stripe Price IDs must point to one-time products for 30, 60, and 120
minutes respectively. The dollar amounts remain $5, $10, and $20.

Leave `HOSTNAME` blank until your tunnel is running.

For local-only testing, you may temporarily use `FRONTEND_ORIGIN=*`. For production, keep it restricted to your IC frontend. The server normalizes trailing slashes, so both of these work:

```text
FRONTEND_ORIGIN=https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_ORIGIN=https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io/
```

`FRONTEND_CANISTER_ID` is optional, but useful because the server will allow both `https://<id>.icp0.io` and `https://<id>.ic0.app`.

Create the server identity that the Node service uses to credit payments and verify reservations:

```powershell
node src\server\scripts\create-ic-server-identity.mjs
```

Copy the printed `ICP_SERVER_IDENTITY_JSON=...` line into `src\server\.env`. Copy the printed principal too; after the backend is deployed, your admin identity must grant that principal admin access:

```powershell
pnpm server:check-identity
```

This prints the real principal derived from `ICP_SERVER_IDENTITY_JSON`, an exact
CLI command, and the current authorization status. Do not copy placeholder text
such as `SERVER_PRINCIPAL` into a Candid argument.

The grant must be made by an identity that is already an app admin. The safest
path is to sign in with the existing browser admin, open **Admin > Users**,
paste the printed server principal, select **Admin**, and click **Assign Role**.
After the updated voice server is running, **Admin Dashboard > Payment Server >
Authorize Server** performs the same grant. This permission lets the Node
server read purchase intents, credit phone time after Stripe webhooks, and read
the enabled Twilio line list.

If you prefer the printed CLI command, first verify that the CLI identity is
already registered as an app admin. A controller or deployment identity is not
automatically equivalent to an existing Internet Identity admin after an
upgrade.

`TWILIO_PHONE_NUMBER` remains supported as a single-line fallback. For multiple outbound lines, set `TWILIO_PHONE_NUMBERS` or add numbers in **Admin Dashboard > Twilio Configuration > Outbound Lines**. Each enabled number is treated as one outbound line; when every line is busy, new paid call reservations wait in FIFO order until a line is released.

In Stripe, create two webhook endpoints:

```text
https://voicecall.richardhery.com/stripe/webhook/test
https://voicecall.richardhery.com/stripe/webhook/live
```

Add these webhook events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
```

Put each endpoint's signing secret into the matching `STRIPE_TEST_WEBHOOK_SECRET` or `STRIPE_LIVE_WEBHOOK_SECRET` value.

### 4. Start a Cloudflare Tunnel

Quick test tunnel:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public URL like:

```text
https://example-random.trycloudflare.com
```

Put that in `src\server\.env`:

```text
HOSTNAME=example-random.trycloudflare.com
```

You can include `https://`; the server accepts both forms.

For a permanent domain, use Cloudflare’s named tunnel flow:

```powershell
cloudflared tunnel login
cloudflared tunnel create voicecall-ai
cloudflared tunnel route dns voicecall-ai voice.yourdomain.com
cloudflared tunnel run voicecall-ai
```

Then set:

```text
HOSTNAME=voice.yourdomain.com
```

### 5. Start the voice server

Use a second PowerShell window:

```powershell
cd C:\path\to\voicecall-ai
pnpm server:start
```

Check health:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected:

```text
ok                : True
ready             : True
publicHost        : your-tunnel-host
cors.requestOriginAllowed: True
twilioConfigured  : True
xaiConfigured     : True
```

If `ready` is false, read `setupIssues`; it lists missing environment variable
names without exposing their values.

From the MacBook, test the public CORS path after the Windows server is restarted:

```bash
curl -i -H "Origin: https://voicecallai.online" https://voicecall.richardhery.com/health
```

The response headers must include:

```text
Access-Control-Allow-Origin: https://voicecallai.online
```

### 6. Update and restart the NSSM service

If the server is already installed as the `VoiceCallAI` Windows service, pull the latest GitHub code and restart it with:

```powershell
cd C:\Projects\voicecall-ai
powershell -ExecutionPolicy Bypass -File .\scripts\update-voicecall-service.ps1
```

The script runs `git pull --ff-only`, installs dependencies, checks `server.js`, restarts NSSM, and verifies both local and public `/health` with the IC frontend `Origin` header.

Manual NSSM restart commands:

```powershell
cd C:\Projects\voicecall-ai
git pull --ff-only origin main
pnpm install --prefer-offline
node --check .\src\server\server.js
C:\Tools\nssm\nssm.exe set VoiceCallAI AppDirectory C:\Projects\voicecall-ai\src\server
C:\Tools\nssm\nssm.exe set VoiceCallAI AppParameters server.js
C:\Tools\nssm\nssm.exe restart VoiceCallAI
C:\Tools\nssm\nssm.exe status VoiceCallAI
```

Then verify:

```powershell
Invoke-WebRequest `
  -Uri https://voicecall.richardhery.com/health `
  -Headers @{ Origin = "https://voicecallai.online" } `
  -UseBasicParsing
```

The JSON should include a non-empty `serverVersion`, `backendCanisterId`,
`icpServerPrincipal`, and `model`.

## Configure the Frontend

For a local voice bridge, run:

```powershell
pnpm configure:frontend:local
```

For an IC-hosted frontend calling your Windows server through Cloudflare, run:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://example-random.trycloudflare.com
```

Replace the example URL with your actual Cloudflare Tunnel URL. This writes
`src\frontend\public\env.json`. Canister IDs and root keys come from the
certified `ic_env` cookie at runtime.

## Local IC Deploy

Install dependencies, start the local network, and deploy both canisters:

```powershell
pnpm install --prefer-offline
pnpm exec mops install
icp network start -d
pnpm deploy:local
```

Verify the deployment:

```powershell
icp canister status -e local
icp canister call -e local backend getBillingPackages '()'
```

The deploy output prints the frontend URL, normally:

```text
http://frontend.local.localhost:8000/
```

On a fresh backend install, the identity that runs `icp deploy` is atomically
registered as the initial admin. Browser users are always registered as normal
users, so there is no first-login race. After signing into the frontend, copy
the User ID from Settings and promote it with the same deployment identity:

```powershell
icp canister call -e local backend assignCallerUserRole '(principal "BROWSER_USER_ID", variant { admin })'
```

An upgrade preserves the existing role assignments and does not replace an
already-assigned admin.

To use a local voice server instead of the configured public bridge, run this
before deploying:

```powershell
pnpm configure:frontend:local
```

This intentionally changes the tracked runtime environment to
`http://localhost:3000`; run `pnpm configure:frontend:ic` again before a
mainnet frontend deploy.

For Vite development, deploy the backend first, then run:

```powershell
pnpm --dir src/frontend dev
```

The Vite configuration queries `icp network status` and injects the same
`ic_env` cookie that the asset canister provides.

## Mainnet IC Deploy

Do not run a mainnet deploy until all preflight checks pass:

```powershell
pnpm install --prefer-offline
pnpm exec mops install
pnpm exec mops check
pnpm bindgen
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend build
pnpm build:ic
```

The Motoko stable compatibility check is especially important for this
upgrade: it verifies that existing roles, Stripe purchase records, phone-time
balances, presets, and call history remain upgradeable while the new agent
state is added.

Select the intended identity and verify both the account and existing canister
cycle balances:

```powershell
icp identities list
icp identity default <your-identity-name>
icp identity principal
icp token balance -n ic
icp cycles balance -n ic
icp canister status -e ic backend
icp canister status -e ic frontend
```

Check that the backend has enough cycles for upgrades and occasional XRC
pricing refreshes. One actual XRC refresh attaches exactly one billion cycles
and the app caches the result for six hours. Failed refreshes have a global
30-minute cooldown to prevent repeated requests from draining cycles:

```powershell
icp canister settings show backend -e ic
```

For a production canister holding balances and payment records, set a 90-day
freezing threshold and add a backup controller before deployment:

```powershell
icp canister settings update backend --freezing-threshold 7776000 -e ic
icp canister settings update backend --add-controller <backup-principal> -e ic
```

This release adds the live-listen URL to the voice-server dispatch
acknowledgement. Stop the voice service just before the canister upgrade so an
MCP job cannot be claimed while the old and new Candid signatures differ.
Queued jobs remain durable:

```powershell
& C:\Tools\nssm\nssm.exe stop VoiceCallAI
```

Deploy both canisters as an upgrade so canister IDs and state are preserved:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://voicecall.richardhery.com
icp deploy -e ic
pnpm exec mops deployed backend
```

Do not use `--mode reinstall`; reinstall clears all application state.

After deployment, pull the same updated revision on the Windows voice host and
run the service updater. It preserves `src/server/.env`, installs dependencies,
checks the server, restarts NSSM, and verifies the health endpoint. The
existing ICP server principal must still have the app's `admin` role because
that role claims and finalizes MCP call jobs:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-voicecall-service.ps1
pnpm server:check-identity
```

Verify the public guide and pricing surface:

```powershell
icp canister call -e ic backend getAgentGuide '()'
icp canister call -e ic backend getAgentPricing '()'
pnpm verify:agent-discovery https://voicecallai.online
```

Then connect an AI client through the official ICP MCP URL, authorize it with
Internet Identity, call `agentInitialize`, and fund only the exact
`depositAccount` returned by `agentGetAccountIdentity`. Refresh pricing once,
purchase the smallest package in a low-value test, create a harmless test
preset, and queue a test call to a phone number you control.

Use `-n ic` for token and cycle commands. Without `-n ic`, `icp cycles balance` can show your local network balance, which is why the first balance in your transcript looked much larger than the balance available for mainnet canister creation.

Configure the public voice bridge. The frontend build generates a matching
`dist/.ic-assets.json5` policy automatically:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://voicecall.richardhery.com
pnpm --dir src/frontend build
```

For the existing canisters, keep
`.icp/data/mappings/ic.ids.json` in place and upgrade normally:

```powershell
pnpm deploy:ic
```

For a brand-new mainnet deployment, sign into the deployed frontend once, copy
the User ID from Settings, then use the identity that performed the deployment:

```powershell
icp canister call -e ic backend assignCallerUserRole '(principal "BROWSER_USER_ID", variant { admin })'
```

After that browser admin signs in again, it can authorize the Node server from
**Admin Dashboard > Payment Server**. Existing installations keep their current
admin during an upgrade.

Never use a reinstall mode on the backend; that would erase canister state. If
only one canister changed, deploy only that canister to avoid unnecessary
uploads and cycle use:

```powershell
pnpm deploy:ic:backend
pnpm deploy:ic:frontend
```

After a successful backend deployment, promote the just-deployed stable type
signature so future upgrades are checked against it:

```powershell
pnpm exec mops deployed backend --dir src/backend/deployed
```

Review and commit the updated snapshot. The project deliberately leaves
compute allocation and memory allocation at `0`, uses the default 30-day
freezing threshold only for local development, minifies frontend assets, and
lets the asset sync upload only changed files. Keep the production backend at
the 90-day freezing threshold configured above. The zero compute and memory
allocations avoid reserved-resource cycle burn.
The backend also caps per-user preset counts, retains at most 200 finalized
call-history records per user, bounds query responses and system logs, reuses a
user's pending purchase intent, and validates cheap inputs before requesting
randomness. Real-time xAI/Twilio traffic stays on the Node bridge, so it does
not consume HTTPS-outcall cycles.

Open the existing deployment at:

```text
https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
```

If Chrome shows a certificate warning on `*.icp-api.io`, you are on the wrong host for the frontend. Switch the address to `*.icp0.io` or `*.ic0.app`.

## Custom Domain

The frontend canister is prepared for:

```text
https://voicecallai.online
https://www.voicecallai.online
```

The deployed frontend canister ID is:

```text
2nukr-cyaaa-aaaak-qy2ja-cai
```

The IC custom-domain verifier needs these files in the asset canister:

```text
src/frontend/public/.well-known/ic-domains
src/frontend/public/.well-known/ii-alternative-origins
```

`ic-domains` proves the canister is willing to serve the custom domains. `ii-alternative-origins` lets Internet Identity keep using the existing `https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io` principal derivation origin when users sign in from the custom domain.

Before registering the domain, rebuild and redeploy the frontend:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://voicecall.richardhery.com
pnpm deploy:ic:frontend
```

Then confirm the deployed files are visible:

```powershell
curl -sL https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io/.well-known/ic-domains
curl -sL https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io/.well-known/ii-alternative-origins
```

In Namecheap Advanced DNS, remove the parking and redirect records, then add IC records for both the apex and `www` host:

```text
ALIAS  @                    voicecallai.online.icp1.io
CNAME  _acme-challenge      _acme-challenge.voicecallai.online.icp2.io
TXT    _canister-id         2nukr-cyaaa-aaaak-qy2ja-cai

ALIAS  www                  www.voicecallai.online.icp1.io
CNAME  _acme-challenge.www  _acme-challenge.www.voicecallai.online.icp2.io
TXT    _canister-id.www     2nukr-cyaaa-aaaak-qy2ja-cai
```

After DNS propagates, validate and register each host:

```powershell
curl -sL -X GET https://icp0.io/custom-domains/v1/voicecallai.online/validate
curl -sL -X POST https://icp0.io/custom-domains/v1/voicecallai.online
curl -sL -X GET https://icp0.io/custom-domains/v1/www.voicecallai.online/validate
curl -sL -X POST https://icp0.io/custom-domains/v1/www.voicecallai.online
```

Poll until each returns `registration_status` as `registered`:

```powershell
curl -sL -X GET https://icp0.io/custom-domains/v1/voicecallai.online
curl -sL -X GET https://icp0.io/custom-domains/v1/www.voicecallai.online
```

Update the Windows voice server `.env` so browser calls and Stripe returns use the custom domain, then restart the service:

```text
FRONTEND_ORIGIN=https://voicecallai.online,https://www.voicecallai.online,https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_URL=https://voicecallai.online
FRONTEND_CANISTER_ID=2nukr-cyaaa-aaaak-qy2ja-cai
```

## Test an End-To-End Call

1. Keep the Windows voice server running.
2. Keep the Cloudflare tunnel running.
3. Open the IC frontend.
4. Sign in with Internet Identity.
5. Create a preset.
6. Buy phone time from the dashboard.
7. Enter a recipient phone number in E.164 format, for example `+17753794797`.
8. Start the call.

The frontend reserves paid seconds in the IC backend, then calls:

```text
POST <voice_server_url>/initiate-call
```

The server verifies the paid reservation and calls Twilio. Twilio then calls:

```text
POST https://<HOSTNAME>/twiml
WSS  wss://<HOSTNAME>/media
```

The `/media` WebSocket bridges Twilio audio to xAI and sends xAI audio back to Twilio as `audio/pcmu` at 8 kHz.

## Twilio Notes

- Do not use the old `https://<accountSid>.icp0.io/twilio-webhook` URL.
- For outbound calls made by the app, you do not need to manually set a Twilio console webhook; the server passes the TwiML URL in `calls.create`.
- Add every outbound caller ID you want to use to the same Twilio account, then add it to the app as an enabled outbound line.
- On a Twilio trial account, destination numbers usually must be verified.
- If you turn on `VALIDATE_TWILIO_SIGNATURE=true`, test after your public tunnel URL is stable.

## CSP Notes

The frontend build generates the IC asset canister's strict Content Security
Policy at:

```text
src/frontend/dist/.ic-assets.json5
```

The policy is derived from `src/frontend/public/env.json`, includes the voice
server in `connect-src` and `media-src`, disables raw asset access, and enables
SPA aliases. Re-run the frontend build after changing `voice_server_url`; do
not hand-edit the generated file.

## CORS Notes

The Windows Node server also enforces CORS. If the browser console says `No 'Access-Control-Allow-Origin' header`, check `src/server/.env` on the Windows PC:

```text
FRONTEND_ORIGIN=https://voicecallai.online,https://www.voicecallai.online,https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_CANISTER_ID=2nukr-cyaaa-aaaak-qy2ja-cai
```

Restart the server after changing `.env` or pulling new server code. Check `/health` with the frontend `Origin` header; the response should include `cors.requestOriginAllowed: true` and the HTTP headers should include `Access-Control-Allow-Origin`.

## Useful Commands

Frontend:

```powershell
pnpm bindgen
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend build
```

Backend:

```powershell
pnpm exec mops build
pnpm exec mops check
```

Server:

```powershell
pnpm --dir src/server start
```

All packages:

```powershell
pnpm build
pnpm build:ic
```
