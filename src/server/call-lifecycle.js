const STATES = ['human', 'automated', 'voicemail_greeting', 'voicemail_recording'];
const REASONS = ['voicemail_left', 'cannot_leave_message', 'conversation_complete', 'no_response'];

export const CALL_LIFECYCLE_LIMITS = Object.freeze({
  checkInMs: 20_000,
  silenceMs: 45_000,
  automatedSilenceMs: 180_000,
  voicemailMs: 90_000,
  playbackGraceMs: 3_000,
  maxDrainMs: 60_000,
});

export const CALL_LIFECYCLE_TOOLS = [
  {
    type: 'function', name: 'set_call_state',
    description: 'Report a change in who is on this outbound line, based on what you actually hear. Use voicemail_greeting while the greeting plays, voicemail_recording only after the beep or explicit recording cue, automated for menus/hold, human for a live person.',
    parameters: { type: 'object', properties: { state: { type: 'string', enum: STATES } }, required: ['state'], additionalProperties: false },
  },
  {
    type: 'function', name: 'end_call',
    description: 'Hang up this call after your final spoken message has played. Use immediately after leaving one voicemail, when the mailbox is full/unavailable, after a completed conversation, or after an unanswered check-in. Never wait for a voicemail system to reply.',
    parameters: { type: 'object', properties: { reason: { type: 'string', enum: REASONS } }, required: ['reason'], additionalProperties: false },
  },
];

export const CALL_LIFECYCLE_INSTRUCTIONS = [
  'Outbound call lifecycle: use set_call_state when the line changes between a live human, automated menu/hold, voicemail greeting, and voicemail recording. Base this on heard audio, not silence alone. A human receptionist or answering-service operator is a human.',
  'Voicemail cues include a recorded unavailable greeting, a request to leave a message after the tone, or a mailbox announcement. Report voicemail_greeting immediately; stay silent until the greeting and beep/recording cue finish. Do not answer questions in the recorded greeting, introduce yourself over it, or repeatedly ask if anyone is there.',
  'At the recording cue report voicemail_recording, then leave ONE concise message, ideally 15-25 seconds, with the call purpose and only user-supplied identity/callback details. Do not invent facts or disclose sensitive account/medical/payment information to a mailbox. Honor requests not to leave voicemail; end_call with cannot_leave_message instead.',
  'After that single message, call end_call with voicemail_left immediately. Do not ask the mailbox questions, wait for a reply, repeat the message, or exchange goodbyes. The bridge waits for queued speech to finish before disconnecting.',
  'If the mailbox is full, recording is unavailable, or the number is disconnected, call end_call with cannot_leave_message without trying repeatedly. Never use voicemail_left unless you actually spoke the message after the recording cue.',
  'For a live conversation, give one brief farewell when finished and call end_call with conversation_complete. If someone resumes speaking before hangup, listen and reconsider.',
  'Silence alone is not proof of voicemail. On a silent human/unknown line make at most one brief availability check; if unanswered, end_call with no_response. Do not fill silence or ask availability questions during menus, hold, or voicemail greetings. Report human when a live person returns.',
].join('\n');

