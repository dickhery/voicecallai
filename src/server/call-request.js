// These flags authorize customer-selected storage. They do not establish
// another participant's agreement or waive required notice/permissions.
export const CALL_REQUEST_VERSION = '2026-10-11';

export function normalizeCaptureOptions(input = {}) {
  const saveTranscript = Boolean(input.saveTranscript);
  const recordAudio = Boolean(input.recordAudio);
  const permissionConfirmed = Boolean(input.permissionConfirmed);
  if ((saveTranscript || recordAudio) && !permissionConfirmed) {
    const error = new Error('Customer authorization is required for the selected transcript or recording settings. This flag does not establish recipient consent.');
    error.code = 'CAPTURE_AUTHORIZATION_REQUIRED';
    throw error;
  }
  return { saveTranscript, recordAudio, permissionConfirmed };
}

export function callFailurePayload(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
    ? error.code : 'BRIDGE_CALL_FAILED';
  return {
    ok: false,
    code,
    error: String(error?.message || 'Voice bridge could not place the call.').slice(0, 500),
    ...(typeof error?.category === 'string' ? { category: error.category.slice(0, 80) } : {}),
  };
}

// Keep the existing Candid job-error field compatible, but preserve a stable
// reason code so an assistant can distinguish app rejection from its own refusal.
export function dispatchFailureMessage(payload = {}, status = 400) {
  const failure = callFailurePayload({ code: payload.code, message: payload.error });
  const message = payload.error ? failure.error : `Voice server rejected the agent call with HTTP ${status}.`;
  return `${failure.code}: ${message}`.slice(0, 500);
}
