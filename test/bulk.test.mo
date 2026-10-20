import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Bulk "../src/backend/lib/bulk";
import Agent "../src/backend/lib/agent";
import Billing "../src/backend/lib/billing";
import Types "../src/backend/types/agent";

let alice = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let bob = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let carol = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");
let capture = { saveTranscript = false; recordAudio = false; consentConfirmed = false };
let input : Types.AgentCallBatchInput = {
  recipientPhones = ["+15551234567", "+15551234568"];
  presetId = 1; captureOptions = capture; maxCallSeconds = 180; idempotencyKey = "test-batch-key";
};

func errorCode(candidate : Types.AgentCallBatchInput) : ?Text {
  switch (Bulk.validateInput(candidate)) { case null { null }; case (?error) { ?error.code } };
};

// Validate the complete array before any durable write, including the last row.
assert errorCode(input) == null;
assert errorCode({ input with recipientPhones = [] }) == ?"INVALID_BATCH_SIZE";
let hundred = Array.tabulate(100, func i { "+1555123" # (1000 + i).toText() });
assert errorCode({ input with recipientPhones = hundred }) == null;
assert errorCode({ input with recipientPhones = hundred.concat(["+15551239999"]) }) == ?"INVALID_BATCH_SIZE";
assert errorCode({ input with recipientPhones = ["+15551234567", "5551234568"] }) == ?"INVALID_PHONE_NUMBER";
assert errorCode({ input with recipientPhones = ["+15551234567", "+15551234567"] }) == ?"DUPLICATE_PHONE_NUMBER";
assert errorCode({ input with recipientPhones = ["+1911"] }) == ?"EMERGENCY_NUMBER_BLOCKED";
assert errorCode({ input with recipientPhones = ["+12"] }) == ?"INVALID_PHONE_NUMBER";
assert errorCode({ input with recipientPhones = ["+1234567"] }) == ?"INVALID_PHONE_NUMBER";
for (cap in [0, 1, 59, 61, 601, 3600].values()) {
  assert errorCode({ input with maxCallSeconds = cap }) == ?"INVALID_CALL_LIMIT";
};
assert errorCode({ input with maxCallSeconds = 60 }) == null;
assert errorCode({ input with maxCallSeconds = 600 }) == null;

// Round-robin does not depend on upload size or the caller's array ordering.
let owners = [carol, bob, alice];
let first = Bulk.nextOwner(owners, null) ?? { assert false; alice };
let second = Bulk.nextOwner(owners, ?first) ?? { assert false; alice };
let third = Bulk.nextOwner(owners, ?second) ?? { assert false; alice };
assert first != second and second != third and third != first;
assert Bulk.nextOwner(owners, ?third) == ?first;
assert Bulk.nextOwner([alice, alice, bob], ?alice) == ?bob;
assert Bulk.nextOwner([bob], ?bob) == ?bob;
assert Bulk.nextOwner([], ?alice) == null;

let batches = Bulk.initState();
let agent = Agent.initState();
let billing = Billing.initState();
ignore Billing.creditPhoneSeconds(billing, alice, 300);
let batch = Bulk.create(batches, alice, input);
assert billing.callReservations.size() == 0; // Upload never reserves each target.
assert Billing.getAvailableSeconds(billing, alice) == 300;
switch (Bulk.getByKey(batches, alice, input.idempotencyKey)) { case null { assert false }; case _ {} };
switch (Bulk.getByKey(batches, bob, input.idempotencyKey)) { case null {}; case _ { assert false } };
assert Bulk.matchesInput(batch, input);
assert not Bulk.matchesInput(batch, { input with maxCallSeconds = 120 });
assert not Bulk.matchesInput(batch, { input with recipientPhones = ["+15551234568"] });
assert Bulk.pendingCount(batches, ?alice) == 2;
assert Bulk.pendingCount(batches, ?bob) == 0;
assert Bulk.isRunnable(batch, true, 300, true, true);
assert not Bulk.isRunnable(batch, true, 0, true, true); // Funding pause.
assert not Bulk.isRunnable(batch, true, 179, true, true); // Full approved cap required.
assert Bulk.isRunnable(batch, true, 300, true, true); // Top-up resumes.
assert not Bulk.isRunnable(batch, false, 300, true, true); // Expired terms pause.
assert not Bulk.isRunnable(batch, true, 300, false, true); // Deleted preset pauses.
assert not Bulk.isRunnable(batch, true, 300, true, false); // Per-user job capacity.
assert not Bulk.isPendingAt(batch, batch.createdAt + Bulk.BATCH_TTL_NS);
assert Bulk.isPendingAt(batch, batch.createdAt + Bulk.BATCH_TTL_NS - 1);

// Reservation cap is enforced both initially and during server extension.
switch (Billing.createReservationCapped(billing, alice, input.recipientPhones[0], 1, 1, "private-token", ?180)) {
  case (#err(_)) { assert false };
  case (#ok(reservation)) {
    assert reservation.allowedSeconds == 180;
    assert Billing.getAvailableSeconds(billing, alice) == 120;
    switch (Billing.extendReservation(billing, reservation.id, ?180)) { case (#err(_)) {}; case _ { assert false } };

    // Internal batch keys never overwrite a singleton's retry key.
    let sameKey = "batch:acb_1:0";
    let singleton = Agent.createCallJob(agent, alice, sameKey, reservation, "private-token", capture);
    let bulkJob = Agent.createBatchCallJob(agent, alice, sameKey, reservation, "private-token", capture);
    switch (Agent.getCallJobByIdempotency(agent, alice, sameKey)) {
      case (?retried) { assert retried.id == singleton.id };
      case null { assert false };
    };
    let pending = Bulk.initState();
    Bulk.seedPendingIndex(pending, agent);
    assert pending.pendingJobIds.size() == 2;
    singleton.status := #dispatched;
    Bulk.syncPendingJob(pending, singleton);
    assert not pending.pendingJobIds.containsKey(singleton.id);
    assert pending.pendingJobIds.containsKey(bulkJob.id);
    bulkJob.status := #canceled;
    Bulk.syncPendingJob(pending, bulkJob);
    assert pending.pendingJobIds.size() == 0;
    Bulk.seedPendingIndex(pending, agent);
    assert pending.pendingJobIds.size() == 0;

    // Recover an ACK-lost active call after the preparation TTL, while a
    // never-started expired reservation cannot be reclaimed and redialed.
    let expiredReservation = { reservation with expiresAt = Time.now() - 1 };
    let recovery = Agent.createBatchCallJob(agent, alice, "recovery-key", expiredReservation, "recovery-token", capture);
    recovery.status := #claimed;
    recovery.claimedAt := ?(Time.now() - 121_000_000_000);
    assert Agent.claimCallJob(agent, recovery.id) == null;
    switch (Agent.claimRecoverableCallJob(agent, recovery.id, true)) {
      case null { assert false };
      case (?dispatch) { assert dispatch.job.id == recovery.id; assert dispatch.callToken == "recovery-token" };
    };
    ignore Billing.cancelReservation(billing, reservation.id, "test cancel");
    assert Billing.getAvailableSeconds(billing, alice) == 300;
  };
};

batch.status := #canceled;
assert not Bulk.isRunnable(batch, true, 300, true, true);
assert Bulk.pendingCount(batches, ?alice) == 0;
assert Bulk.toPublic(batch, agent).remainingCount == 0;
assert Bulk.toPublic(batch, agent).status == #canceled;

// Terms are checked at dispatch, with no background timer.
let terms = Agent.initTermsState();
assert not Agent.termsCurrent(terms, alice);
ignore Agent.acceptTerms(terms, alice);
assert Agent.termsCurrent(terms, alice);
terms.acceptances.add(alice, { version = Agent.TERMS_VERSION; acceptedAt = Time.now() - Agent.TERMS_TTL_NS });
assert not Agent.termsCurrent(terms, alice);

// Ten active batches are the per-owner retention ceiling; canceled history is
// evicted atomically when a later batch is admitted, keeping its key window bounded.
let retention = Bulk.initState();
for (i in Nat.range(0, 10)) {
  ignore Bulk.create(retention, alice, { input with idempotencyKey = "retained-" # i.toText() });
};
assert not Bulk.canRetain(retention, alice);
let oldest = Bulk.getByKey(retention, alice, "retained-0") ?? { assert false; batch };
oldest.status := #canceled;
assert Bulk.canRetain(retention, alice);
ignore Bulk.create(retention, alice, { input with idempotencyKey = "replacement-key" });
assert Bulk.listForUser(retention, agent, alice).size() == 10;
switch (Bulk.getByKey(retention, alice, "retained-0")) { case null {}; case _ { assert false } };

// Web/MCP account linking preserves already authorized pending targets and
// makes the canonical account's balance and retry-key lookup apply thereafter.
let linked = Bulk.initState();
let beforeLink = Bulk.create(linked, alice, input);
ignore Bulk.create(linked, bob, { input with idempotencyKey = "bob-original-key" });
linked.lastServedOwner := ?alice;
Bulk.mergeAccounts(linked, alice, bob);
assert Bulk.pendingCount(linked, ?alice) == 0;
assert Bulk.pendingCount(linked, ?bob) == 4;
assert linked.lastServedOwner == ?bob;
switch (Bulk.getByKey(linked, bob, input.idempotencyKey)) {
  case null { assert false };
  case (?afterLink) { assert afterLink.id == beforeLink.id; assert afterLink.user == bob; assert afterLink.nextIndex == 0 };
};
assert Bulk.listForUser(linked, agent, bob).size() == 2;

// Linking while a call is open leaves its reserve on the original principal;
// finishing and sweeping its unused time preserves funds for later batch rows.
let linkedBilling = Billing.initState();
ignore Billing.creditPhoneSeconds(linkedBilling, alice, 300);
switch (Billing.createReservationCapped(linkedBilling, alice, input.recipientPhones[0], 1, 90, "linked-token", ?180)) {
  case (#err(_)) { assert false };
  case (#ok(reservation)) {
    assert Billing.moveAvailableBalance(linkedBilling, alice, bob) == 120;
    assert Billing.getBalance(linkedBilling, alice) == 180;
    ignore Billing.finishCallAndDebit(linkedBilling, reservation.id, 60, ?"test-sid", null);
    assert Billing.moveAvailableBalance(linkedBilling, alice, bob) == 120;
    assert Billing.getBalance(linkedBilling, alice) == 0;
    assert Billing.getAvailableSeconds(linkedBilling, bob) == 240;
  };
};

// Global historical retention cannot permanently prevent new accounts from
// queueing once 1,000 terminal batches accumulate.
let global = Bulk.initState();
for (i in Nat.range(0, Bulk.MAX_GLOBAL_BATCHES)) {
  let owner = Blob.fromArray([Nat8.fromNat(i / 256), Nat8.fromNat(i % 256), 1]).fromBlob();
  let historical = Bulk.create(global, owner, input);
  historical.status := #canceled;
};
assert global.batches.size() == Bulk.MAX_GLOBAL_BATCHES;
assert Bulk.canRetain(global, bob);
ignore Bulk.create(global, bob, { input with idempotencyKey = "new-owner-key" });
assert global.batches.size() == Bulk.MAX_GLOBAL_BATCHES;
assert Bulk.pendingCount(global, ?bob) == 2;
