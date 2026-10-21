import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createFairCallQueue } from './call-queue.js';
import { evaluateIncomingCallAdmission } from './call-admission.js';

// Exercise the production coordinator and dispatch functions without opening
// sockets, spending prepaid time, or placing real Twilio calls.
function harness({ maxConcurrent = 1, guard = async () => {} } = {}) {
  const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const sessions = new Map(), activeLines = new Map(), pairedIncomingLines = new Map(), dialed = [], jobs = [];
  let queries = 0, claims = 0, id = 0;
  const noop = () => {};
  const actor = {
    markReservationStarted: async () => ({ ok: true }),
    cancelCallReservation: async () => ({ ok: true }),
    agentHasPendingCallsForServer: async () => { queries++; return jobs.length > 0; },
    claimNextAgentCallForServer: async () => { claims++; return jobs.length ? [jobs.shift()] : []; },
    listOpenCallReservationsForServer: async () => [],
    completeAgentCallDispatchForServer: async () => true,
    failAgentCallDispatchForServer: async () => true,
  };
  const callQueue = createFairCallQueue({ getSession: key => sessions.get(key) });
  const client = { calls: Object.assign(() => ({ update: async () => {} }), {
    create: async data => { dialed.push(data.to); return { sid: `CA${String(++id).padStart(32, '0')}` }; },
  }) };
  const context = vm.createContext({
    queueProcessing: false, dispatchCoordinatorProcessing: false,
    nextDispatchSource: 'direct', agentCallPollProcessing: false,
    CALL_MAX_CONCURRENT: maxConcurrent, CALL_QUEUE_MAX_WAIT_MS: 1800000,
    callSessions: sessions, activeLineSessions: activeLines, callsBySid: new Map(),
    pairedIncomingLineSessions: pairedIncomingLines, evaluateIncomingCallAdmission,
    callQueue, lineRotationCursor: 0, agentDispatchReservations: new Set(),
    agentCallDispatchCache: new Map(), PORT: 3000,
    process: { env: { BACKEND_CANISTER_ID: 'test' } },
    getConfiguredTwilioLineNumbers: async () => ['+12025550100', '+12025550101'],
    getBackendActor: async () => actor, twilioClient: client,
    assertAllowedDestination: noop, BLOCKED_OUTBOUND_NUMBERS: [],
    assertSafeInstructionText: noop, assertProfitableDestination: guard,
    okOrThrow: result => result.ok, normalizeReservation: value => value,
    unwrapOptional: value => value[0], normalizeAgentCallJob: value => value,
    getValidCallSid: value => value || '', dispatchFailureMessage: payload => payload.error,
    log: noop, broadcastMonitorEvent: noop,
    setTimeout: () => ({ unref: noop }),
    fetch: async (_url, options) => {
      const input = JSON.parse(options.body);
      const session = add(`agent-${input.callId}`, 'connector', true);
      await context.dispatchQueuedSessions(session.id);
      return { ok: true, json: async () => ({ ok: true, callSid: session.callSid, sessionId: session.id }) };
    },
  });
  vm.runInContext(source.slice(source.indexOf('function getQueuedSessionIds()'), source.indexOf('app.get("/health"')), context);
  vm.runInContext(source.slice(source.indexOf('async function dispatchPendingAgentCallJobs()'), source.indexOf('function scheduleAgentCallPoll(')), context);
  function add(phone, userId, agentDispatch = false) {
    const session = { id: `session-${++id}`, reservationId: `reservation-${id}`,
      userId, recipientPhone: phone, preset: {}, allowedSeconds: 60,
      direction: 'outbound',
      agentDispatch, createdAt: Date.now(), queueEnteredAt: Date.now() };
    sessions.set(session.id, session); context.enqueueCallSession(session); return session;
  }
  function addJob(callId) {
    jobs.push({ job: { id: `job-${callId}`, callId, reservationId: `agent-reservation-${callId}`, captureOptions: {} }, callToken: 'test-token' });
  }
  function release() {
    const session = sessions.get(activeLines.values().next().value);
    session.finished = true; context.releaseSessionLine(session);
  }
  return { context, add, addJob, release, sessions, activeLines, pairedIncomingLines, dialed, counts: () => ({ queries, claims }) };
}

test('direct and connector callers alternate turns even when a direct account has a backlog', async () => {
  const h = harness(); h.add('direct-1', 'browser'); h.add('direct-2', 'browser');
  h.addJob('1'); h.addJob('2');
  for (let i = 0; i < 4; i++) {
    await h.context.dispatchAvailableCalls();
    assert.equal(h.activeLines.size, 1);
    if (i < 3) h.release();
  }
  assert.deepEqual(h.dialed, ['direct-1', 'agent-1', 'direct-2', 'agent-2']);
  assert.deepEqual(h.counts(), { queries: 2, claims: 2 });
});

test('a full server neither claims prepaid jobs nor queries the canister', async () => {
  const h = harness(); h.add('direct-1', 'browser'); h.addJob('1');
  await h.context.dispatchAvailableCalls();
  await Promise.all([h.context.dispatchAvailableCalls(), h.context.dispatchAvailableCalls()]);
  assert.equal(h.dialed.length, 1); assert.deepEqual(h.counts(), { queries: 0, claims: 0 });
});

