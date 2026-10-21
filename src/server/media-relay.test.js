import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createCallLifecycle } from './call-lifecycle.js';
import { createPhoneKeypad, KEYPAD_TOOL } from './phone-keypad.js';
import { createResponseDelivery } from './response-delivery.js';

// Replay the actual websocket handlers without connecting to providers or IC.
function bridge({ saveTranscript = true, permissionConfirmed = true } = {}) {
  let remote, time = 0, timerId = 0;
  const timers = new Map(), transcript = [], monitors = [], recordings = [], goodbyeChecks = [];
  const noop = () => {};
  class Socket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { super(); remote = this; }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const mediaWss = new EventEmitter();
  const session = { id: 'test', direction: 'outbound', mediaToken: 'secret', preset: {},
    saveTranscript, permissionConfirmed };
  const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const start = source.indexOf('mediaWss.on("connection",');
  const end = source.indexOf('\n});', start) + 4;
  const context = vm.createContext({
    mediaWss, WebSocket: Socket, Buffer, KEYPAD_TOOL, createPhoneKeypad, createResponseDelivery,
    createCallLifecycle: options => createCallLifecycle({ ...options, now: () => time,
      setTimer: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: time + delay }); return id; },
      clearTimer: id => timers.delete(id) }),
    CALL_DIRECTIONS: { OUTBOUND: 'outbound', INBOUND: 'inbound' },
    callSessions: new Map([['test', session]]),
    isWebSocketOpen: ws => ws?.readyState === 1, safeTokenEqual: (a, b) => a === b,
    markBillingActivity: noop, startBridgeRecording: noop, startBillingTimer: noop,
    XAI_MODEL: 'test', process: { env: {} }, log: noop,
    buildXaiSessionUpdate: () => ({ type: 'session.update' }),
    setTimeout: () => ({ unref: noop }), normalizeCallDirection: value => value,
    getXaiResponseId: event => event.response?.id,
    noteGoodbyeUtterance: (_, speaker, text) => goodbyeChecks.push({ speaker, text }),
    broadcastMonitorAudio: (_, channel, payload) => monitors.push({ type: 'audio', channel, payload }),
    broadcastMonitorEvent: (_, event) => monitors.push(event),
    appendBridgeRecordingAudio: (_, payload, track) => recordings.push({ payload, track }),
    appendTranscript: (_, speaker, text) => transcript.push({ speaker, text }),
    getPendingCallArtifacts: () => ({}), parseTwilioMediaTimestamp: Number,
    streamHandoffActive: value => Boolean(value?.streamHandoff),
    scheduleFinishPaidSession: noop, endSessionFromRemoteRequest: async () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  const phone = new Socket(); mediaWss.emit('connection', phone, { socket: {} });
  const emitPhone = event => phone.emit('message', Buffer.from(JSON.stringify(event)));
  emitPhone({ event: 'start', start: { streamSid: 'MZtest', customParameters: { sessionId: 'test', mediaToken: 'secret' } } });
  const xai = remote; xai.emit('open');
  const emitXai = event => xai.emit('message', Buffer.from(JSON.stringify(event)));
  const payload = Buffer.alloc(8000, 255).toString('base64');
  function advance(ms) {
    const target = time + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = target;
  }
  function begin(id = 'response') { emitXai({ type: 'response.created', response: { id } }); }
  function speak(id = 'response') {
    emitXai({ type: 'response.output_audio_transcript.delta', delta: 'Hello, may I ask about the plugin?' });
    emitXai({ type: 'response.output_audio.delta', delta: payload });
    emitXai({ type: 'response.done', response: { id, status: 'completed' } });
  }
  function acknowledge() {
    for (const event of [...phone.sent]) if (event.event === 'mark') emitPhone(event);
  }
  function reconnect() {
    const next = new Socket(); mediaWss.emit('connection', next, { socket: {} });
    next.emit('message', Buffer.from(JSON.stringify({ event: 'start', start: { streamSid: 'MZnext',
      customParameters: { sessionId: 'test', mediaToken: 'secret' } } })));
    return next;
  }
  return { session, xai, phone, emitPhone, emitXai, transcript, monitors, recordings,
    payload, advance, begin, speak, acknowledge, reconnect, goodbyeChecks, close: () => phone.close() };
}

