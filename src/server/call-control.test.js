import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createTerminalSessionCache } from './call-session-status.js';

function harness() {
  const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const sessions = new Map();
  const terminal = createTerminalSessionCache();
  const updates = [];
  const context = vm.createContext({
    requireServerConfig() {}, getEndCallRequestFields: req => req.body,
    callSessions: sessions, callsBySid: new Map(), terminalSessionCache: terminal,
    isSessionControlTokenValid: (session, token) => Boolean(token && session.monitorToken === token),
    twilioClient: { calls: sid => ({ update: async value => { updates.push({ sid, value }); } }) },
    markBillingActivity: () => Date.now(), closeSessionSockets() {}, scheduleFinishPaidSession() {}, log() {},
  });
  vm.runInContext(source.slice(source.indexOf('async function endCallFromRequest('), source.indexOf('app.post("/end-call"')), context);
  async function end(body) {
    const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
    await context.endCallFromRequest({ body }, response);
    return response;
  }
  return { sessions, terminal, updates, end };
}

test('an untracked CallSid alone cannot authorize a paid provider action', async () => {
  const h = harness();
  const response = await h.end({ callSid: `CA${'1'.repeat(32)}`, sessionId: 'missing', token: '' });
  assert.equal(response.code, 404);
  assert.equal(h.updates.length, 0);
});

test('a completed session stop is idempotent only with its matching token', async () => {
  const h = harness();
  const callSid = `CA${'1'.repeat(32)}`;
  h.terminal.remember('ended', 'private', { status: 'completed', callSid });
  assert.equal((await h.end({ sessionId: 'ended', callSid, token: 'private' })).code, 200);
  assert.equal((await h.end({ sessionId: 'ended', callSid, token: 'wrong' })).code, 404);
  assert.equal(h.updates.length, 0);
});

test('an active stop still requires its token and matching CallSid', async () => {
  const h = harness();
  const callSid = `CA${'1'.repeat(32)}`;
  h.sessions.set('active', { id: 'active', callSid, monitorToken: 'private', state: 'active' });
  assert.equal((await h.end({ sessionId: 'active', callSid, token: 'wrong' })).code, 403);
  assert.equal(h.updates.length, 0);
  assert.equal((await h.end({ sessionId: 'active', callSid, token: 'private' })).code, 200);
  assert.equal(h.updates.length, 1);
});

test('a pending dispatch token cannot stop an unrelated provider call', async () => {
  const h = harness();
  h.sessions.set('pending', { id: 'pending', callSid: null, monitorToken: 'private', state: 'dialing' });
  const response = await h.end({ sessionId: 'pending', callSid: `CA${'2'.repeat(32)}`, token: 'private' });
  assert.equal(response.code, 409);
  assert.equal(h.updates.length, 0);
});
