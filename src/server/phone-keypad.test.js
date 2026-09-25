import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createPhoneKeypad, makeKeypadAudio, extractSuppliedExtension, KEYPAD_TOOL, KEYPAD_INSTRUCTIONS } from "./phone-keypad.js";
import { createCallLifecycle, CALL_LIFECYCLE_TOOLS, CALL_LIFECYCLE_INSTRUCTIONS } from "./call-lifecycle.js";

function harness(overrides = {}) {
  const sent = [], results = [], timers = new Map();
  let time = 10000, id = 0;
  const keypad = createPhoneKeypad({
    ready: () => true, now: () => time,
    sendTwilio: (value) => sent.push(value), sendXai: (value) => results.push(value),
    setTimer: (fn) => { timers.set(++id, fn); return id; },
    clearTimer: (key) => timers.delete(key), ...overrides,
  });
  const press = (digits, callId = `call-${++id}`) => keypad.handle({ name: "press_phone_keys", call_id: callId, arguments: JSON.stringify({ digits }) });
  const ack = () => keypad.onMark(sent.at(-1).mark.name);
  return { keypad, press, ack, sent, results, timers, advance: () => { time += 10000; } };
}

function decode(byte) {
  const value = (~byte) & 255;
  const magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
  return (value & 128) ? 132 - magnitude : magnitude - 132;
}

test("all twelve keys decode into the correct two frequencies with silence gaps", () => {
  const keys = "123456789*0#";
  const frequencies = [697, 770, 852, 941, 1209, 1336, 1477];
  for (const [index, key] of [...keys].entries()) {
    const audio = makeKeypadAudio(key);
    assert.equal(audio.length, 4800);
    assert.ok(audio.subarray(0, 1600).every(byte => byte === 255));
    assert.ok(audio.subarray(3600).every(byte => byte === 255));
    const samples = [...audio.subarray(1680, 3520)].map(decode);
    const powers = frequencies.map(f => {
      let real = 0, imag = 0;
      samples.forEach((sample, i) => { real += sample * Math.cos(2 * Math.PI * f * i / 8000); imag += sample * Math.sin(2 * Math.PI * f * i / 8000); });
      return real * real + imag * imag;
    });
    const selected = [Math.floor(index / 3), 4 + index % 3];
    const unwanted = Math.max(...powers.filter((_, i) => !selected.includes(i)));
    selected.forEach(i => assert.ok(powers[i] > unwanted * 100, `${key}: frequency ${frequencies[i]}`));
    assert.ok(Math.max(...samples.map(Math.abs)) < 18000);
  }
  assert.equal(makeKeypadAudio("123#").length, 14400);
});

test("invalid arguments never emit media", () => {
  for (const digits of ["", "1w2", "1234567890123", 1, null, "A", "１", "1\n"]) {
    assert.throws(() => makeKeypadAudio(digits));
    const h = harness(); h.press(digits);
    assert.equal(h.sent.length, 0);
    assert.ok(JSON.parse(h.results[0].item.output).error);
  }
  const h = harness();
  h.keypad.handle({ name: "press_phone_keys", call_id: "bad", arguments: "{" });
  assert.equal(h.sent.length, 0);
});

test("plays once, waits for the matching mark, and leaves the agent listening", () => {
  const h = harness(); h.press("12#", "same");
  assert.deepEqual(h.sent.map(x => x.event), ["clear", "media", "mark"]);
  assert.equal(Buffer.from(h.sent[1].media.payload, "base64").length, 11200);
  assert.equal(h.results.length, 0);
  h.press("12#", "same");
  assert.equal(h.sent.length, 3);
  h.keypad.onMark("xai-audio-1"); assert.ok(h.keypad.busy);
  h.ack(); assert.equal(h.keypad.busy, false);
  assert.equal(JSON.parse(h.results[0].item.output).status, "played");
  assert.equal(h.results[0].item.call_id, "same");
  assert.equal(h.results.length, 1); // no response.create / speech over the menu
  assert.equal(h.timers.size, 0);
});

test("busy, cooldown, repeated digits and inactive streams are bounded", () => {
  const h = harness(); h.press("1"); h.press("2");
  assert.equal(h.sent.length, 3);
  h.ack(); h.press("2"); assert.equal(h.sent.length, 3);
  h.advance(); h.press("1"); h.ack();
  h.advance(); h.press("1"); assert.equal(h.sent.length, 6);
  const inactive = harness({ ready: () => false }); inactive.press("1");
  assert.equal(inactive.sent.length, 0);
});

