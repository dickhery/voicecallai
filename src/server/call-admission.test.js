import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { evaluateIncomingCallAdmission } from './call-admission.js';

function harness({ sameNumber = false, maxConcurrent = 1 } = {}) {
  const fromNumber = '+12025550100';
  const toNumber = sameNumber ? fromNumber : '+12025550101';
  const parent = { id: 'outbound', direction: 'outbound', state: 'active',
    lineNumber: fromNumber, recipientPhone: toNumber, userId: 'owner',
    callSid: `CA${'1'.repeat(32)}` };
  const input = { toNumber, fromNumber, callSid: `CA${'2'.repeat(32)}`,
    ownerId: 'owner', signatureValidated: true, maxConcurrent, sessions: new Map([[parent.id, parent]]),
    activeLines: new Map([[fromNumber, parent.id]]), pairedIncomingLines: new Map() };
  return { input, parent, evaluate: overrides => evaluateIncomingCallAdmission({ ...input, ...overrides }) };
}

test('ordinary incoming calls use only an available normal slot', () => {
  const h = harness();
  h.input.activeLines.clear();
  assert.deepEqual(h.evaluate(), { allowed: true, pairedOutboundSessionId: null });
  h.input.activeLines.set(h.input.toNumber, 'unrelated');
  assert.equal(h.evaluate().allowed, false);
});

test('a same-owner outbound self-call admits exactly its distinct incoming leg', () => {
  for (const sameNumber of [false, true]) {
    const h = harness({ sameNumber });
    assert.deepEqual(h.evaluate(), { allowed: true, pairedOutboundSessionId: 'outbound' });
    assert.equal(h.evaluate({ callSid: h.parent.callSid }).allowed, false);
  }
});

test('caller ID alone, another destination, owner, or CallSid cannot obtain a companion slot', () => {
  const h = harness();
  for (const override of [
    { fromNumber: '+12025550999' }, { toNumber: '+12025550999' },
    { ownerId: 'other-owner' }, { ownerId: '' }, { callSid: 'invalid' },
    { signatureValidated: false }, { signatureValidated: undefined },
  ]) assert.equal(h.evaluate(override).allowed, false);
});

test('only a live locally reserved outgoing call may have a companion', () => {
  for (const change of [
    { direction: 'inbound' }, { state: 'queued' }, { finished: true },
    { callSid: null }, { lineNumber: '+12025550999' }, { pairedIncomingSessionId: 'existing' },
  ]) {
    const h = harness(); Object.assign(h.parent, change);
    assert.equal(h.evaluate().allowed, false);
  }
  const h = harness(); h.input.sessions.clear();
  assert.equal(h.evaluate().allowed, false);
});

test('one companion globally bounds simultaneous callbacks and prevents recursion', () => {
  const h = harness({ maxConcurrent: 2 });
  h.input.activeLines.set('+12025550300', 'another-outbound');
  h.input.pairedIncomingLines.set('+12025550400', 'another-companion');
  assert.equal(h.evaluate().allowed, false);
  h.input.pairedIncomingLines.clear();
  assert.equal(h.evaluate().allowed, true);
  h.input.pairedIncomingLines.set(h.input.toNumber, 'accepted-companion');
  assert.equal(h.evaluate().allowed, false);
});

test('the companion exception never steals a destination held by an unrelated session', () => {
  const h = harness();
  h.input.activeLines.set(h.input.toNumber, 'unrelated');
  assert.equal(h.evaluate().allowed, false);
});

test('admission must be rechecked after awaits because the caller may finish', () => {
  const h = harness();
  assert.equal(h.evaluate().allowed, true);
  h.parent.finished = true;
  assert.equal(h.evaluate().allowed, false);
});

test('strict Twilio authentication cannot inherit the ordinary local-development signature bypass', () => {
  const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    process: { env: { VALIDATE_TWILIO_SIGNATURE: 'false', TWILIO_AUTH_TOKEN: 'test-only' } },
    twilioRequestUrlCandidates: () => ['https://voice.example/answering/incoming/test'],
    twilio: { validateRequest: (_token, signature) => signature === 'valid-signature' },
  });
  vm.runInContext(source.slice(source.indexOf('function validateTwilioRequest('),
    source.indexOf('function makeErrorTwiML(')), context);
  const unsigned = { get: () => undefined, body: {} };
  const signed = { get: () => 'valid-signature', body: {} };
  assert.equal(context.validateTwilioRequest(unsigned), true);
  assert.equal(context.validateTwilioRequest(unsigned, { required: true }), false);
  assert.equal(context.validateTwilioRequest(signed, { required: true }), true);
  context.process.env.VALIDATE_TWILIO_SIGNATURE = 'true';
  assert.equal(context.validateTwilioRequest(unsigned), false);
});
