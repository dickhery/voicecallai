export interface CallSessionStatusSnapshot {
  callSid?: string;
  queued?: boolean;
  status?: string;
  billingStartedAt?: number | null;
}

export type CallSessionPhase =
  | "queued"
  | "connecting"
  | "in_call"
  | "completed"
  | "error";

const FAILED_STATUSES = new Set(["failed", "busy", "no-answer"]);
const ENDED_STATUSES = new Set(["completed", "canceled", "cancelled"]);

/** A carrier call ID means dispatch, not an answered call or a working audio path. */
export function getCallSessionPhase(
  snapshot: CallSessionStatusSnapshot,
): CallSessionPhase {
  const status = String(snapshot.status || "").toLowerCase();
  if (FAILED_STATUSES.has(status)) return "error";
  if (ENDED_STATUSES.has(status)) return "completed";
  if (snapshot.queued || !snapshot.callSid) return "queued";
  if (
    Number(snapshot.billingStartedAt) > 0 ||
    ["in-progress", "in_call", "connected"].includes(status)
  )
    return "in_call";
  return "connecting";
}

export function getCallFailureMessage(status?: string): string {
  switch (String(status || "").toLowerCase()) {
    case "busy":
      return "The destination was busy. No conversation was confirmed.";
    case "no-answer":
      return "The destination did not answer. No conversation was confirmed.";
    default:
      return "The phone service reported that this call failed. Review Call History for saved details.";
  }
}
