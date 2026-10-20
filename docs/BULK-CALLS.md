# Bulk calling from the dashboard or ICP MCP

Use one saved agent preset for a list of intended recipients. The dashboard's
bulk card accepts pasted text or a CSV/text file and validates it locally before
anything is submitted. Use a phone-number column, keep the `+` and country code,
review invalid rows and duplicates, and review the recipients before enqueueing.
The upload file stays in the browser; only validated numbers and call settings
are stored in the canister. Limits are enforced again by the backend.

Each batch contains 1–100 distinct exact E.164 numbers, a preset, capture choices
and a 1–10 minute per-call limit in whole minutes. There can be at most 200
undialed targets per account, 2,000 globally and normally 10 retained batches per
account. Limits apply equally to web and connector submissions. Linking accounts
preserves their existing authorized lists, which can temporarily exceed an
account quota; new submissions wait until that work clears.

## Through ChatGPT's Internet Computer connector

Open `https://voicecallai.online` with the official ICP MCP connector and the
same Internet Identity account as the web app. Read `getApiDoc`/`getAgentGuide`
and initialize as usual. An assistant with access to your CSV/text attachment can
extract its phone column and submit a Candid text array. The ICP connector itself
does not upload files or retrieve arbitrary attachment URLs. If the assistant
cannot read the attachment, paste the phone column or use the web upload.

The request for both `agentPreviewCallBatch` (query) and `agentQueueCallBatch`
(update) is:

```candid
(record {
  recipientPhones = vec { "+12125550123"; "+14155550124" };
  presetId = 1 : nat;
  captureOptions = record {
    saveTranscript = false; recordAudio = false; consentConfirmed = false
  };
  maxCallSeconds = 300 : nat;
  idempotencyKey = "one-unique-key-for-this-intended-list"
})
```

The examples use fictional numbers. Replace them with your authorized recipients.
Preview checks list validity, terms, preset ownership, limits and phone time
without writing state, reserving funds, or dialing. After reviewing all numbers,
the shared instructions, capture choices and maximum time, explicitly enqueue.
A batch of 100 calls at five minutes each may consume up to 500 prepaid minutes.
Menus, hold time and voicemail count toward each call's cap. Reuse the same
idempotency key **and identical arguments** if a submission response is uncertain.
Recovery is available while that batch remains in the account's retained
batches (up to 10). Terminal history can be pruned when new work is submitted
or the global history limit is reached; after pruning,
an old key is not a permanent deduplication record. Inspect call history before
resubmitting old work. Do not split a list into repeated calls to bypass limits.

Use `agentListCallBatches()` to see private target lists, remaining and attempted
counts, the latest prerequisite error and ordinary call jobs. Query at 10–30
second intervals while waiting. A `completed` batch means all targets have been
handed off; inspect the jobs and call history for actual success/failure and
capture artifacts. A provider rejection is an attempt, not a successful call.

`agentCancelCallBatch(batchId)` cancels undialed targets. An already claimed or
live target continues; use `agentEndCall(jobId)` to request its hang-up. Inspect
individual job state after cancellation rather than assuming it ended a live call.

## Funding and queue fairness

Uploading a batch does not hold time for every number. The bridge claims one
target when it has capacity, and that claim reserves its full selected per-call
limit. A batch waits for more prepaid phone time if the full limit is unavailable.
Buying time remains a separate explicit action. Unused reserved time is released
through the existing call reconciliation. Batch calls cannot extend beyond their
chosen cap.

The canister rotates between account principals after each claim and keeps one
batch target in flight per account. The bridge's queues are bounded and its
default concurrency is one across outbound and inbound calls. Lists do not
occupy all the server's slots or pre-create hundreds of Twilio calls. Undialed
targets expire after 24 hours and are not automatically retried; submit fresh
authorized work when appropriate. Pending counts and owner rotation are maintained
in canister state without background timers or IC HTTPS outcalls.

Carrier rates are checked on the Node bridge just before dialing. Expensive
destinations and unavailable price quotes are refused even when a number has
valid syntax. See [call economics](CALL-ECONOMICS.md). E.164 validation cannot
prove that a number is assigned, reachable or appropriate to contact.

## Phone menus and voicemail

The existing Grok realtime connection hears menus and can invoke the restricted
keypad tool. The bridge sends Twilio `Play digits` signaling, reconnects the audio
stream, and can fall back to in-band tones after a definite signaling rejection.
An uncertain provider response is not replayed, because the first selection may
already have reached the menu. Tool limits
bound repetitions and total digits. Put the actual goal, desired department and
extension in the preset; the agent should select only an announced relevant
option and wait for the system to respond.

Voicemail uses heard greeting/recording cues, a local beep detector and playback
marks. It waits for a recording cue, leaves one concise permitted message and
ends after playback. Include a real callback number and permitted facts, or
instruct the agent to leave no voicemail. Full mailboxes and persistent silence
end within bounded time. Recognition is best effort: unusual prompts, music,
speech overlap and poor telephone audio can prevent a successful menu selection
or message. No extra transcription service, paid AMD request or on-chain audio
processing is added.

## Release order

Run `pnpm test`, `pnpm exec mops check`, `pnpm exec mops build`, `pnpm bindgen`,
`pnpm --dir src/frontend typecheck`, `pnpm --dir src/frontend build` and
`pnpm verify:agent-discovery` from the project root before releasing.

Deploy the IC backend and frontend, then update and restart the separate Windows
voice bridge using [the Windows instructions](WINDOWS.md). The public bridge
health must report `serverVersion=2026-10-20-bulk-fair-queue` and
`callQueue.lazyBulkDispatch=true`. An old bridge can continue serving existing
single-call APIs, but it cannot dispatch these lazy bulk lists. No live test call
is automatically placed by deployment.
