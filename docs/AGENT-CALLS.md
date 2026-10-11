# Agent call behavior and the 2026-10-11 release

## Findings

Both projects were clean and already current with origin/main. VoiceCallAI already
normalizes an authenticated customer's selected transcript/recording flags through
`AgentLib.customerCapture`, and answering does the equivalent in ConfigLib. Genesis
already uses one priced buyer approval for its terms and capture settings. No app
method verifies recipient agreement before an ordinary lawful call.

The remaining bridge storage check used an ambiguous “Confirm permission” message.
Agent documentation also claimed that assistants must not ask consent questions and
must refuse only a short list of requests. Those statements cannot control an external
assistant and conflict with ICP MCP's requirement that metadata describe the API rather
than change assistant safety behavior. Provider and assistant policies apply separately.

## Changes

- `agentPreviewCall` is an optional authenticated query using exactly the queue input.
  It shares local validation with queue, reports existing jobs for idempotent retries,
  and returns normalized customer capture settings or the exact app prerequisite error.
  It makes no reservation, random request, ledger/XRC call or durable write. Queue
  repeats validation; provider/bridge instruction and destination checks happen later.
- API/static documentation states the actual lack of a blanket advance consent gate
  for ordinary lawful calls and distinguishes customer capture authorization from
  another participant's agreement. It retains required notice/permissions, harassment
  safeguards and honest behavior in fictional entertainment. No safety bypass is added.
- Bridge errors preserve `code` and `category`; failed MCP/colony job text retains
  the code without changing stored job layout. Selected storage without customer
  authorization reports `CAPTURE_AUTHORIZATION_REQUIRED` explicitly.
- `/health` exposes `callRequestVersion=2026-10-11` so Windows restart can be verified.
- Genesis's adapter and API fixture include preview, with Candid compatibility and
  replica/upgrade tests. Stale payment docs describing another participant's checkbox
  and a missing maximum-price purchase API are corrected.

## Cost and compatibility

No actor state schema, migrations, canisters, timers, rate-refresh rules, ledger flows,
package prices or job bounds were added or changed. The existing Motoko/core/toolchain
pins remain: the live skills describe newer versions, but these edits use compatible
existing APIs and pass the project's stable-compatibility check. The legacy asset
canisters remain in place, avoiding a destructive frontend migration.

Guide queries are cached per task, job polling retains 10–30-second backoff and ICP/USD
quotes retain the six-hour cache. Audio stays on the bridge/Twilio. Optional preview can
replace a speculative queue attempt with a read. Deployment protects a 500B reserve,
the current freezing estimate and a 200B buffer for each changed canister; Genesis's
unchanged backend/runtime are not upgraded. No top-up or real phone call is required.

## Operation

See [WINDOWS.md](WINDOWS.md) for both service updates, first-time setup, health/CORS
checks and an operator-controlled live test. The IC deployment cannot restart the
separate Windows PC. Assistant refusals before an API call cannot be fixed by app code.

## Validation

Both frontends pass type checking and production builds, including their static agent
discovery checks. The backend passes Mops checking, stable compatibility and build;
its frontend bindings were regenerated. Bridge syntax and all 39 bridge tests pass.
Genesis's 21 phone tests and three Candid adapter tests pass, including a local-replica
upgrade from the exact VoiceCallAI Wasm deployed before this release. The upgrade test
verifies query privacy, unchanged balances/history, matching queue errors, normalized
capture settings and idempotent retries. No actual phone call or payment was made.

Authoritative references:

- [ICP skills and current implementation instructions](https://skills.internetcomputer.org/llms.txt)
- [ICP MCP service discovery](https://docs.internetcomputer.org/guides/frontends/service-discoverability/)
- [ICP MCP App Operator Terms, section 6](https://internetcomputer.org/icp-mcp/app-operator-terms/)
- [Twilio acceptable use](https://www.twilio.com/en-us/legal/aup)
