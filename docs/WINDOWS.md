# Update the Windows voice service and Genesis worker

The IC deployment updates canister code and website assets. The Windows PC still
needs the bridge update below before calls use the new instructions and diagnostics.
The call-preview API does not remove harassment safeguards or waive required notice
and participant permissions. It reports app prerequisites without dialing.

## Existing installation

Use an elevated PowerShell with Git, pnpm, Node.js 24 LTS and NSSM installed.
Genesis imports TypeScript helpers directly, so an older Node without type stripping
cannot run its worker. Substitute your actual directories if they differ.

```powershell
node --version
pnpm --version
git --version
Get-Service VoiceCallAI, GenesisWorker
& C:\Tools\nssm\nssm.exe get VoiceCallAI AppDirectory
& C:\Tools\nssm\nssm.exe get GenesisWorker AppDirectory
```

Preserve `C:\Projects\voicecall-ai\src\server\.env`, the voice service's existing
`ICP_SERVER_IDENTITY_JSON`, recording-link signing secrets, Twilio/xAI/Stripe secrets,
and stored `src\server\data` recordings. Preserve Genesis's existing
`C:\ProgramData\Genesis\secrets\worker.key.json`. Do not replace working identities
or copy a controller key onto the Windows host. Keep secret files out of Git and logs.

## Pull and restart VoiceCallAI

The updater fast-forwards main, installs dependencies, checks syntax and runs bridge
tests before restarting. It also allows the exact Genesis frontend origin in CORS
without changing other protected environment values.

```powershell
Set-Location C:\Projects\voicecall-ai
git status --short
git pull --ff-only origin main
& .\scripts\update-voicecall-service.ps1 `
  -ProjectRoot C:\Projects\voicecall-ai `
  -ServiceName VoiceCallAI `
  -NssmPath C:\Tools\nssm\nssm.exe
```

Resolve local Git conflicts before running the updater; do not reset or delete secrets
to force an update. The existing public HTTPS tunnel/reverse proxy must keep forwarding
to port 3000, including WebSocket upgrades for `/media`. `HOSTNAME` must match that
public host; changing it breaks Twilio signature validation and callback URLs.

Verify both local and public bridge readiness and this release's behavior version:

```powershell
$local = Invoke-RestMethod http://127.0.0.1:3000/health
$public = Invoke-RestMethod https://voicecall.richardhery.com/health
$local | Select-Object ready, callRequestVersion, serverVersion, model, backendCanisterId, callQueue, destinationPricing
$public | Select-Object ready, callRequestVersion, serverVersion, model, backendCanisterId, callQueue, destinationPricing
if (-not $public.ready -or $public.serverVersion -ne '2026-10-21-call-audio-reliability') {
  throw 'The current bridge release is not ready; inspect setupIssues and service logs.'
}
$cors = Invoke-WebRequest https://voicecall.richardhery.com/health `
  -Headers @{ Origin = 'https://o5wsa-gaaaa-aaaaa-qhq3a-cai.icp0.io' } -UseBasicParsing
$cors.Headers['Access-Control-Allow-Origin']
Get-Service VoiceCallAI
```

The CORS header must equal the requested Genesis origin. `ready=true` verifies configured
prerequisites, not a completed Twilio/xAI call. The production backend must remain
`2dwhz-ziaaa-aaaak-qy2ia-cai`. If the version is absent, NSSM points to an old checkout
or the bridge was not restarted. Read `logs\voicecall-err.log` locally for diagnostics;
do not publish secrets, phone numbers or bearer recording/listening URLs.

This release defaults to one ordinary concurrent call across browser, bulk/MCP, and
inbound answering traffic. One extra signed incoming companion is allowed when
a live outbound call reaches the same account’s verified answering preset. Both
legs reserve and bill phone time separately; other work still waits for capacity. Existing environment files need no new values to receive these
defaults. `CALL_MAX_CONCURRENT`, `CALL_QUEUE_MAX_PENDING` (100) and
`CALL_QUEUE_MAX_PER_USER` (20) tune the bridge's bounded queues. Leave concurrency
at one on a small host. `MAX_OUTBOUND_RATE_USD_PER_MINUTE` defaults to `0.03`;
Twilio Voice Pricing access is required before dialing. The bridge refuses an
unverified or excessive carrier rate and releases the call reservation. See
[call economics](CALL-ECONOMICS.md) before increasing the rate ceiling.

Upgrade the IC backend before restarting this bridge, because lazy bulk dispatch
uses new canister methods. Existing single-call API methods remain available to
the older bridge during the transition. New bulk lists remain waiting until this
bridge release is running. Verify `callQueue.lazyBulkDispatch=true` in public
health before submitting production bulk work. The updater checks readiness,
release version and production backend mapping after restarting.

## Verify audio reliability

Public health must report `serverVersion=2026-10-21-call-audio-reliability`,
`callLifecycle.version=3` and `callDelivery.playbackConfirmedTranscripts=true`.
The IC upgrade must precede the bridge restart because new finalization includes
bounded delivery counters in the same update. A `ready` bridge still does not
prove a successful telephone conversation.

To verify with a number you control, enable the answering preset, use an owned
outbound preset and start one call with the desired capture settings. Press
**Start listening** in the private live page; wait for its audio-received status.
Afterward inspect History or `agentGetCallArtifacts`: phone connection, sent audio,
playback acknowledgements and actual recording/transcript content are separate
pieces of evidence. A self-call uses two billable legs. No live call is started by
the updater. Do not repeatedly dial a public service to diagnose a silent player.

See [call audio and result semantics](CALL-RELIABILITY.md).

## Pull Genesis and update its installed worker copy

```powershell
Set-Location C:\Projects\agentsitehub
git status --short
git pull --ff-only origin main
pnpm install --prefer-offline
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend build
pnpm test:work
& .\scripts\deploy-worker-xai.ps1 `
  -ProjectRoot C:\Projects\agentsitehub `
  -ServiceRoot C:\Services\agentsitehub `
  -VoiceEnvFile C:\Projects\voicecall-ai\src\server\.env `
  -WorkerKeyFile C:\ProgramData\Genesis\secrets\worker.key.json `
  -XaiKeyFile C:\ProgramData\Genesis\secrets\xai.key.json `
  -NssmPath C:\Tools\nssm\nssm.exe
