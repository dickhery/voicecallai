import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallLifecycle } from './call-lifecycle.js';

function harness({ start = true, ready = () => true } = {}) {
  let time = 0, id = 0;
  const timers = new Map(), sent = [], marks = [], ended = [];
  const control = createCallLifecycle({
    now: () => time, ready, busy: () => false,
    setTimer: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
    clearTimer: key => timers.delete(key),
    sendXai: event => sent.push(event), sendMark: mark => marks.push(mark),
    endCall: reason => ended.push(reason),
  });
  if (start) control.start();
  function advance(ms) {
    const target = time + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = target;
  }
  function tool(name, args, callId = `call-${++id}`) {
    control.handle({ name, arguments: JSON.stringify(args), call_id: callId });
  }
  function audio(seconds = 1) { control.audio(Buffer.alloc(seconds * 8000, 255).toString('base64')); }
  return { control, advance, tool, audio, timers, sent, marks, ended };
}

test('silent outbound line gets one check-in and ends despite assistant responses', () => {
  const h = harness();
  h.advance(20_000);
  assert.equal(h.sent.filter(x => x.type === 'response.create').length, 1);
  h.control.responseCreated(); h.audio(); h.control.responseDone('completed');
  h.advance(10_000);
  h.control.responseCreated(); h.audio(); h.control.responseDone('completed');
  h.advance(15_000);
  assert.deepEqual(h.ended, ['no_response_timeout']);
  assert.equal(h.sent.filter(x => x.type === 'response.create').length, 1);
  assert.equal(h.timers.size, 0);
});

test('remote speech resets silence, and long speech is not mistaken for silence', () => {
  const h = harness(); h.advance(19_000); h.control.speechStarted();
  h.advance(100_000); assert.equal(h.sent.length, 0); assert.equal(h.ended.length, 0);
  h.control.speechStopped(); h.advance(19_000); assert.equal(h.sent.length, 0);
  h.advance(1000); assert.equal(h.sent.at(-1).type, 'response.create');
});

test('menus and hold get longer silence allowance with no check-ins', () => {
  const h = harness(); h.tool('set_call_state', { state: 'automated' });
  h.advance(179_000); assert.equal(h.ended.length, 0);
  assert.equal(h.sent.filter(x => x.type === 'response.create').length, 0);
  h.advance(1000); assert.deepEqual(h.ended, ['no_response_timeout']);
});

test('voicemail greeting waits; recording generates one message and hangs up after playback', () => {
  const h = harness(); h.control.responseCreated();
  h.tool('set_call_state', { state: 'voicemail_greeting' });
  h.control.responseDone('completed'); h.advance(25_000);
  assert.equal(h.sent.filter(x => x.type === 'response.create').length, 0);
  h.control.responseCreated(); h.tool('set_call_state', { state: 'voicemail_recording' });
  h.control.responseDone('completed');
  assert.equal(h.sent.filter(x => x.type === 'response.create').length, 1);
  h.control.responseCreated(); h.audio(25); h.control.responseDone('completed');
  assert.equal(h.ended.length, 0);
  h.control.onMark('unrelated'); assert.equal(h.ended.length, 0);
  h.advance(25_000); h.control.onMark(h.marks.at(-1));
  assert.deepEqual(h.ended, ['voicemail_message_complete']);
  h.control.onMark(h.marks.at(-1)); assert.equal(h.ended.length, 1);
});

test('end_call waits for response completion and final Twilio mark, and is idempotent', () => {
  const h = harness(); h.control.responseCreated(); h.audio(20);
  h.tool('end_call', { reason: 'voicemail_left' }, 'same');
  h.tool('end_call', { reason: 'voicemail_left' }, 'same');
  assert.equal(h.ended.length, 0); assert.equal(h.sent.length, 1);
  h.control.responseDone('completed'); assert.equal(h.ended.length, 0);
  h.control.onMark(h.marks.at(-1)); assert.deepEqual(h.ended, ['voicemail_left']);
});

test('audio preceding the recording-state tool is not repeated', () => {
  const h = harness(); h.control.responseCreated(); h.audio(20);
  h.tool('set_call_state', { state: 'voicemail_recording' });
  h.control.responseDone('completed');
  assert.equal(h.sent.filter(x => x.type === 'response.create').length, 0);
  h.control.onMark(h.marks.at(-1));
  assert.deepEqual(h.ended, ['voicemail_message_complete']);
});