test('concurrent coordinator requests respect the global cap across multiple free lines', async () => {
  const h = harness(); h.add('direct-1', 'browser'); h.add('direct-2', 'other'); h.addJob('1');
  await Promise.all([h.context.dispatchAvailableCalls(), h.context.dispatchAvailableCalls()]);
  assert.equal(h.activeLines.size, 1); assert.equal(h.dialed.length, 1);
});

test('carrier pricing rejection releases capacity and lets the next queued caller proceed', async () => {
  const h = harness({ guard: async destination => {
    if (destination === 'expensive') throw Object.assign(new Error('Rate too high'), { code: 'DESTINATION_RATE_EXCEEDED' });
  } });
  const rejected = h.add('expensive', 'browser'); h.add('affordable', 'other');
  await h.context.dispatchAvailableCalls();
  assert.deepEqual(h.dialed, ['affordable']); assert.equal(h.activeLines.size, 1);
  assert.equal(rejected.dispatchError.code, 'DESTINATION_RATE_EXCEEDED');
  assert.equal(rejected.finished, true);
});

test('an already-claimed connector call gets its turn before another IC claim', async () => {
  const h = harness(); h.context.nextDispatchSource = 'agent';
  h.add('already-claimed', 'connector', true); h.addJob('new');
  await h.context.dispatchAvailableCalls();
  assert.deepEqual(h.dialed, ['already-claimed']);
  assert.deepEqual(h.counts(), { queries: 0, claims: 0 });
});

test('a stop request during the carrier lookup prevents the outbound dial', async () => {
  const h = harness({ guard: async () => {
    for (const session of h.sessions.values()) session.finished = true;
    h.activeLines.clear();
  } });
  const canceled = h.add('canceled-before-dial', 'browser');
  await h.context.dispatchAvailableCalls();
  assert.deepEqual(h.dialed, []);
  assert.equal(canceled.dispatchError.code, 'CALL_CANCELED_BEFORE_DIAL');
  assert.equal(h.activeLines.size, 0);
});

test('raising host capacity still alternates sources and respects its exact limit', async () => {
  const h = harness({ maxConcurrent: 2 });
  h.add('direct-1', 'browser'); h.add('direct-2', 'other'); h.addJob('1'); h.addJob('2');
  await h.context.dispatchAvailableCalls();
  assert.deepEqual(h.dialed, ['direct-1', 'agent-1']);
  assert.equal(h.activeLines.size, 2); assert.equal(h.counts().claims, 1);
});

test('a paid self-call companion uses a separate lock even when both legs share a phone number', async () => {
  const h = harness();
  const outgoing = h.add('+12025550100', 'same-owner');
  await h.context.dispatchAvailableCalls();
  const incoming = { id: 'incoming', lineNumber: outgoing.lineNumber, direction: 'inbound' };
  h.sessions.set(incoming.id, incoming);
  const admission = h.context.getIncomingCallAdmission(outgoing.recipientPhone,
    outgoing.lineNumber, `CA${'a'.repeat(32)}`, 'same-owner', true);
  assert.equal(admission.allowed, true);
  h.context.assignIncomingLineToSession(incoming, incoming.lineNumber, admission);
  assert.equal(h.context.getActiveCallCount(), 2);
  assert.equal(h.activeLines.get(outgoing.lineNumber), outgoing.id);
  assert.equal(h.pairedIncomingLines.get(incoming.lineNumber), incoming.id);
  h.context.releaseSessionLine(incoming);
  assert.equal(h.context.getActiveCallCount(), 1);
  assert.equal(h.activeLines.get(outgoing.lineNumber), outgoing.id);
  assert.equal(outgoing.pairedIncomingSessionId, undefined);
});

test('an incoming companion keeps the queue and IC claims blocked after its outbound leg ends first', async () => {
  const h = harness();
  const outgoing = h.add('+12025550101', 'same-owner');
  await h.context.dispatchAvailableCalls();
  const incoming = { id: 'incoming', lineNumber: outgoing.recipientPhone, direction: 'inbound' };
  h.sessions.set(incoming.id, incoming);
  const admission = h.context.getIncomingCallAdmission(outgoing.recipientPhone,
    outgoing.lineNumber, `CA${'b'.repeat(32)}`, 'same-owner', true);
  h.context.assignIncomingLineToSession(incoming, incoming.lineNumber, admission);
  h.release();
  h.add('next-caller', 'other-owner'); h.addJob('next-job');
  await h.context.dispatchAvailableCalls();
  assert.equal(h.context.getActiveCallCount(), 1);
  assert.deepEqual(h.dialed, ['+12025550101']);
  assert.deepEqual(h.counts(), { queries: 0, claims: 0 });
  h.context.releaseSessionLine(incoming);
  await h.context.dispatchAvailableCalls();
  assert.equal(h.context.getActiveCallCount(), 1);
  assert.equal(h.dialed.length, 2);
});
