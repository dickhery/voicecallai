import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCaptureOptions, callFailurePayload, dispatchFailureMessage } from './call-request.js';

test('no capture needs no storage authorization; authorized capture preserves selections', () => {
  assert.deepEqual(normalizeCaptureOptions(), { saveTranscript: false, recordAudio: false, permissionConfirmed: false });
  for (const flags of [{ saveTranscript: true }, { recordAudio: true }, { saveTranscript: true, recordAudio: true }]) {
    assert.throws(() => normalizeCaptureOptions(flags), { code: 'CAPTURE_AUTHORIZATION_REQUIRED' });
    assert.deepEqual(normalizeCaptureOptions({ ...flags, permissionConfirmed: true }), {
      saveTranscript: Boolean(flags.saveTranscript), recordAudio: Boolean(flags.recordAudio), permissionConfirmed: true,
    });
  }
});

test('dispatch errors preserve app codes and categories without serializing provider internals', () => {
  const failure = callFailurePayload({ code: 'SAFETY_BLOCKED', category: 'false emergency reports', message: 'Preset rejected.', secret: 'private-provider-value' });
  assert.deepEqual(failure, { ok: false, code: 'SAFETY_BLOCKED', category: 'false emergency reports', error: 'Preset rejected.' });
  assert.equal(dispatchFailureMessage(failure), 'SAFETY_BLOCKED: Preset rejected.');
  assert.equal(dispatchFailureMessage({}, 503), 'BRIDGE_CALL_FAILED: Voice server rejected the agent call with HTTP 503.');
  assert.equal(callFailurePayload({ code: 21211, message: 'Invalid provider destination' }).code, 'BRIDGE_CALL_FAILED');
  assert.ok(dispatchFailureMessage({ code: 'CAPTURE_AUTHORIZATION_REQUIRED', error: 'x'.repeat(600) }).length <= 500);
});
