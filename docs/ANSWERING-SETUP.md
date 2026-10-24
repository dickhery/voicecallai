# Set up an AI answering service

VoiceCall AI can answer an inbound call, speak using the facts and instructions
you provide, and ask for a caller's name, callback number and request. You can
configure it in the **AI Answering** page or ask an authorized assistant to do the
app setup through ChatGPT's **Internet Computer Protocol plugin** or the official
**ICP MCP connector**. Public instructions are at
[voicecallai.online/guide.html#answering](https://voicecallai.online/guide.html#answering).

An assistant with no connected tools can explain the steps. An authenticated
assistant with permission to perform actions can create or edit app presets,
check their setup status and turn a verified line on or off. ICP MCP does not buy
a phone number, change Twilio settings or configure your phone carrier.

## What to prepare

- A voice-capable number provisioned in the voice-bridge operator's configured
  Twilio account, in E.164 format with its country code. Arrange access or operator
  help for its Voice webhook settings. Ask the operator to arrange or confirm a
  supported line before buying a number; an unrelated Twilio account is not
  automatically supported. See the account compatibility note below.
- The service's role, a greeting, business hours and facts it may share, questions
  to ask, and a fallback when it does not know an answer. Do not invent facts to
  fill an empty template.
- Your choices for transcript saving and audio recording. Choose both off if
  you do not want saved capture. Select transcript saving or recording if you
  need to review collected callback details later, with the required permissions.
- Prepaid phone time on the same VoiceCall AI account. Incoming and outbound
  calls spend the same balance. Stripe-funded time also works through an
  assistant when the accounts match; an extra ICP deposit is unnecessary.

Good starting services include a front desk that explains opening hours and
directions, an after-hours receptionist that asks for a callback request, and
support or appointment intake that gathers details for a person to review.
The app has no built-in calendar booking, live call transfer, SMS or email
notification integration. An appointment request is not a confirmed booking.
Writing those abilities into the prompt does not install an integration.

## Four steps in the app

1. Open **AI Answering**, choose a template or enter a short preset name,
   your operator-supported Twilio number and the instructions. Choose capture
   settings and save. Guided setup starts with the line off.
2. Copy the preset's private webhook URL. You or the operator open that phone
   number's Voice configuration in Twilio Console and set **A call comes in →
   Webhook**, paste the exact URL, choose **HTTP POST** and save. Keep the URL
   private: its path contains a routing secret. The app does not accept your
   Twilio Auth Token.
3. Call the Twilio number from another phone. The voice bridge verifies a signed
   incoming webhook for that number and preset. Refresh the setup status and
   look for **Verified**. While the line is off, the first verification call may
   play an unavailable message; verification and a working AI conversation are
   separate checks.
4. Turn the verified line on, then call again. Check the greeting, information,
   callback questions and fallback. Use **Live Incoming Calls** to listen while
   connected and **History** to review selected saved capture. The browser's
   audio control requires a click. A completed call or a transcript is not proof
   that a booking or any other business task succeeded.

Before replacing an existing Twilio route, record how to restore it. Turning a
preset off rejects new calls; it does not restore that route. After the direct
Twilio test works, optionally set forwarding from your existing business number
through its carrier. Carrier schedules, forwarding and charges are separate from
the app. Turning the preset off does not undo forwarding.

## Ask your assistant

If the Internet Computer Protocol plugin is available in ChatGPT, attach it to
the chat. Alternatively, add `https://mcp.internetcomputer.org/mcp` in a compatible
assistant's MCP settings. Follow the current
[official connector setup](https://internetcomputer.org/icp-mcp/), authenticate
with Internet Identity, enable AI access where prompted and authorize
`https://voicecallai.online`. Editing presets or enabling a line requires
**Actions and questions** permission. Availability and setup controls depend on
the assistant and account.

Copy and complete this request:

> Read https://voicecallai.online/llms.txt and use the Internet Computer Protocol
> plugin or ICP MCP to set up my answering service. Reuse my existing preset if
> appropriate. My operator-supported Twilio number is [number with country code].
> The service should [purpose, greeting, hours, facts and callback questions].
> Save transcripts: [yes/no]. Record audio: [yes/no]. Check my account and phone
> time, create the preset turned off, and give me the private Twilio webhook and
> the next step. Ask before purchases or accepting terms. After I verify the
> number, check its status and enable it when I ask.

If you already use the browser app, compare account identifiers in **Settings**
before paying again. If presets or balances differ, use its account-linking
controls. Do not infer that accounts match solely because the same assistant or
Internet Identity was used.

## Agent API workflow

Read the app's public discovery instructions and backend Candid interface. Cache
`getAgentGuide` for the current task; the frontend asset canister does not perform
telephony. Ask for only the missing number, purpose, facts and capture choices.

1. Authenticate and call `agentInitialize` once. Query
   `listMyAnsweringPresets` before creating anything, so a retry or resumed setup
   can continue the existing preset. Only one preset may await verification per
   account; at most ten answering presets can be stored.
2. Query `agentGetTermsStatus` when current acceptance is not known. If required,
   show the returned terms and wait for the user's agreement before
   `agentAcceptTerms`. Creating a preset or enabling a line requires current
   terms. Do not accept on the user's behalf without that agreement.
3. Prefer `createAnsweringPresetSimple`. It accepts `name`, `phoneNumber`,
   `systemPrompt`, optional `voice`, `captureOptions` and `webhookSecret`.
   Generate a fresh random secret locally: 32–160 characters using only letters,
   digits, hyphens and underscores. Do not use a phone number or predictable
   name as the secret. This method chooses Eve when voice is omitted, uses safe
   phone audio and voice-activity defaults, disables optional search/function
   tools, and creates the line off. Advanced clients can still use
   `createAnsweringPreset` with the full settings record.
4. Query `getAnsweringSetupStatus(id)`. Its owner-only result includes the exact
   `webhookUrl`, `webhookMethod`, verification and enabled state, shared available
   phone seconds, terms state, `nextSteps` and `note`. Show the URL privately and
   explain the Twilio POST setting. Do not invent a webhook hostname or expose
   it publicly. If the result is absent, do not infer readiness.
5. The user or operator configures the supported Twilio line, then the user
   makes a verification call. A separately authorized Twilio tool may perform its
   own supported configuration action;
   ICP MCP alone cannot. Query setup status again after the user completes the
   step, or use modest backoff during an active test. Do not continuously poll
   while waiting for a person to change external settings.
6. After verification succeeds, call `setAnsweringPresetEnabled(id, true)` when
   the user requests activation. Read setup status once to confirm it. Report
   `nextSteps` if anything remains. `readyForCalls` means stored app prerequisites
   are satisfied; it does not probe the external bridge, guarantee capacity or
   prove an audible conversation. Ask the user to make the second test call.
7. Use `updateAnsweringPresetInstructions` for an instructions-only edit,
   `updateAnsweringPreset` for other settings, and
   `setAnsweringPresetEnabled(id, false)` to stop accepting new calls. Changing
   the number resets verification and turns the line off. Deleting a preset
   removes its routing; neither deletion nor disabling changes Twilio/carrier
   settings or ends an already active conversation.

For a phone-time-only check, prefer the local query `getMyBillingStatus` or the
setup status's `availablePhoneSeconds`. `agentGetAccountStatus` is appropriate
when current deposited ICP and the ledger fee are needed; it makes ledger calls.
Buy time only after the user authorizes the package and price. Refresh ICP pricing
only when its six-hour cache is stale. Reuse an intended purchase's idempotency
key after an uncertain result, and check the resulting balance before retrying.

## Availability, capture and account compatibility

Prepaid time and an available voice bridge are needed for each answered call.
The small bridge normally serves one call at a time. A supported self-test from
an outbound app call to the same account's verified answering line can admit one
matching incoming companion; both legs reserve and spend phone time separately.
A direct test from another phone avoids that two-leg app test. Twilio number,
carrier and forwarding charges may also apply through their respective accounts.

Calls are processed in real time by the off-chain voice bridge, Twilio and xAI
even when saved capture is off. Call metadata is still retained without capture.
Selected transcripts and call records are stored in the IC backend; recordings
stay off-chain and have limited retention. Capture
authorization records the customer's choices, not another participant's consent.
Required notices and permissions still apply. Keep webhook secrets and private
listening or recording links confidential. This is not an emergency service.

The current voice bridge validates Twilio signatures with its server-side
`TWILIO_AUTH_TOKEN` and uses its configured Twilio account for call control.
An unrelated customer's Twilio account is not automatically supported by entering
its number in the app. Confirm support with the operator before buying or routing
a number. Do not disable production signature checks to bypass this boundary,
or put provider credentials into canister state, a preset or a chat. Changing
off-chain account support requires a separately configured bridge, not just an IC
frontend deployment. See [Windows voice-service setup](WINDOWS.md).

These onboarding documents are static assets. The simple creation method adds
one normal preset; the setup-status query reads existing state without ledger,
pricing, HTTP, randomness, timers or new persistent records. This workflow keeps
IC cycle use conservative.
