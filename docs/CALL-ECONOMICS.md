# Call costs and prepaid margins

The existing packages remain $5/30 minutes, $10/60 minutes and $20/120 minutes.
All three earn about $0.1667 per used minute before expenses. Unused prepaid time
is a service liability, not free profit. Existing balances and purchase intents
keep their original value.

## Verified price assumptions (2026-10-20)

Provider invoices and negotiated account rates are authoritative. Public prices:

- [xAI voice pricing](https://docs.x.ai/developers/models): speech-to-speech
  $0.08/minute. The bridge uses the pinned Think Fast 2.0 model and its existing
  realtime audio connection; it does not open a second transcription stream.
- [Twilio US voice pricing](https://www.twilio.com/en-us/voice/pricing/us):
  standard US/Canada outbound $0.014/minute, Media Streams $0.0044/minute,
  recording $0.0025/minute and storage $0.0005/minute/month. Alaska alone is
  listed at $0.0945/minute, which demonstrates why a `+1` country allowlist
  cannot protect a flat-rate service. Other routes and origin surcharges vary.
- [Stripe US standard domestic cards](https://stripe.com/pricing): 2.9% + $0.30
  per successful transaction. International cards and currency conversion can
  cost more. ICP purchases have ledger costs and avoid this card fee.

Illustrative contribution if all minutes are used, including optional recording
and one month of storage, before server, cycles, tax, refunds, chargebacks,
support, phone-number rental and other fixed costs:

| Package | Standard $0.014 carrier route | At the $0.03 carrier ceiling |
| --- | ---: | ---: |
| $5 / 30 min | $1.51 (30.3%) | $1.03 (20.7%) |
| $10 / 60 min | $3.33 (33.3%) | $2.37 (23.7%) |
| $20 / 120 min | $6.95 (34.8%) | $5.03 (25.1%) |

These are estimates, not a guarantee of net profitability. The calculation is
`price - (price * .029 + .30) - minutes * (.08 + carrier + .0044 + .0025 + .0005)`.
Minute rounding, long hold time, provider changes and recording retention affect
actual results. Optional web/X/file search tools can add provider charges.
xAI also lists charges for text messages added with
`conversation.item.create` (function-call outputs are excluded); lifecycle
nudges can therefore add small per-call costs beyond this audio-only estimate.
See [xAI speech-to-speech pricing](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech).
Reconcile Twilio and xAI invoices against billed call duration
before increasing included minutes or lowering prices.

## Enforced carrier budget

Before **every outbound dial**, the bridge checks Twilio's
[Voice Numbers Pricing API](https://www.twilio.com/docs/voice/pricing) using the
exact destination and originating number. `MAX_OUTBOUND_RATE_USD_PER_MINUTE`
defaults to `0.03`. Quotes above the ceiling fail with
`DESTINATION_RATE_EXCEEDED`. Missing, malformed, timed-out or non-USD quotes fail
with `DESTINATION_PRICE_UNAVAILABLE`; the bridge does not guess or dial anyway.
The highest returned current rate is used when several rates are supplied.

Quotes are cached for at most six hours for each origin/destination pair with
at most 1,000 entries and eight concurrent lookups. A failed lookup has a short
30-second negative cache. These HTTPS requests stay on the Node server and cost
no IC HTTPS-outcall cycles. A number being valid E.164 does not establish that
it is reachable or affordable; the carrier check happens just before dialing.

Do not raise the ceiling without revisiting the full cost calculation. This
guard covers outbound carrier rates; it cannot cap inbound toll-free charges,
taxes, recording storage growth, refunds or provider price changes during a
cached quote. Configure Twilio geographic permissions and usage alerts in the
operator account as additional operational controls.

## Small-server and cycle budget

Bulk work is stored as bounded target lists and turned into one ordinary paid
call job when capacity is available. No audio or raw uploaded CSV is sent to the
canister. Each call has a prepaid time limit, and queue status uses queries with
backoff. Keypad tones, voicemail detection and playback completion run on the
existing bridge sockets, without canister polling or model-side web searches.
The six-hour XRC price cache and current zero compute/memory allocations remain.
The existing production deployment helper refuses upgrades that would violate
its freezing reserve and protected cycle buffer.
