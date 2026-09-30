# Genesis paid call checkout

Genesis buyer approval saves an immutable private plan before funding. The customer owns the
VoiceCallAI deposit subaccount, purchases missing prepaid time, and pays a separate accepted-job
organism commission. `colony_call_5` is an ICP-only $1 top-up for 300 seconds; existing larger
packages remain unchanged. `agentPurchasePhoneTimeQuoted(packageId, key, expectedPriceE8s)`
uses the displayed price as a maximum when it creates the purchase journal. A decrease can save
ICP; an increase is rejected before debit. Retried purchases always replay their original memo,
timestamp, destination, fee and amount.

Pending purchases record uncertainty before the ledger call. Later rejections, including TooOld,
cannot turn a potentially committed transfer into a definitive failure. Retry only the same key.
Unknown debits beyond ledger deduplication require verified ledger reconciliation and a reviewed
forward fix; do not create another invoice or install an old Wasm over retained payment state.

`grantColonyCall` asks the colony's `colony_confirm_call_payment` through a bounded consensus call
before issuing a grant. The colony verifies the accepted job, buyer, organism destination and
ledger-confirmed payment. If the payment matches an immutable saved approval, its original
commission is honored even after exchange-rate moves. The colony validates the $0.20 equivalent
when saving that approval, before funding. Legacy manual commissions are checked against a fresh
provider price at grant creation. New grants carry `verified-payment:<id>` until the dedicated
worker queues them. Old unused grants retain their existing worker checks.

After the async call the provider rechecks grant reuse, capacity, ownership, terms and phone time.
One commission authorizes one call. A worker cannot create buyer grants or accept its own work.
Queueing retains the existing 300-second reservation/cutoff and capture-consent checks. Carrier
and model credentials and actual dialing stay on the existing external bridge.

The Windows bridge protocol is unchanged. Pull this release, run `pnpm --dir src/server test`,
and use `scripts/update-voicecall-service.ps1` if the service runs from a separate checkout.
Update GenesisWorker from the adjacent agentsitehub repository; its `docs/WINDOWS.md` includes
full service and buyer verification instructions.

Two-canister PocketIC tests live in `../agentsitehub/src/frontend/scripts/phone-integration.test.mjs`.
They cover lost ledger responses, upgrades, approval privacy/immutability, price rejection,
pending TooOld recovery, commission quotes after rate moves, worker authorization and duplicate
queue suppression, without making a real call.

## Single buyer approval and capture

Genesis connects the authenticated phone account automatically and displays the provider terms
when needed. Its priced approval button is the buyer agreement: it accepts exactly the displayed
terms version, funds missing time, and passes selected capture authorization. New checkouts
default to recording and transcripts. A changed terms version stops before payment; saved
checkouts retain their original capture choices. No terms are accepted in a background worker.

The customer-authenticated grant now normalizes requested capture exactly as direct agent calls
already did. The authorization flag records the customer request; it does not prove another
participant agreed. Confirmed commission, accepted job, owner checks, prepaid time, emergency
filters, one-use grants and the five-minute cap still apply. Existing grant/state types are
unchanged, so no stable migration is required.

Run the updated Windows service updater: it adds only the exact Genesis browser origin to the
protected .env, preserves other configuration and credentials, and verifies the CORS header after
restart. The new local Genesis call planner is installed by that repository's worker updater.
