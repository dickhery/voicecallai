# Call audio, answering tests and honest results

## Problems reproduced from the reported behavior

The bridge's normal concurrency limit was one across outbound and inbound calls.
An outbound call to the account's own AI answering number occupied that slot
before its inbound webhook arrived. The answering leg was rejected as unavailable.
This is a reproducible code path matching the first report; the historical private
call records were not accessible to the CLI deployment identity, so no exact
historical provider event sequence was assumed.

A second code path muted outbound replies after a long remote introduction.
Duration alone changed an unknown line into an automated-menu state, including
interactive AI assistants. Model transcript deltas were saved even when the
corresponding audio was suppressed. A saved transcript could therefore describe
speech absent from both the telephone line and its recording.

Browser listeners also needed clearer startup/error state. An open socket was
presented as live audio before any frames arrived, and interrupted assistant
audio could remain queued in browser playback. The answering player serialized
caller and assistant chunks on one clock rather than mixing overlapping tracks.

## Behavior in this release

- A signed, matching incoming call to the same account's verified answering preset
  may use one extra companion slot. There is at most one companion globally, with
  a live outbound parent, exact caller/destination correlation, a distinct Twilio
  CallSid and a second ownership check after asynchronous reservation. This
  exception always requires a valid Twilio signature, even in development mode.
  Unrelated callers retain the ordinary capacity limit. Each leg reserves and
  bills its own phone time; this is a two-stream, two-leg test.
- Answering presets created before identity linking use the linked account's
  prepaid balance. The canister rechecks the active preset, route and payer after
  requesting randomness, before creating call history or reserving minutes.
- A long greeting does not permanently classify a human or interactive AI as a
  keypad menu. After an unknown greeting pauses, normal voice activity detection
  can generate the response. Explicit menu/hold and voicemail states still gate
  speech. The agent can report `conversational_agent` for a spoken AI service.
- Assistant text is committed only for a complete, wholly forwarded response after
  its Twilio playback mark returns. Cleared, canceled, suppressed and unconfirmed
  responses are omitted. Recipient transcription still requires selected capture.
  Temporary response text used for call control is not saved when capture is off.
- Live audio requires a user click. Players show connecting, waiting, receiving,
  blocked/error and retry states. They use separate playback clocks, stop cleared
  assistant buffers on interruption, limit backlog and clean up contexts/sockets.
  The standalone listen-only page bounds slow clients' WebSocket send buffers.
- A CallSid means dispatched, not answered. Provider terminal failures survive
  local finalization and out-of-order callbacks. The final result remains visible
  until dismissed. A bounded off-chain terminal cache retains authorized results
  for two minutes after the full session and its audio buffers have been freed.

## Delivery diagnostics

New bridges call `finishCallAndDebitWithDiagnosticsForServer` in place of the old
finish update. Billing, existing call-history updates and compact counters are
written in that one update; there is no extra diagnostic update or polling timer.
Old finish APIs remain compatible. Repeated old finalizations preserve an already
known diagnostic failure status and do not debit phone time twice.

`agentGetCallArtifacts(callId)` includes optional `diagnostics`.
`getCallDiagnostics(callId)` reads the same owner-only data without fetching media.
History queries it only when a finished call is expanded. The canister retains
at most 2,000 recent call IDs globally, with bounded strings/counters, no phone
numbers, prompts, audio or bearer URLs in that map. Old/pruned records or a bridge
restart before finalization can leave diagnostics unavailable.

| Outcome | Evidence and limits |
| --- | --- |
| `notConnected` | No media connection was recorded. |
| `noAssistantAudio` | No assistant audio was forwarded; generated/suppressed text is not delivery. |
| `playbackUnconfirmed` | Audio was forwarded but no complete assistant turn was acknowledged. |
| `audioExchanged` | Both audio directions and at least one complete playback acknowledgement; no proof of comprehension or task success. |
| `unknown` | Insufficient evidence to classify delivery. |

Transport completion, playback acknowledgement, an audible recording and the
user's requested result are separate facts. An audio URL alone proves none of
the conversation content. A WebSocket connection alone does not prove audible
browser playback. Silence bytes can count as audio frames; counters are not a
speech-understanding metric. Interrupted turns may still be audible in a recording
while absent from the conservative transcript. Historical generated transcripts
cannot be retroactively converted into proof of delivered speech.

## Verification and deployment

Run `pnpm test`, `pnpm exec mops check --fix`, `pnpm exec mops build`,
`pnpm bindgen`, frontend typecheck/build, Candid compatibility and discovery checks.
The regression suite replays the production media handlers and dispatch functions
with fake provider sockets; no real telephone call or provider payment is needed.
It covers long AI greetings, playback acknowledgement ordering, clear/cancel,
keypad stream handoff, companion admission/security, counters and bounded retention,
browser startup/reconnect and terminal status ordering.

The existing Motoko 1.9/core 2.3 toolchain is preserved. New stable data is isolated
in a separate field under this project's plain enhanced persistence; no legacy
field is retyped and stable compatibility is checked against the deployed baseline.
The newer migration-chain requirements in the live skills target a newer toolchain;
this release does not combine a toolchain migration with the audio fixes.

Deploy the IC backend and frontend before restarting the Windows bridge. See
[WINDOWS.md](WINDOWS.md). Public bridge health must report
`2026-10-21-call-audio-reliability`, lifecycle version 3 and confirmed-playback
transcripts. IC deployment cannot restart the Windows host. The pinned Grok model,
prepaid packages, carrier-price ceiling, queue fairness, XRC cache and cycle buffers
remain in place. Phone-menu navigation and voicemail recognition are best effort;
an external service can still refuse or end a conversation.

Primary references:

- [xAI speech-to-speech and voice activity detection](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech)
- [Twilio media, marks and clear events](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
- [Official ICP skill workflow](https://skills.internetcomputer.org/llms.txt)