Get-Service GenesisWorker, VoiceCallAI
```

The installer expects the existing GenesisWorker service to run as LocalService and
preserves its authorized worker identity. It verifies on-chain readiness and copies
the updated VoiceCallAI adapter into `C:\Services\agentsitehub` before restarting.
Pulling the source checkout alone does not update that installed service copy.
Follow Genesis's [full Windows guide](https://github.com/dickhery/agentsitehub/blob/main/docs/WINDOWS.md)
for its worker prerequisites, logs and protected credential setup.

## Fresh voice-service installation

For an empty host, install Git, Node 24 LTS, pnpm and NSSM, then:

```powershell
git clone https://github.com/dickhery/voicecallai.git C:\Projects\voicecall-ai
Set-Location C:\Projects\voicecall-ai
pnpm install --prefer-offline
Copy-Item src\server\.env.example src\server\.env
notepad src\server\.env
```

Configure `PORT=3000`, `HOSTNAME=voicecall.richardhery.com`, the explicit frontend
origin allowlist, `BACKEND_HOST=https://icp-api.io`, the backend ID above, Twilio account
credentials and an enabled owned phone number, `XAI_API_KEY`, and the dedicated recording
HMAC secrets. Keep `VALIDATE_TWILIO_SIGNATURE=true` in production. Configure Stripe test/live
keys and webhook secrets if card purchases are needed. Stripe webhooks use the bridge's
`/stripe/webhook/test` and `/stripe/webhook/live` endpoints. Never print
the environment file or its secret values.

Reuse an authorized voice-server identity if this replaces a host. For a genuinely new
service identity only, run the existing identity-creation script locally and place its
JSON in `ICP_SERVER_IDENTITY_JSON`; use the website's current admin to authorize the
printed principal for server access, then verify the configured identity. Do not grant
canister controller access to the bridge.

```powershell
node src\server\scripts\create-ic-server-identity.mjs
pnpm server:check-identity
node src\server\scripts\allow-genesis-origin.mjs src\server\.env
& .\scripts\install-voicecall-service.ps1 `
  -ProjectRoot C:\Projects\voicecall-ai `
  -NssmPath C:\Tools\nssm\nssm.exe `
  -NodePath 'C:\Program Files\nodejs\node.exe'
```

Keep the existing HTTPS proxy/tunnel running as a service. If this is a new machine,
configure public DNS/TLS for the same bridge host and forward HTTP/WebSockets to the
local port; keep any tunnel credentials private. Run the health/CORS checks above.
Outbound Twilio callbacks are generated by the bridge. Inbound answering additionally
requires the preset-specific Twilio Voice POST webhook and a verification call.

## Verify agent access without a real call

In an MCP-capable assistant, connect `https://mcp.internetcomputer.org/mcp` with
Internet Identity and Actions and questions. Open `https://voicecallai.online`, read
`getApiDoc`, initialize the account, and inspect existing phone time and presets.
Use `agentPreviewCall` with an owned preset, a valid intended number, selected capture
settings and one unique key. Preview should return an exact prerequisite error or
an `ok` note saying no reservation or call was made. There is no need to pay, refresh
XRC, or dial simply to check discovery. Actual calls still need available time and terms.

Use a number you control for the first live smoke test. In Genesis, accept a prepared
phone script, review the full price and capture settings, and approve its one-use grant.
Verify queued → dispatched → completed, the private live link, requested artifacts,
and phone-time reconciliation. An assistant's refusal before a tool call is independent
of the app. `SAFETY_BLOCKED` is a bridge instruction check; `CAPTURE_AUTHORIZATION_REQUIRED`
concerns customer-selected storage authorization; `BRIDGE_CALL_FAILED` needs provider or
bridge diagnostics. Do not retry by weakening safety constraints or rewriting a blocked
destination. No live call is placed automatically by this deployment.
