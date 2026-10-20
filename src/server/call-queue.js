// A bounded, in-memory queue for already-paid browser reservations. Bulk lists
// stay in the canister and contribute only one lazily claimed call at a time.
export function createFairCallQueue({ getSession, maxPending = 100, maxPerUser = 20 }) {
  let ids = [];
  let lastOwner = null;
  const owner = session => String(session.userId || session.reservationId || session.id);
  function prune() {
    ids = ids.filter(id => {
      const session = getSession(id);
      return session && !session.finished && session.state === 'queued';
    });
  }
  function ordered() {
    prune();
    const other = ids.findIndex(id => owner(getSession(id)) !== lastOwner);
    if (other <= 0) return [...ids];
    return [ids[other], ...ids.slice(0, other), ...ids.slice(other + 1)];
  }
  return {
    ids: ordered,
    enqueue(session) {
      prune();
      if (ids.includes(session.id)) return;
      const sameOwner = ids.filter(id => owner(getSession(id)) === owner(session)).length;
      if (ids.length >= maxPending || sameOwner >= maxPerUser) {
        const error = new Error('The call queue is full for this account or server. Try again after a call finishes.');
        error.code = 'BRIDGE_QUEUE_FULL';
        throw error;
      }
      session.state = 'queued';
      ids.push(session.id);
    },
    remove(id) { ids = ids.filter(value => value !== id); },
    dispatched(session) {
      lastOwner = owner(session);
      ids = ids.filter(id => id !== session.id);
      // Move every remaining call from this owner behind all other owners.
      // FIFO within an account is retained, even for a very uneven workload.
      ids = [...ids.filter(id => owner(getSession(id)) !== lastOwner),
        ...ids.filter(id => owner(getSession(id)) === lastOwner)];
    },
  };
}

export function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}