test("timeouts do not claim playback or retry; close discards pending work", () => {
  const h = harness(); h.press("0"); [...h.timers.values()][0]();
  assert.equal(JSON.parse(h.results[0].item.output).status, "playback_unconfirmed");
  assert.equal(h.sent.length, 3);
  h.advance(); h.press("2"); h.keypad.close();
  assert.equal(h.timers.size, 0);
  h.ack(); h.press("3"); assert.equal(h.results.length, 1);
});

test("per-call press and total digit budgets stop runaway navigation", () => {
  const h = harness();
  for (let i = 0; i < 21; i++) { h.press(String(i)); if (h.keypad.busy) h.ack(); h.advance(); }
  assert.equal(h.sent.length, 60);
  const digits = harness();
  for (let i = 0; i < 8; i++) { digits.press(String(i).repeat(12)); if (digits.keypad.busy) digits.ack(); digits.advance(); }
  assert.equal(digits.sent.length, 18);
});

test("signaling digits avoid in-band audio and can fall back once", () => {
  const signaled = [];
  const h = harness({ requestSignaling: (digits) => { signaled.push(digits); return true; } });
  h.press("104#");
  assert.deepEqual(signaled, ["104#"]);
  assert.equal(h.sent.length, 0);
  h.keypad.onSignalingResult("played");
  assert.equal(JSON.parse(h.results[0].item.output).status, "played");
  const fallback = harness({ requestSignaling: () => false });
  fallback.press("9");
  assert.deepEqual(fallback.sent.map((event) => event.event), ["clear", "media", "mark"]);
  const failed = harness({ requestSignaling: () => true });
  failed.press("3");
  failed.keypad.onSignalingResult("failed");
  assert.deepEqual(failed.sent.map((event) => event.event), ["clear", "media", "mark"]);
});

test("extension hints stay limited to supplied extension digits", () => {
  assert.equal(extractSuppliedExtension("Ask for extension 104, then billing."), "104");
  assert.equal(extractSuppliedExtension("The warranty extension is 2 weeks."), "");
  assert.equal(extractSuppliedExtension("No keypad details here."), "");
  assert.match(KEYPAD_INSTRUCTIONS, /extension/i);
});

test("production session builder exposes keypad only on full outbound sessions", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const start = source.indexOf("function buildXaiSessionUpdate(");
  const end = source.indexOf("function wantsForceOpening", start);
  const context = vm.createContext({
    KEYPAD_TOOL, KEYPAD_INSTRUCTIONS, CALL_LIFECYCLE_TOOLS, CALL_LIFECYCLE_INSTRUCTIONS,
    CALL_DIRECTIONS: { OUTBOUND: "outbound", INBOUND: "inbound" },
    extractVoiceSessionOptions: () => ({ cleanPrompt: "Call customer service", options: {} }),
    normalizeCallDirection: x => x, normalizeInboundGreeting: x => x,
    normalizeOptionalInstructionText: x => x, buildSafeInstructions: (...x) => x.join("\n"),
    buildOpeningOnlySessionInstructions: () => "Greeting", buildVoiceStyleInstructions: () => "Style",
    buildNaturalVoiceInstructions: x => x, buildCallDirectionInstructions: () => "Direction",
    normalizeIdleTimeoutMs: () => 14000, normalizeKeyterms: () => [],
    normalizeSpeechSpeed: () => 1, normalizeReasoningEffort: () => "high",
    clamp: x => x, XAI_SESSION_RESUMPTION: false, process: { env: {} },
  });
  vm.runInContext(source.slice(start, end), context);
  const preset = { toolsEnabled: {}, vectorStoreIds: [], voice: "eve", turnDetection: {} };
  const outbound = context.buildXaiSessionUpdate(preset).session;
  assert.ok(outbound.tools.some(x => x.name === "press_phone_keys"));
  assert.ok(outbound.instructions.includes(KEYPAD_INSTRUCTIONS));
  assert.ok(outbound.instructions.includes(CALL_LIFECYCLE_INSTRUCTIONS));
  assert.ok(outbound.tools.some(x => x.name === "end_call"));
  assert.ok(outbound.tools.some(x => x.name === "set_call_state"));
  assert.equal(outbound.turn_detection.idle_timeout_ms, undefined);
  assert.equal(outbound.audio.input.transcription, undefined);
  assert.equal(context.buildXaiSessionUpdate(preset, { direction: "inbound" }).session.turn_detection.idle_timeout_ms, 14000);
  for (const options of [{ direction: "inbound" }, { openingOnly: true }]) {
    assert.equal(context.buildXaiSessionUpdate(preset, options).session.tools.length, 0);
  }
});

