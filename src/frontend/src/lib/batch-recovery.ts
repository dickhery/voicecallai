/** Browser-only recovery metadata. Never persist phone numbers or call prompts. */
export interface PendingBatchRequest {
  idempotencyKey: string;
  fingerprint: string;
  createdAt: number;
}

const STORAGE_PREFIX = "voicecall.pendingBatch:";
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export async function fingerprintBatchIntent(intent: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(intent),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function getRecoveryStorage(): RecoveryStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPendingBatch(
  storage: RecoveryStorage | null,
  principal: string,
): PendingBatchRequest | null {
  if (!storage || !principal) return null;
  try {
    const value = JSON.parse(
      storage.getItem(`${STORAGE_PREFIX}${principal}`) ?? "null",
    ) as Partial<PendingBatchRequest> | null;
    if (
      !value ||
      typeof value.idempotencyKey !== "string" ||
      !/^web-batch-[a-zA-Z0-9-]{1,80}$/.test(value.idempotencyKey) ||
      typeof value.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt <= 0
    )
      return null;
    return value as PendingBatchRequest;
  } catch {
    return null;
  }
}

export function savePendingBatch(
  storage: RecoveryStorage | null,
  principal: string,
  request: PendingBatchRequest,
): boolean {
  if (!storage || !principal) return false;
  try {
    // A different unresolved request needs an explicit new-intent action first.
    const existing = readPendingBatch(storage, principal);
    if (
      existing &&
      (existing.idempotencyKey !== request.idempotencyKey ||
        existing.fingerprint !== request.fingerprint)
    )
      return false;
    storage.setItem(`${STORAGE_PREFIX}${principal}`, JSON.stringify(request));
    const saved = readPendingBatch(storage, principal);
    return (
      saved?.idempotencyKey === request.idempotencyKey &&
      saved.fingerprint === request.fingerprint
    );
  } catch {
    return false;
  }
}

export function clearPendingBatch(
  storage: RecoveryStorage | null,
  principal: string,
  key: string,
): boolean {
  if (!storage || !principal) return false;
  try {
    const existing = readPendingBatch(storage, principal);
    if (existing?.idempotencyKey !== key) return !existing;
    storage.removeItem(`${STORAGE_PREFIX}${principal}`);
    return !readPendingBatch(storage, principal);
  } catch {
    return false;
  }
}
