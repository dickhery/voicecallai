import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseDelivery } from './response-delivery.js';
import { createCallLifecycle } from './call-lifecycle.js';

function harness() {
  const marks = [], delivered = [], unconfirmed = [];
  const delivery = createResponseDelivery({
    sendMark: name => { marks.push(name); return true; },
    onDelivered: text => delivered.push(text),
    onUnconfirmed: info => unconfirmed.push(info),
  });
  return { delivery, marks, delivered, unconfirmed };
}

test('assistant transcript is saved only after full audio and a playback acknowledgment', () => {
  const h = harness();
  h.delivery.begin('one');
  // xAI can deliver transcript before the matching audio.
  h.delivery.transcript('Hello. '); h.delivery.transcript('How can I help?');
  h.delivery.audio(16_000, true);
  h.delivery.done('one', 'completed');
  assert.deepEqual(h.delivered, []);
  h.delivery.onMark('unrelated'); assert.deepEqual(h.delivered, []);
  h.delivery.onMark(h.marks[0]); h.delivery.onMark(h.marks[0]);
  assert.deepEqual(h.delivered, ['Hello. How can I help?']);
  assert.deepEqual(h.unconfirmed, []);
});

test('generated transcript never claims suppressed or partly muted audio was spoken', () => {
  for (const admitted of [0, 8_000]) {
    const h = harness();
    h.delivery.begin('muted'); h.delivery.transcript('I am calling about your account.');
    h.delivery.audio(8_000, false);
    if (admitted) h.delivery.audio(admitted, true);
    h.delivery.done('muted', 'completed');
    assert.deepEqual(h.marks, []); assert.deepEqual(h.delivered, []);
    assert.equal(h.unconfirmed.length, 1);
    assert.equal(h.unconfirmed[0].suppressedBytes, 8_000);
  }
});

test('clear invalidates marks Twilio echoes for speech that was flushed', () => {
  const h = harness();
  h.delivery.begin('interrupted'); h.delivery.audio(80_000, true);
  h.delivery.transcript('This sentence was buffered, then interrupted.');
  h.delivery.done('interrupted', 'completed');
  h.delivery.clear();
  h.delivery.onMark(h.marks[0]);
  assert.deepEqual(h.delivered, []);
  assert.equal(h.unconfirmed[0].reason, 'playback_cleared');
});

test('clear while generation is active suppresses its later transcript and completion', () => {
  const h = harness();
  h.delivery.begin('one'); h.delivery.audio(8_000, true);
  h.delivery.clear();
  h.delivery.transcript('The model kept generating this.');
  h.delivery.audio(8_000, true); h.delivery.done('one', 'completed');
  assert.deepEqual(h.marks, []); assert.deepEqual(h.delivered, []);
  assert.equal(h.unconfirmed.length, 1);
});

test('failed, cancelled and incomplete responses are not represented as full spoken turns', () => {
  for (const status of ['failed', 'cancelled', 'incomplete', undefined]) {
    const h = harness(); h.delivery.begin('one'); h.delivery.audio(8_000, true);
    h.delivery.transcript('An unfinished sentence'); h.delivery.done('one', status);
    assert.deepEqual(h.marks, []); assert.deepEqual(h.delivered, []);
    assert.equal(h.unconfirmed.length, 1);
  }
});

test('previous response can finish playback while the next response is generating', () => {
  const h = harness();
  h.delivery.begin('one'); h.delivery.audio(8_000, true); h.delivery.transcript('First.');
  h.delivery.done('one', 'completed');
  h.delivery.begin('two'); h.delivery.audio(8_000, true); h.delivery.transcript('Second.');
  h.delivery.onMark(h.marks[0]);
  h.delivery.done('stale', 'cancelled');
  h.delivery.done('two', 'completed'); h.delivery.onMark(h.marks[1]);
  assert.deepEqual(h.delivered, ['First.', 'Second.']);
});

test('closing without acknowledgment leaves no false transcript and no unbounded pending queue', () => {
  const h = harness();
  for (let i = 0; i < 40; i++) {
    h.delivery.begin(String(i)); h.delivery.audio(8_000, true); h.delivery.transcript(`Turn ${i}.`);
    h.delivery.done(String(i), 'completed');
  }
  assert.equal(h.unconfirmed.length, 8);
  h.delivery.close(); h.delivery.close();
  for (const mark of h.marks) h.delivery.onMark(mark);
  assert.equal(h.unconfirmed.length, 40); assert.deepEqual(h.delivered, []);
});

test('a conversational AI greeting longer than 3.5 seconds can respond and be confirmed', () => {
  const h = harness();
  let time = 0;
  const lifecycle = createCallLifecycle({
    ready: () => true, busy: () => false, gateOpenings: true,
    now: () => time, setTimer: () => 1, clearTimer() {},
    sendXai() {}, sendMark() {}, endCall() {},
  });
  lifecycle.start(); lifecycle.speechStarted(); time = 12_000;
  lifecycle.speechStopped(); lifecycle.responseCreated();
  h.delivery.begin('interview'); h.delivery.transcript('Hello, I would like to ask a question.');
  const admitted = !lifecycle.holdAssistant;
  h.delivery.audio(16_000, admitted);
  assert.equal(admitted, true);
  h.delivery.done('interview', 'completed'); h.delivery.onMark(h.marks[0]);
  assert.deepEqual(h.delivered, ['Hello, I would like to ask a question.']);
  lifecycle.close();
});

test('audio confirmation works when transcript capture is disabled', () => {
  const h = harness();
  h.delivery.begin('private'); h.delivery.audio(8_000, true);
  h.delivery.done('private', 'completed'); h.delivery.onMark(h.marks[0]);
  assert.deepEqual(h.delivered, ['']);
  assert.deepEqual(h.unconfirmed, []);
});
