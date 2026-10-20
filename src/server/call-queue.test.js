import test from 'node:test';
import assert from 'node:assert/strict';
import { createFairCallQueue, boundedPositiveInteger } from './call-queue.js';

function harness(options = {}) {
  const sessions = new Map();
  const queue = createFairCallQueue({ getSession: id => sessions.get(id), ...options });
  const add = (id, userId) => {
    const session = { id, userId, state: 'created' };
    sessions.set(id, session); queue.enqueue(session); return session;
  };
  const next = () => {
    const session = sessions.get(queue.ids()[0]);
    queue.dispatched(session); session.state = 'active'; return session.id;
  };
  return { sessions, queue, add, next };
}

test('one large account cannot monopolize the queue; each owner retains FIFO', () => {
  const h = harness();
  for (const id of ['a1', 'a2', 'a3', 'a4']) h.add(id, 'a');
  h.add('b1', 'b'); h.add('b2', 'b'); h.add('c1', 'c');
  assert.deepEqual(Array.from({ length: 7 }, h.next), ['a1', 'b1', 'c1', 'a2', 'b2', 'a3', 'a4']);
});

test('a newly waiting owner takes the next turn after the current owner', () => {
  const h = harness(); h.add('a1', 'a'); assert.equal(h.next(), 'a1');
  h.add('a2', 'a'); h.add('b1', 'b');
  assert.equal(h.next(), 'b1'); assert.equal(h.next(), 'a2');
});

test('per-owner and total bounds reject additions without leaking queue entries', () => {
  const h = harness({ maxPending: 3, maxPerUser: 2 });
  h.add('a1', 'a'); h.add('a2', 'a');
  assert.throws(() => h.add('a3', 'a'), { code: 'BRIDGE_QUEUE_FULL' });
  h.add('b1', 'b'); assert.throws(() => h.add('c1', 'c'), { code: 'BRIDGE_QUEUE_FULL' });
  h.sessions.get('a1').finished = true;
  h.add('c2', 'c'); assert.equal(h.queue.ids().length, 3);
});

test('cancelled and missing sessions are pruned, duplicate insertion is harmless', () => {
  const h = harness(); const a = h.add('a1', 'a'); h.queue.enqueue(a);
  h.add('b1', 'b'); h.sessions.delete('b1'); assert.deepEqual(h.queue.ids(), ['a1']);
  h.queue.remove('a1'); assert.deepEqual(h.queue.ids(), []);
});

test('invalid resource settings fail conservatively to bounded defaults', () => {
  for (const invalid of [undefined, '', 'NaN', 'Infinity', '0', '-1', '1.5', '101']) {
    assert.equal(boundedPositiveInteger(invalid, 1, 100), 1);
  }
  assert.equal(boundedPositiveInteger('4', 1, 100), 4);
});