test("real bridge event handlers navigate the first menu and protect tones from barge-in", () => {
  const source = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  const start = source.indexOf('mediaWss.on("connection",');
  const end = source.indexOf('\n});', start) + 4;
  let remote;
  class Socket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { super(); remote = this; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.emit("close"); }
  }
  const mediaWss = new EventEmitter();
  const session = { id: "test", direction: "outbound", mediaToken: "secret", preset: {} };
  const ended = [];
  const noop = () => {};
  const context = vm.createContext({
    mediaWss, WebSocket: Socket, createPhoneKeypad, createCallLifecycle, KEYPAD_TOOL,
    CALL_DIRECTIONS: { OUTBOUND: "outbound", INBOUND: "inbound" },
    callSessions: new Map([["test", session]]),
    isWebSocketOpen: ws => ws?.readyState === 1, safeTokenEqual: (a,b) => a === b,
    markBillingActivity: noop, startBridgeRecording: noop, startBillingTimer: noop,
    XAI_MODEL: "test", process: { env: {} }, log: noop,
    buildXaiSessionUpdate: (_, options) => ({ type: "session.update", options }),
    setTimeout: () => ({ unref: noop }), normalizeCallDirection: x => x,
    getXaiResponseId: e => e.response?.id, getLatestTranscriptText: () => "", noteGoodbyeUtterance: noop,
    broadcastMonitorAudio: noop, appendBridgeRecordingAudio: noop, STREAM_MARK_PREFIX: "xai-audio",
    scheduleFinishPaidSession: noop,
    endSessionFromRemoteRequest: async (session, reason) => ended.push({ session, reason }),
  });
  vm.runInContext(source.slice(start, end), context);
  const phone = new Socket(); mediaWss.emit("connection", phone, { socket: {} });
  const emitPhone = e => phone.emit("message", Buffer.from(JSON.stringify(e)));
  emitPhone({ event: "start", start: { streamSid: "MZtest", customParameters: { sessionId: "test", mediaToken: "secret" } } });
  const xai = remote;
  xai.emit("open");
  assert.equal(xai.sent[0].options.openingOnly, false);
  const emitXai = e => xai.emit("message", Buffer.from(JSON.stringify(e)));
  emitXai({ type: "response.created", response: { id: "r1" } });
  assert.equal(xai.sent.length, 1); // no forced greeting or first-response cancellation
  emitXai({ type: "response.function_call_arguments.done", name: "press_phone_keys", call_id: "c1", arguments: '{"digits":"1"}' });
  assert.deepEqual(phone.sent.map(e => e.event), ["clear", "media", "mark"]);
  assert.ok(phone.sent.every(e => e.streamSid === "MZtest"));
  emitXai({ type: "response.output_audio.delta", delta: "ignored" });
  emitXai({ type: "input_audio_buffer.speech_started" });
  assert.equal(phone.sent.length, 3); // menu speech cannot clear the tones
  emitXai({ type: "response.done", response: { id: "r1" } });
  emitPhone({ event: "mark", mark: phone.sent[2].mark });
  assert.equal(JSON.parse(xai.sent.at(-1).item.output).status, "played");
  emitXai({ type: "response.function_call_arguments.done", name: "set_call_state", call_id: "human1", arguments: '{"state":"human"}' });
  emitXai({ type: "response.created", response: { id: "r2" } });
  emitXai({ type: "response.output_audio.delta", delta: "human-greeting" });
  assert.equal(phone.sent[3].media.payload, "human-greeting");
  emitXai({ type: "response.function_call_arguments.done", name: "end_call", call_id: "end1", arguments: '{"reason":"conversation_complete"}' });
  assert.equal(ended.length, 0);
  emitXai({ type: "response.done", response: { id: "r2", status: "completed" } });
  assert.equal(ended.length, 0);
  emitPhone({ event: "mark", mark: phone.sent.at(-1).mark });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "conversation_complete");
  assert.equal(ended[0].session, session);
  phone.close();
});
