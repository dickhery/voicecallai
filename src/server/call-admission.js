// A call to an answering preset on this same host needs two independently paid
// voice sessions. Permit one matching inbound leg without raising the ordinary
// call cap or opening another outgoing queue slot.
export const MAX_PAIRED_INCOMING_CALLS = 1;

const validCallSid = value => /^CA[a-fA-F0-9]{32}$/.test(String(value || ''));

export function evaluateIncomingCallAdmission({
  toNumber,
  fromNumber,
  callSid,
  ownerId,
  sessions,
  activeLines,
  pairedIncomingLines,
  maxConcurrent,
  signatureValidated = false,
}) {
  const occupied = activeLines.size + pairedIncomingLines.size;
  const destinationBusy = activeLines.has(toNumber) || pairedIncomingLines.has(toNumber);
  if (!destinationBusy && occupied < maxConcurrent) return { allowed: true, pairedOutboundSessionId: null };

  // Call this only after validating the Twilio request signature. The exact
  // number pair, live local reservation and distinct CallSid bind the exception
  // to an outbound call already using this host. A caller ID match alone never
  // grants an ordinary queue slot, free answering time or a recursive pairing.
  if (!signatureValidated || !validCallSid(callSid) || !toNumber || !fromNumber ||
      pairedIncomingLines.size >= MAX_PAIRED_INCOMING_CALLS ||
      occupied >= maxConcurrent + MAX_PAIRED_INCOMING_CALLS) return { allowed: false };

  const parentId = activeLines.get(fromNumber);
  const parent = sessions.get(parentId);
  if (!parent || parent.finished || parent.direction !== 'outbound' ||
      !['active', 'dialing'].includes(parent.state) || !validCallSid(parent.callSid) ||
      parent.callSid === callSid || parent.recipientPhone !== toNumber ||
      parent.lineNumber !== fromNumber || parent.pairedIncomingSessionId ||
      (ownerId !== undefined && (!ownerId || parent.userId !== ownerId))) return { allowed: false };

  // Do not share a destination line with an unrelated incoming or outgoing call.
  // Sharing the parent's own caller-ID line is safe: each leg has its own map.
  const destinationOwner = activeLines.get(toNumber);
  if (pairedIncomingLines.has(toNumber) || (destinationOwner && destinationOwner !== parentId)) {
    return { allowed: false };
  }
  return { allowed: true, pairedOutboundSessionId: parentId };
}
