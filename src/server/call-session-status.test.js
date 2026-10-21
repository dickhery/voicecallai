import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCallSessionStatus, buildCallDiagnosticsInput, createTerminalSessionCache, advanceTransportStatus } from './call-session-status.js';

test('a SID or active reservation alone is not an answered phone call', () => {
  assert.equal(deriveCallSessionStatus({ callSid: 'CA1', state: 'active' }), 'dialing');
  assert.equal(deriveCallSessionStatus({ callSid: 'CA1', state: 'active', lastStatus: 'ringing' }), 'ringing');
  assert.equal(deriveCallSessionStatus({ callSid: 'CA1', state: 'active', billingStartedAt: 123 }), 'in-progress');
});

test('terminal provider failure survives local session finalization', () => {
  for (const lastStatus of ['failed', 'busy', 'no-answer', 'canceled', 'completed']) {
    assert.equal(deriveCallSessionStatus({ finished: true, state: 'completed', lastStatus }), lastStatus);
  }
  assert.equal(deriveCallSessionStatus({ finished: true, state: 'failed' }), 'failed');
});

test('out-of-order callbacks cannot turn a terminal failure into ringing or success', () => {
  assert.equal(advanceTransportStatus('failed', 'ringing'), 'failed');
  assert.equal(advanceTransportStatus('busy', 'completed'), 'busy');
  assert.equal(advanceTransportStatus('in-progress', 'initiated'), 'in-progress');
  assert.equal(advanceTransportStatus('ringing', 'completed'), 'completed');
  assert.equal(advanceTransportStatus('', 'made-up'), '');
});

test('diagnostics distinguish generated/suppressed speech from forwarded and confirmed turns', () => {
  const value = buildCallDiagnosticsInput({ billingStartedAt: 10, lastStatus: 'completed',
    mediaDiagnostics: { assistantSuppressedBytes: 10_000, callerAudioBytes: 50_000 } }, 'remote_end', 'test');
  assert.equal(value.connected, true);
  assert.equal(value.assistantAudioBytes, 0n);
  assert.equal(value.assistantConfirmedTurns, 0n);
  assert.equal(value.assistantSuppressedBytes, 10_000n);
  assert.equal(value.terminationReason, 'remote_end');
});

test('diagnostics cap malformed counters and reason text before Candid encoding', () => {
  const value = buildCallDiagnosticsInput({ mediaDiagnostics: { callerAudioBytes: Infinity,
    assistantAudioBytes: -1, assistantConfirmedTurns: NaN } }, 'x'.repeat(1000), 'test');
  assert.equal(value.callerAudioBytes, 1_000_000_000n);
  assert.equal(value.assistantAudioBytes, 0n);
  assert.equal(value.assistantConfirmedTurns, 0n);
  assert.equal(value.terminationReason.length, 120);
});

test('terminal snapshot remains available only to its control token for a bounded time', () => {
  let time = 0;
  const cache = createTerminalSessionCache({ now: () => time, ttlMs: 100, maxEntries: 2 });
  cache.remember('s1', 'private-token', { status: 'busy', liveAudioUrl: 'old-url' });
  assert.equal(cache.get('s1', 'other'), null);
  assert.equal(cache.get('s1', 'private-token').status, 'busy');
  assert.equal(cache.get('s1', 'private-token').liveAudioUrl, null);
  time = 100;
  assert.equal(cache.get('s1', 'private-token'), null);
  cache.remember('s2', 't', { status: 'completed' });
  cache.remember('s3', 't', { status: 'completed' });
  cache.remember('s4', 't', { status: 'completed' });
  assert.equal(cache.get('s2', 't'), null);
  assert.equal(cache.remember('active', 't', { status: 'in-progress' }), false);
});