// No transcripts, audio storage, network polling, or canister calls. The bridge
// supplies VAD events and Twilio playback marks from the existing sockets.
export function createCallLifecycle({ ready, busy, sendXai, sendMark, endCall,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = false;
  let closed = false;
  let timer;
  let state = 'unknown';
  let remoteSpeaking = false;
  let lastRemoteAt = 0;
  let checkedIn = false;
  let voicemailAt = null;
  let responseActive = false;
  let responseAudio = false;
  let messageRequested = false;
  let continueState = false;
  let playingUntil = 0;
  let mark = null;
  let markSequence = 0;
  let ending = null;
  const seen = new Set();

  function finish(reason) {
    if (closed) return;
    closed = true;
    clearTimer(timer);
    endCall(reason);
  }

  function requestEnd(reason) {
    ending ||= { reason, at: now() };
    maybeEnd();
  }

  function requestResponse(instruction) {
    responseActive = true;
    // response.instructions replaces the entire session prompt in xAI. Use a
    // conversation update so the preset, identity, and safety rules still apply.
    sendXai({ type: 'conversation.item.create', item: {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: `Call control update: ${instruction}` }],
    } });
    sendXai({ type: 'response.create' });
  }

  function maybeEnd() {
    if (!ending || closed) return;
    const drained = !responseActive && !mark && now() >= playingUntil;
    const fallback = !responseActive && now() >= playingUntil + CALL_LIFECYCLE_LIMITS.playbackGraceMs;
    if (drained || fallback || now() - ending.at >= CALL_LIFECYCLE_LIMITS.maxDrainMs) finish(ending.reason);
  }

  function tick() {
    if (closed || !active) return;
    if (ready()) {
      if (voicemailAt !== null && now() - voicemailAt >= CALL_LIFECYCLE_LIMITS.voicemailMs) {
        requestEnd('voicemail_timeout');
      }
      if (ending) maybeEnd();
      else if (!remoteSpeaking) {
        const silence = now() - lastRemoteAt;
        const automated = state === 'automated' || state.startsWith('voicemail');
        const limit = automated ? CALL_LIFECYCLE_LIMITS.automatedSilenceMs : CALL_LIFECYCLE_LIMITS.silenceMs;
        if (silence >= limit) requestEnd('no_response_timeout');
        else if (!automated && !checkedIn && silence >= CALL_LIFECYCLE_LIMITS.checkInMs &&
          !responseActive && now() >= playingUntil && !busy()) {
          checkedIn = true;
          requestResponse('No remote speech has been detected for 20 seconds. If this is a live or unknown line, ask once, briefly, whether anyone is there, then listen. If the audio established a menu, hold, or voicemail, report its set_call_state and follow that workflow instead. Do not invent a voicemail message from silence.');
        }
      }
    }
    if (!closed) {
      timer = setTimer(tick, 1000);
      timer?.unref?.();
    }
  }

  function output(callId, result) {
    sendXai({ type: 'conversation.item.create', item: {
      type: 'function_call_output', call_id: callId, output: JSON.stringify(result),
    } });
  }

  return {
    get ending() { return Boolean(ending) || closed; },
    endAfterPlayback(reason) {
      if (active && !closed && ready()) requestEnd(reason);
    },
    start() {
      if (active || closed) return;
      active = true;
      lastRemoteAt = now();
      timer = setTimer(tick, 1000);
      timer?.unref?.();
    },
    handle(event) {
      if (!CALL_LIFECYCLE_TOOLS.some(tool => tool.name === event.name)) return false;
      if (closed || !ready() || typeof event.call_id !== 'string' || !event.call_id) return true;
      if (seen.has(event.call_id)) return true;
      if (seen.size >= 128) { output(event.call_id, { error: 'Call control request limit reached.' }); return true; }
      seen.add(event.call_id);
      const key = event.name === 'end_call' ? 'reason' : 'state';
      let value;
      try {
        if (typeof event.arguments !== 'string' || event.arguments.length > 256) throw new Error();
        const args = JSON.parse(event.arguments);
        if (!args || Object.keys(args).length !== 1) throw new Error();
        value = args[key];
        if (!(key === 'reason' ? REASONS : STATES).includes(value)) throw new Error();
      } catch {
        output(event.call_id, { error: `Expected one valid ${key}.` });
        return true;
      }
      if (key === 'reason' && value === 'no_response' &&
        (remoteSpeaking || now() - lastRemoteAt < CALL_LIFECYCLE_LIMITS.silenceMs)) {
        output(event.call_id, { error: 'Allow the other party time to respond. The bridge will end persistent silence.' });
        return true;
      }
      output(event.call_id, { status: 'accepted', [key]: value });
      if (key === 'reason') requestEnd(value);
      else {
        if (value !== state) {
          state = value;
          continueState = state === 'human' || state === 'automated';
          if (state === 'human') {
            voicemailAt = null;
            lastRemoteAt = now();
            checkedIn = false;
          }
          if (state.startsWith('voicemail')) voicemailAt ??= now();
          if (state === 'voicemail_recording') {
            messageRequested = false;
          }
        }
      }
      return true;
    },
    speechStarted() {
      if (!active || closed) return;
      remoteSpeaking = true;
      lastRemoteAt = now();
      checkedIn = false;
      // Cancel an unplayed farewell if the other party interrupts. Twilio also
      // acknowledges cleared marks, so they must not count as delivered speech.
      ending = null;
    },
    speechStopped() {
      if (!active || closed) return;
      remoteSpeaking = false;
      lastRemoteAt = now();
      checkedIn = false;
    },
    responseCreated() {
      if (!active || closed) return;
      responseActive = true;
      responseAudio = false;
    },
    audio(payload) {
      if (!active || closed) return;
      responseAudio = true;
      playingUntil = Math.max(now(), playingUntil) + Buffer.from(payload, 'base64').length / 8;
    },
    responseDone(status) {
      if (!active || closed) return;
      responseActive = false;
      const shouldContinue = continueState;
      continueState = false;
      if (status !== 'completed') {
        ending = null;
        return;
      }
      if (responseAudio) {
        mark = `call-lifecycle-${++markSequence}`;
        sendMark(mark);
      }
      if (state === 'voicemail_recording' && !ending) {
        if (responseAudio) requestEnd('voicemail_message_complete');
        else if (!messageRequested) {
          messageRequested = true;
          requestResponse('The voicemail recording cue was heard. Leave one concise message using only the supplied call goal and permitted facts, then call end_call with voicemail_left. If no appropriate message is authorized, call end_call with cannot_leave_message.');
        }
      } else if (shouldContinue && !ending && !responseAudio && !busy()) {
        requestResponse(state === 'human'
          ? 'A live person is on the line. Continue the call goal naturally, introducing yourself if you have not already done so.'
          : 'Continue from the menu you just heard: select an announced option relevant to the call goal only if the menu is complete. Otherwise remain silent and listen. Do not talk over menus or hold.');
      }
      maybeEnd();
    },
    onMark(name) {
      if (!active || closed) return;
      if (!mark || mark !== name) return;
      mark = null;
      playingUntil = now();
      maybeEnd();
    },
    clear() {
      if (!active || closed) return;
      mark = null;
      playingUntil = now();
      responseAudio = false;
      ending = null;
    },
    close() { closed = true; clearTimer(timer); seen.clear(); },
  };
}
