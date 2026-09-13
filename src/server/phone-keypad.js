// In-band DTMF over the existing Twilio PCMU stream. No REST requests or IC writes.
export const KEYPAD_TOOL = {
  type: "function",
  name: "press_phone_keys",
  description: "Press telephone keypad keys when an automated menu requests a selection or a user-provided extension. Select only the current menu step, then listen for the next prompt. Do not speak the digits.",
  parameters: {
    type: "object",
    properties: {
      digits: { type: "string", pattern: "^[0-9*#]{1,12}$", description: "1–12 keypad characters: 0–9, star (*), pound (#)." },
    },
    required: ["digits"],
    additionalProperties: false,
  },
};

export const KEYPAD_INSTRUCTIONS = [
  "Automated phone menus: listen to the entire relevant menu before choosing.",
  "If an automated system answers, do not introduce yourself or talk over it. Use press_phone_keys for the announced option that serves the user's call goal, including voicemail or customer service.",
  "Navigate one menu at a time. Never guess unannounced shortcuts, extensions, account numbers, PINs, or verification codes; use only details the user supplied for this task.",
  "Do not use keypad selections to authorize purchases, payments, account changes, or consent beyond the user's task.",
  "Do not announce keypresses. After pressing, remain silent and listen for the next menu or person, including during hold music. This overrides requests to fill silence or re-engage while waiting on an automated system.",
  "Playback completion means tones were played, not that the menu accepted them. Retry a selection at most once, only if the menu explicitly repeats or reports a missed entry. Never loop through keys.",
  "When a person answers, introduce yourself and follow the call goal. If routed to voicemail, wait for the recording prompt/beep before leaving the requested message.",
].join("\n");

const ROWS = [697, 770, 852, 941];
const COLS = [1209, 1336, 1477];
const KEYS = "123456789*0#";
const SAMPLE_RATE = 8000;
const TONE_SAMPLES = 1600; // 200 ms tones, 100 ms inter-digit silence
const GAP_SAMPLES = 800;

function encodeMuLaw(sample) {
  const sign = sample < 0 ? 0x80 : 0;
  const magnitude = Math.min(32635, Math.abs(Math.round(sample))) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function makeKeypadAudio(digits) {
  if (typeof digits !== "string" || !/^[0-9*#]{1,12}$/.test(digits)) {
    throw new Error("Use 1–12 characters from 0–9, *, # only.");
  }
  const audio = Buffer.alloc(digits.length * (TONE_SAMPLES + GAP_SAMPLES), 0xff);
  for (let key = 0; key < digits.length; key++) {
    const index = KEYS.indexOf(digits[key]);
    const low = ROWS[Math.floor(index / 3)];
    const high = COLS[index % 3];
    for (let i = 0; i < TONE_SAMPLES; i++) {
      // 5 ms ramps avoid clicks. Each frequency has equal, conservative amplitude.
      const envelope = Math.min(1, i / 40, (TONE_SAMPLES - 1 - i) / 40);
      const sample = envelope * 6000 * (
        Math.sin(2 * Math.PI * low * i / SAMPLE_RATE) +
        Math.sin(2 * Math.PI * high * i / SAMPLE_RATE)
      );
      audio[key * (TONE_SAMPLES + GAP_SAMPLES) + i] = encodeMuLaw(sample);
    }
  }
  return audio;
}

// One controller per authenticated media connection. Keep all limits in memory.
export function createPhoneKeypad({ sendTwilio, sendXai, ready, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const seen = new Set();
  const repeats = new Map();
  let pending = null;
  let closed = false;
  let count = 0;
  let digitCount = 0;
  let lastPress = -Infinity;

  function output(callId, result) {
    if (!closed) sendXai({ type: "conversation.item.create", item: {
      type: "function_call_output", call_id: callId, output: JSON.stringify(result),
    } });
    // Deliberately do not request speech: the next IVR prompt drives server VAD.
  }

  function finish(status) {
    if (!pending) return;
    const { callId, timer } = pending;
    pending = null;
    clearTimer(timer);
    output(callId, { status, instruction: "Listen for the next prompt. Do not assume the menu accepted the keys or automatically retry." });
  }

  return {
    get busy() { return Boolean(pending); },
    handle(event) {
      if (closed || event.name !== KEYPAD_TOOL.name || typeof event.call_id !== "string" || !event.call_id) return false;
      if (seen.has(event.call_id)) return true;
      // Bound bookkeeping as well as actual keypresses, even with malformed calls.
      if (seen.size >= 64) { output(event.call_id, { error: "Keypad tool request limit reached. Stop using the keypad." }); return true; }
      seen.add(event.call_id);
      let digits;
      try {
        if (typeof event.arguments !== "string" || event.arguments.length > 256) throw new Error();
        const args = JSON.parse(event.arguments);
        if (!args || Object.keys(args).length !== 1) throw new Error();
        digits = args.digits;
        if (typeof digits !== "string" || !/^[0-9*#]{1,12}$/.test(digits)) throw new Error();
      } catch {
        output(event.call_id, { error: "Expected digits containing 1–12 characters from 0–9, *, # only." });
        return true;
      }
      if (!ready() || pending || now() - lastPress < 1500 || count >= 20 || digitCount + digits.length > 80 || (repeats.get(digits) || 0) >= 2) {
        output(event.call_id, { error: "Keypad unavailable, busy, or safety limit reached. Listen; do not immediately retry." });
        return true;
      }
      const payload = makeKeypadAudio(digits).toString("base64");
      count++;
      digitCount += digits.length;
      repeats.set(digits, (repeats.get(digits) || 0) + 1);
      lastPress = now();
      const mark = `phone-keypad-${count}`;
      pending = { callId: event.call_id, mark, timer: setTimer(() => finish("playback_unconfirmed"), 8000) };
      pending.timer?.unref?.();
      try {
        sendTwilio({ event: "clear" });
        sendTwilio({ event: "media", media: { payload } });
        sendTwilio({ event: "mark", mark: { name: mark } });
      } catch {
        finish("playback_unconfirmed");
      }
      return true;
    },
    onMark(name) { if (pending?.mark === name) finish("played"); },
    close() {
      closed = true;
      if (pending) clearTimer(pending.timer);
      pending = null;
      seen.clear();
      repeats.clear();
    },
  };
}