test('production relay delivers a response to a long interactive AI greeting and records only played text', () => {
  const h = bridge();
  h.emitXai({ type: 'input_audio_buffer.speech_started' }); h.advance(12_000);
  h.emitXai({ type: 'input_audio_buffer.speech_stopped' });
  h.begin(); h.speak();
  assert.equal(h.phone.sent.filter(event => event.event === 'media').length, 1);
  assert.equal(h.monitors.some(event => event.type === 'audio' && event.channel === 'assistant'), true);
  assert.equal(h.recordings.some(event => event.track === 'assistant'), true);
  assert.deepEqual(h.transcript, []);
  h.acknowledge();
  assert.deepEqual(h.transcript, [{ speaker: 'assistant', text: 'Hello, may I ask about the plugin?\n' }]);
  assert.equal(h.session.mediaDiagnostics.assistantAudioBytes, 8000);
  assert.equal(h.session.mediaDiagnostics.assistantConfirmedTurns, 1);
  assert.equal(h.xai.sent.some(event => event.type === 'response.create'), false);
  h.close();
});

test('production relay does not invent speech in a transcript when its audio was gated', () => {
  const h = bridge(); h.begin(); h.speak(); h.acknowledge();
  assert.deepEqual(h.transcript, []); assert.deepEqual(h.recordings, []);
  assert.equal(h.phone.sent.some(event => event.event === 'media'), false);
  assert.equal(h.session.mediaDiagnostics.assistantSuppressedBytes, 8000);
  assert.equal(h.session.mediaDiagnostics.assistantUnconfirmedTurns, 1);
  h.close();
});

test('production relay invalidates clear ACKs, keeps recipient text and streams recipient audio', () => {
  const h = bridge();
  h.emitXai({ type: 'input_audio_buffer.speech_stopped' }); h.begin(); h.speak();
  h.emitXai({ type: 'input_audio_buffer.speech_started' });
  h.emitPhone({ event: 'media', media: { payload: h.payload, timestamp: '1000' } });
  h.emitXai({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Hello, this is ChatGPT.' });
  h.acknowledge();
  assert.deepEqual(h.transcript, [{ speaker: 'caller', text: 'Hello, this is ChatGPT.\n' }]);
  assert.equal(h.session.mediaDiagnostics.assistantConfirmedTurns, 0);
  assert.equal(h.session.mediaDiagnostics.assistantUnconfirmedTurns, 1);
  assert.equal(h.session.mediaDiagnostics.callerAudioBytes, 8000);
  assert.equal(h.monitors.some(event => event.type === 'clear'), true);
  assert.equal(h.monitors.some(event => event.channel === 'caller'), true);
  h.close();
});

test('production relay honors disabled or unauthorized transcript capture', () => {
  for (const options of [{ saveTranscript: false }, { permissionConfirmed: false }]) {
    const h = bridge(options);
    h.emitXai({ type: 'input_audio_buffer.speech_stopped' }); h.begin(); h.speak(); h.acknowledge();
    h.emitXai({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Private recipient speech.' });
    assert.deepEqual(h.transcript, []);
    assert.equal(h.session.mediaDiagnostics.assistantConfirmedTurns, 1);
    assert.equal(h.goodbyeChecks[0].text, 'Hello, may I ask about the plugin?');
    h.close();
  }
});

test('keypad stream reconnection clears old delivery but preserves the xAI session and next response', () => {
  const h = bridge();
  h.emitXai({ type: 'input_audio_buffer.speech_stopped' }); h.begin('first'); h.speak('first');
  const oldMark = h.phone.sent.find(event => event.mark?.name.startsWith('transcript-played-'));
  h.session.mediaOwner.clear();
  h.session.streamHandoff = { until: 999999 };
  const next = h.reconnect();
  h.phone.close();
  assert.equal(h.xai.readyState, 1);
  h.emitPhone(oldMark); assert.deepEqual(h.transcript, []);
  h.begin('next'); h.speak('next');
  assert.equal(next.sent.some(event => event.event === 'media' && event.streamSid === 'MZnext'), true);
  for (const event of [...next.sent]) {
    if (event.event === 'mark') next.emit('message', Buffer.from(JSON.stringify(event)));
  }
  assert.equal(h.transcript.length, 1);
  assert.equal(h.session.mediaDiagnostics.assistantConfirmedTurns, 1);
  assert.equal(h.session.mediaDiagnostics.assistantUnconfirmedTurns, 1);
  next.close();
});