test('tool-only human and menu classifications resume once without replacing the preset', () => {
  for (const state of ['human', 'automated']) {
    const h = harness(); h.control.responseCreated(); h.tool('set_call_state', { state });
    h.control.responseDone('completed');
    assert.equal(h.sent.filter(x => x.type === 'response.create').length, 1);
    assert.equal(h.sent.at(-1).response, undefined);
    assert.equal(h.sent.at(-2).item.type, 'message');
    h.control.responseCreated(); h.tool('set_call_state', { state }); h.control.responseDone('completed');
    assert.equal(h.sent.filter(x => x.type === 'response.create').length, 1);
  }
});

test('missing playback acknowledgment uses audio duration plus grace', () => {
  const h = harness(); h.control.responseCreated(); h.audio(25);
  h.tool('end_call', { reason: 'voicemail_left' }); h.control.responseDone('completed');
  h.advance(27_000); assert.equal(h.ended.length, 0);
  h.advance(1000); assert.deepEqual(h.ended, ['voicemail_left']);
});

test('existing goodbye-loop protection also waits for queued speech', () => {
  const h = harness(); h.control.responseCreated(); h.audio(10);
  h.control.responseDone('completed');
  h.control.endAfterPlayback('goodbye_loop_threshold');
  assert.equal(h.ended.length, 0);
  h.control.onMark(h.marks.at(-1));
  assert.deepEqual(h.ended, ['goodbye_loop_threshold']);
});

test('interruption and clear invalidate pending hangup and flushed marks', () => {
  const h = harness(); h.control.responseCreated(); h.audio(25);
  h.tool('end_call', { reason: 'conversation_complete' }); h.control.responseDone('completed');
  const flushed = h.marks.at(-1);
  h.control.speechStarted(); h.control.clear(); h.control.onMark(flushed);
  h.advance(30_000); assert.equal(h.ended.length, 0);
});

test('cancelled or failed voicemail response is not marked delivered', () => {
  for (const status of ['cancelled', 'failed', 'incomplete']) {
    const h = harness(); h.control.responseCreated();
    h.tool('set_call_state', { state: 'voicemail_recording' }); h.audio();
    h.tool('end_call', { reason: 'voicemail_left' }); h.control.responseDone(status);
    h.advance(5000); assert.equal(h.ended.length, 0); assert.equal(h.marks.length, 0);
    h.control.close();
  }
});

test('voicemail timeout cannot be extended by repeated state calls or background speech', () => {
  const h = harness(); h.tool('set_call_state', { state: 'voicemail_greeting' });
  h.advance(60_000); h.control.speechStarted();
  h.tool('set_call_state', { state: 'voicemail_greeting' }); h.advance(30_000);
  assert.deepEqual(h.ended, ['voicemail_timeout']);
});

test('live person returning from voicemail cancels its deadline', () => {
  const h = harness(); h.tool('set_call_state', { state: 'voicemail_greeting' });
  h.advance(60_000); h.control.speechStarted(); h.tool('set_call_state', { state: 'human' });
  h.advance(60_000); assert.equal(h.ended.length, 0);
});

test('full mailbox can end without speech; malformed and premature silence calls cannot', () => {
  const h = harness();
  for (const args of [{ reason: 'wrong' }, { reason: 'voicemail_left', other: 1 }, null]) h.tool('end_call', args);
  h.control.handle({ name: 'end_call', arguments: '{', call_id: 'bad' });
  h.tool('end_call', { reason: 'no_response' });
  assert.equal(h.ended.length, 0);
  h.control.responseCreated(); h.tool('end_call', { reason: 'cannot_leave_message' });
  h.control.responseDone('completed'); assert.deepEqual(h.ended, ['cannot_leave_message']);
});

test('stalled response and lost marks cannot keep an ending call open forever', () => {
  const h = harness(); h.control.responseCreated();
  h.tool('end_call', { reason: 'conversation_complete' });
  h.advance(60_000); assert.deepEqual(h.ended, ['conversation_complete']);
});

test('inactive/inbound lifecycle emits no marks or timers; close disposes timers', () => {
  const h = harness({ start: false, ready: () => false });
  h.control.responseCreated(); h.audio(); h.control.responseDone('completed');
  h.tool('end_call', { reason: 'conversation_complete' }); h.advance(200_000);
  assert.equal(h.sent.length + h.marks.length + h.ended.length + h.timers.size, 0);
  const active = harness(); active.control.close(); active.advance(200_000);
  assert.equal(active.timers.size + active.ended.length, 0);
});
