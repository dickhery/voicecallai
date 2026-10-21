const TERMINAL = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);

export function advanceTransportStatus(previous, incoming) {
  const before = String(previous || '').toLowerCase();
  const after = String(incoming || '').toLowerCase();
  if (TERMINAL.has(before)) return before;
  if (TERMINAL.has(after)) return after;
  const rank = { queued: 0, initiated: 1, ringing: 2, 'in-progress': 3 };
  if (!(after in rank)) return before;
  return !(before in rank) || rank[after] >= rank[before] ? after : before;
}

export function deriveCallSessionStatus(session) {
  const transport = String(session?.lastStatus || '').toLowerCase();
  if (TERMINAL.has(transport)) return transport;
  if (session?.finished) return ['failed', 'canceled'].includes(session.state) ? session.state : 'completed';
  if (session?.billingStartedAt) return 'in-progress';
  if (['queued', 'ringing', 'initiated', 'dialing'].includes(transport)) return transport;
  if (session?.state === 'queued' || !session?.callSid) return 'queued';
  return 'dialing';
}

export function buildCallDiagnosticsInput(session, reason, bridgeVersion) {
  const media = session?.mediaDiagnostics || {};
  const nat = (value, maximum) => BigInt(Math.min(maximum, Math.max(0, Math.floor(Number(value) || 0))));
  return {
    version: 1n,
    bridgeVersion: String(bridgeVersion || '').slice(0, 80),
    transportStatus: String(session?.lastStatus || deriveCallSessionStatus(session)).slice(0, 30),
    terminationReason: String(session?.terminationReason || reason || 'unknown').slice(0, 120),
    connected: Boolean(session?.billingStartedAt),
    callerAudioBytes: nat(media.callerAudioBytes, 1_000_000_000),
    assistantAudioBytes: nat(media.assistantAudioBytes, 1_000_000_000),
    assistantSuppressedBytes: nat(media.assistantSuppressedBytes, 1_000_000_000),
    assistantConfirmedTurns: nat(media.assistantConfirmedTurns, 100_000),
    assistantUnconfirmedTurns: nat(media.assistantUnconfirmedTurns, 100_000),
  };
}

// Short, bounded, off-chain terminal snapshots let the next browser poll learn
// the real result after the paid session and all of its audio buffers are freed.
export function createTerminalSessionCache({ now = Date.now, ttlMs = 120_000, maxEntries = 200,
  tokenEqual = (a, b) => a === b } = {}) {
  const entries = new Map();
  function prune() {
    for (const [id, entry] of entries) if (entry.expiresAt <= now()) entries.delete(id);
  }
  return {
    prune,
    remember(id, token, payload) {
      prune();
      if (!id || !token || !TERMINAL.has(payload?.status)) return false;
      entries.delete(id);
      entries.set(id, { token, payload: { ...payload, liveAudio: null, liveAudioUrl: null }, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return true;
    },
    get(id, token) {
      prune();
      const entry = entries.get(id);
      return entry && token && tokenEqual(entry.token, token) ? entry.payload : null;
    },
  };
}
