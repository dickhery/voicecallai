// xAI transcripts describe generated speech, not audio the telephone played.
// A Twilio mark acknowledges playback unless we cleared that buffer first.
// Keep only full, completed, acknowledged assistant turns in the transcript.
export function createResponseDelivery({ sendMark, onDelivered, onUnconfirmed = () => {} }) {
  const pending = new Map();
  let active = null;
  let sequence = 0;
  let closed = false;

  function discard(turn, reason) {
    if (!turn || turn.settled) return;
    turn.settled = true;
    if (turn.mark) pending.delete(turn.mark);
    if (turn.audioBytes || turn.suppressedBytes || turn.text) {
      onUnconfirmed({ reason, audioBytes: turn.audioBytes, suppressedBytes: turn.suppressedBytes });
    }
  }

  return {
    begin(responseId = '') {
      if (closed) return;
      if (active) discard(active, 'response_replaced');
      active = { responseId, text: '', audioBytes: 0, suppressedBytes: 0, settled: false, mark: null };
    },
    transcript(text) {
      if (!closed && active && !active.settled && typeof text === 'string') {
        // Bound memory even if the provider sends pathological deltas.
        if (active.text.length + text.length > 24_000) discard(active, 'transcript_limit');
        else active.text += text;
      }
    },
    audio(bytes, admitted) {
      if (closed || !active || active.settled) return;
      if (admitted) active.audioBytes += bytes;
      else active.suppressedBytes += bytes;
    },
    done(responseId, status) {
      if (closed || !active || (responseId && active.responseId && responseId !== active.responseId)) return;
      const turn = active;
      active = null;
      if (turn.settled) return;
      if (status !== 'completed' || !turn.audioBytes || turn.suppressedBytes) {
        discard(turn, status !== 'completed' ? `response_${status || 'unknown'}` : 'audio_not_fully_sent');
        return;
      }
      if (pending.size >= 32) discard(pending.values().next().value, 'playback_ack_limit');
      turn.mark = `transcript-played-${++sequence}`;
      pending.set(turn.mark, turn);
      if (sendMark(turn.mark) === false) discard(turn, 'media_unavailable');
    },
    onMark(name) {
      const turn = pending.get(name);
      if (!turn || turn.settled || closed) return;
      pending.delete(name);
      turn.settled = true;
      onDelivered(turn.text, { audioBytes: turn.audioBytes });
    },
    clear() {
      // Twilio echoes pending marks after clear; those ACKs are not playback.
      discard(active, 'playback_cleared');
      for (const turn of pending.values()) discard(turn, 'playback_cleared');
      pending.clear();
    },
    close() {
      if (closed) return;
      discard(active, 'media_closed');
      for (const turn of pending.values()) discard(turn, 'media_closed');
      pending.clear();
      active = null;
      closed = true;
    },
  };
}
