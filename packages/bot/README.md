# Hosted bot operation

This is an unreleased prototype. Unit fixtures are not evidence that mainnet, Enoki or provider connectors are configured. Do not fund fixture identities. No deployment or real key provisioning is part of the local checks.

## Roles and startup

Build the repository-root Docker context with `packages/bot/Dockerfile`. Connect/OAuth/MCP HTTP handlers and the fenced actor runtime share one trusted backend. Compromise of this backend is full authority over its hosted wallets. Application encryption protects persisted records at rest, not a compromised running service.

The application supports multiple processes under the [hosted actor law](../../ARCHITECTURE.md#authentication). Durable address leases retain sticky ownership and fencing; observation reads reach the current owner through Redis pub/sub. Each process needs an acknowledged subscription connection before claiming wallets. Subscriber loss fails `/health` and stops local actors. Local process fixtures verify this transport, not production configuration. Untrusted routing components must have no signing or storage credentials. A valid TLS bare-root `wss://` game endpoint remains required; wallet admission, Origin, rate and capacity checks always apply.

The control store requires Redis 7.2 or newer. Acknowledged fencing and journal state must remain durable and must not be evicted or rolled back by failover. Redis stores public descriptors and AES-256-GCM encrypted Ed25519 private seeds, never plaintext private keys. Ephemeral game state cannot substitute for durable control records.

The store keeps versioned JSON aggregates in `bot:control:record:<logical-key>` string keys. One Lua compare-and-set validates every declared key (including absent or expired keys), Redis types and expiry deadlines before one atomic MSET. That same script applies native PEXPIREAT deadlines only to temporary OAuth requests, challenges, unexchanged authorization-code grants and provisional client registrations. Request/challenge/code deadlines retain their existing configuration; provisional registration uses `BOT_REQUEST_TTL_MS`. Consent atomically promotes its client to a persistent registration. Successful code exchange makes the active grant persistent; refresh-replay and revocation evidence, encrypted keys, journals, commands and receipts never receive a TTL. Rewriting a request or challenge preserves its original absolute deadline. No timer, cleanup worker or expiry index is needed. Per-key local queues serialize overlapping operations within a service; cross-process conflicts fail closed as `control_transaction_conflict` (HTTP 409), without replaying callbacks that may sign. Reads inside a transaction see its snapshot plus staged writes. Callback failures publish nothing. Reconnect/offline command queues are disabled, so ambiguous commits are not retried automatically; read/reconcile the durable command or journal before taking further action. Actor fencing, single-use OAuth/refresh state, and atomic receipt/envelope settlement retain their domain owners.

The scheduler pages only the transaction-maintained pending set, not historical aggregates. It rechecks each authoritative record before execution. Pending membership is committed with control changes; an interrupted Redis script can only leave extra candidates to recheck, never omit an accepted action. Snapshots include that index. Old hash snapshots fail closed under the `records-v2` schema. Keep the service paused during any explicit conversion: preserve each aggregate and revision in its new record key, rebuild pending membership from retained commands, proof/provision requests and profession runs, apply only the temporary-record deadlines, and verify all durable identity and execution evidence before publishing the schema marker and resuming. There is no automatic migration and this local change does not modify any live database. Never discard unresolved work or stamp the new schema onto an unverified old snapshot. Recovery from older state must remain paused until external effects are reconciled.

When replacing the split-role prototype, rotate `BOT_AUTHORITY_GENERATION` and require fresh owner consent. Legacy allowance-bearing grants and signed consent are rejected even if rotation is missed; owners must authorize fresh consent. Receipt reconciliation remains available for their unresolved envelopes. Preserve every unresolved envelope, command and receipt for reconciliation; do not clear pending work during this change.

## Required configuration

Wallet funding is the only SUI spending limit; no separate grant allowance is configured. The SDK requires a valid per-transaction gas budget, and chain execution enforces available funds. The managed service key and Google recovery member independently control bot assets.

Required application configuration: `BOT_REDIS_URL`, `BOT_ISSUER` (canonical HTTPS origin), `BOT_WEB_ORIGIN` (exact first-party HTTPS origin), `BOT_SUI_RPC_URL` (HTTPS), `BOT_GAME_ENDPOINT` (canonical WSS root), `BOT_AUTHORITY_GENERATION`, and explicit `BOT_RECOVERY_MODE=true|false`. Provisioning and gameplay remain disabled unless `BOT_PROVISION_ENABLED=true` and `BOT_PLAY_ENABLED=true` are supplied. Protect public connection endpoints with edge admission and request-rate controls; TTL and byte bounds do not replace flood protection.

Source-owned defaults are overrideable by validated positive integer deployment settings:

- `BOT_PORT=3000`; `BOT_OBSERVATION_FRESHNESS_MS=15000`, bounded further by the shared chain-clock law.
- `BOT_REQUEST_TTL_MS=600000`, `BOT_CHALLENGE_TTL_MS=300000`, `BOT_CODE_TTL_MS=60000`, `BOT_ACCESS_TTL_MS=900000`, `BOT_REFRESH_TTL_MS=7776000000` (90 days). The refresh-family deadline is fixed, not extended on rotation; reconnecting creates a new grant and does not transfer old grant-scoped command/run access.
- `BOT_MAX_BODY_BYTES=65536`, `BOT_MAX_REDIRECT_URIS=5` bound input parsing and redirect registration.
- `BOT_LEASE_MS=30000`, `BOT_HEARTBEAT_MS=10000`, `BOT_TICK_MS=1000`. Heartbeat must remain shorter than lease. Actor identity is a fresh UUID per process, not operator configuration.
- `BOT_EVENT_LIMIT=256` bounds retained observation events; callers resync on a cursor gap. `BOT_SCAN_LIMIT=100` is both the pending-key batch and concurrent-work ceiling, not a total-bot limit. Extra wallets wait for subsequent ticks. Adding a replica does not rebalance existing wallets.

These are reviewed operational defaults, not measured capacity claims. Explicit invalid or empty overrides fail closed. `BOT_SIGNING_KEYRING_FILE`, `BOT_ENVELOPE_KEY_FILE`, and `BOT_ENVELOPE_KEY_ID_FILE` identify the required encryption-key inputs; their values are private configuration.

Private seeds are encrypted before the Redis write. One atomic control-store commit persists the ciphertext, canonical bot descriptor, address binding, owner membership and ready provisioning result; concurrent creates converge on one identity. AES-256-GCM authenticates format version, record identity, public key and encryption-key ID. Every read verifies the decrypted seed's public key, and signing compares the expected descriptor. Missing or corrupt bound keys fail closed. Provisioning records the owner request first. An uncertain commit reconciles the same bot/request ID before returning a descriptor; only a committed identity can be published. Competing candidates compare the same request and bot revisions, so a delayed commit cannot replace the winning wallet. Plaintext exists transiently in trusted process memory; JavaScript and SDK internals cannot promise perfect memory zeroization. There is no plaintext fallback, key export endpoint or private-key logging.

Signing and journal encryption keys must remain separate from each other and from encrypted records. The envelope label file contains its exact label bytes, without an added newline. The signing keyring JSON shape is `{ "active_key_id": "<version>", "keys": { "<version>": "<base64 encoding of 32 random bytes>" } }`. Never commit plaintext keys or put them in Redis or logs. New signing records use the request hash; existing two-hash key IDs remain readable with the original authenticated ID and public-key checks, without automatic rewriting. Non-encrypted control metadata is sensitive even when wallet seeds and transaction envelopes are encrypted.

The keyring is read at startup, not hot-reloaded. The internal `rewrap(persisted_key_reference)` verifies the original seed and compare-and-swaps fresh ciphertext without changing the public descriptor. Conflicts and uncertain replies require rereading. There is no public rotation endpoint. Retained ciphertext requires its matching key version; deleting that key can permanently prevent recovery. Encryption-key rotation does not revoke an exposed wallet seed.

## Connection and recovery

A terminal server takeover is persisted separately from the recovery lease. Receipt reconciliation may reacquire ownership, but neither it nor a process restart reconnects gameplay after a human has replaced the socket.

The interactive client and bot share `@aresrpg/fight`’s stateful session and submitted-turn latch. Before signing a turn, its canonical baseline is retained with the exact command. Certified `TurnSeedUsed` witnesses replay through that same session, and receipt settlement atomically retains the replayed checkpoint and submitted-turn identity in the wallet lane. Restart, socket replacement, heartbeats and unrelated inventory changes cannot authorize another submission of that turn. The bot waits for a canonical next-turn projection before further action; it does not publish speculative replay as a server checkpoint or add an indexer version protocol. Terminal turns remain latched while the existing settlement action handles custody. Hot replay rows retire only after certified settlement of every owned seat and a complete authenticated character projection confirming exit, with no unresolved envelope; command and receipt evidence stays durable.

OAuth is authorization-code + S256 PKCE with exact registered HTTPS redirects and resource binding. Registration supports public clients, not unsupported client-metadata-document discovery. The stateless JSON MCP transport advertises explicitly supported 2025 protocol versions; do not claim latest-protocol, ChatGPT publication, Claude or Grok readiness without live provider tests. `tools/list` is the source of implemented actions. External AI chooses the strategy; the bot does not run inference or an unattended strategy loop.

The first-party owner signs a fresh session challenge. One verified Google identity reserves one hosted bot request atomically; retries and provider changes reuse that mapping. The API accepts no caller-selected creation ID, owner or wallet. A retained request may exist before its encrypted key and public wallet descriptor commit; it is not a funding destination. Existing multiple-wallet records fail closed for review rather than selecting or replacing a wallet. Connector consent binds the reviewed exact bot descriptor, generation, client, resource, scopes, policy revision. Connectors can share the selected bot and its single normal game socket.

Prepared and signed envelopes survive actor failures. Only the same SDK executor may resume an intact durable signed envelope under current authorization and a consuming fenced transition. Prepared-only recovery atomically fails the original command and releases its lane under the current fence. A signed envelope invalidated by pause, revocation or superseding decision is cancelled only before the consuming submission transition. Both require a fresh observation and new intent; submitting ambiguity is never cleared by cancellation. Already-submitting ambiguity reconciles the exact digest; not-found is not evidence of nonexecution. Revocation/pause stop new admissions, not a signature already beyond final admission. Receipts, actual gas history, command outcome and pending-envelope clearance settle atomically even after revocation. Do not claim exactly-once chain execution.

Recovery from restored state requires explicit recovery mode and a fresh `BOT_AUTHORITY_GENERATION`: old requests, challenges and tokens must fail. Key mappings, descriptors and pending chain receipts must reconcile before explicit resume. Replacement encryption keys cannot repair missing keys. Owner-signed Google recovery and retained public multisig descriptors remain usable without this service or its signing keyring.

## Verification

`bun run --cwd packages/bot typecheck`, `bun test packages/bot/test`, repository lint, native suite and browser checks all remain required. Real Redis tests run only with `TEST_BOT_REDIS_URL=redis://127.0.0.1:<fixture-port>/15` targeting an explicitly disposable loopback instance; the normal suite otherwise reports it skipped. Fixtures use unfunded ephemeral identities and never submit chain transactions. Production release additionally needs managed-key lifecycle/restore tests, real zkLogin owner proof, TLS admission, provider OAuth registration/refresh/revocation and full game lifecycle verification.

The bot image is locally buildable with the supplied Dockerfile. The release pipeline now wires bot image build/reuse, provenance attestation, schema-two manifest certification, and activation validation. No trusted bot image has yet been published or deployed. The production prerequisites above still apply.

The typed catalog currently exposes normal PvE discovery and fight lifecycle actions, not general game automation. Each call carries the observed checkpoint and revisions; the external AI chooses the next action. There is no autonomous strategy or inference service. `bot_observe` accepts canonical market and price watches plus retained-event cursors; cursor gaps require a fresh snapshot. Observations return a current snapshot directly, or `status: pending` until the authenticated baseline is ready. Retry the read with the same requested watches. Reads create no durable commands or result rows; watches, snapshots and events belong to the live connection. After process restart, a new explicit read recreates idle observation demand.

Connected actors with a live `bot:play` grant retain ordinary player presence between tasks: short walking legs, pauses and occasional jumps around their stopping point, within roughly fifty blocks. A supported equipped pet enables mounted roaming, occasional double jumps and held glides through the real controller. This uses real collision/controller movement and normal position packets, with no transaction or new gameplay objective. Active work takes priority. Explicit pause, unavailable contract or terrain, lost authority and disconnection stop idle movement; existing lifecycle rules govern reconnects and terminal takeover.

The owner UI reads `/connect/status` only after a browser-bound Google owner proof. A connected result requires an exchanged, non-revoked grant with current authority, bot generation, policy and a live refresh family. It describes renewable connector authorization, never live actor presence or inference. Code exchange atomically records its grant ID in the owner lookup; existing owner lookups are initialized once from authoritative exchanged grants. Grant records remain the only authorization authority. Frontend status checks are single-flight, refresh on tab return and every five seconds while visible, and fail closed on errors. HTTP requests time out after fifteen seconds; wallet approval remains bounded by its signed challenge expiry.

Returning users resolve the unique backend bot, verify a fresh signer proof and recheck owner status before the inventory target is installed. Browser history never selects the active bot or restores signer trust. Normal connected inventory has no address-comparison checkbox or saved-wallet dropdown. Historical public identities remain separate recovery records and are not deleted or silently overwritten if unreadable. Characters use Send to agent; coin funding remains separate. OAuth consent is still one explicit approval of the actual provider request.

`bot_pause` stops new gameplay admissions. A still-authorized connector can explicitly request a fresh `bot_observe` and use its revisions with `bot_resume` once there is no unresolved envelope or active command. Resume never restores revoked authority or bypasses recovery mode. Already signed or submitted transactions may still settle.

Pause before the durable submission transition can cancel the exact signed command through the same fenced compare-and-set that admits submission. If submission wins, its envelope remains pending for receipt reconciliation. Recovery retains lease ownership independently of a revoked grant or stopped game socket; it never revives gameplay authority or submits a replacement.

`BOT_SCAN_LIMIT` bounds pending page size and concurrent wallet work. Successful ordinary actions retain the authenticated socket and SDK session. Actual disconnects require fresh authentication and baseline; recovery of an unresolved transaction still rebuilds execution after a fresh baseline. Existing live watches restore across transient transport reconnects, with cursor gaps requiring resynchronization. This is not high-scale or uninterrupted-event-continuity certification.

The owner account permits one hosted wallet. Repeated requests cannot allocate additional signing identities. Service-wide admission and capacity limits remain a separate deployment concern; this invariant is not a global abuse-rate limit.

Historical command retention must preserve idempotency and unresolved execution evidence. Completed history does not participate in pending discovery. Production historical-load and latency validation remain deployment gates; no high-scale latency is certified here.

## Profession prototype

The external AI translates the player's request into a typed profession plan. `bot_observe` now returns current job XP, available inventory, recipe access/XP, live resource packs and authored loot sources in `planning_context.professions`. Inventory excludes listed/traded assets and preserves item versions and removal tombstones. Shared inventory stack selection lives in the protocol package and is reused by both the player UI and bot.

Use `bot_validate_plan` first; it reads the current live observation. Its errors identify the field, requirement and remedy. Static validation uses authored recipes and immutable rules; live checks use that fresh observation when available, otherwise the result explicitly remains static-only. Validation never simulates, signs or submits, and a valid plan is not execution approval or a guarantee of success. SDK simulation and current actor/grant/clock/inventory checks still run at execution.

A plan has exactly these fields:

```json
{
  "character_id": "<owned full 0x character ID>",
  "job": "FARMER",
  "target_level": 2,
  "recipe_output": "wheat_flour",
  "gather_item_types": ["wheat"],
  "max_actions": 20,
  "deadline_ms": 1794196800000
}
```

The example deadline is illustrative: choose a future absolute UTC epoch time in milliseconds. Job/recipe/gather identities come from the current observation catalog. `max_actions` and `deadline_ms` are mandatory finite caller limits, not defaults. The deadline is checked again at SDK prepare/sign/submit, so waiting in a queue cannot extend authority. There is no separate gas allowance; the funded wallet and SDK per-transaction gas checks remain authoritative.

Call `bot_start_profession` with the plan, an idempotency key and the fresh observation/decision revisions. Poll `bot_profession_status` using the returned run ID. Fresh `bot_observe` responses also expose `profession_run_id` for the current connector’s active lane run; other grants receive null. The runner keeps its progress and child-command identity in Redis and resumes after process restart without replacing pending transactions. Each step gathers one live node or makes one craft attempt, then waits for receipt-proven item versions/quantities and earned job XP. Gathering also requires its newer character checkpoint and consumed resource node. Heartbeats and unrelated state changes cannot admit another step, and receipt/projection arrival order does not change this barrier. One-at-a-time crafting is a sequencing choice for precise stopping; the standalone `bot_craft` tool still supports the game's existing batch limits. A craft attempt consumes ingredients even when its item-success roll fails. Completion depends only on observed target-job XP, never estimated gains.

The first vertical automatically gathers approved direct ingredients and crafts the one selected recipe. It does not invent an acquisition strategy, buy ingredients, recurse into intermediary recipes, explore unknown zones or choose combat actions. Missing drops/resources and protector/fight state return `awaiting_ai` with exact requirements and sources. The external AI can use `bot_world_search`, `bot_resolve_ambush` and the existing bounded PvE tools to obtain loot, then `bot_resume_profession` with fresh revisions. Resume retains the original action count/deadline. Combat and exploration commands chosen separately by the AI use the same authenticated grant but do not count as this run's automatic actions. Stops, failures and uncertain submissions require review; they are never automatically replaced.

`bot_pause` pauses all gameplay. After reconciliation, explicitly resume the bot before resuming the profession run. Starting or resuming a run while another run owns the address lane is refused. A new conflicting strategy is never silently substituted.

Local proof (no funded keys, network execution or assets):

```sh
bun run --cwd packages/bot typecheck
bun run --cwd packages/protocol typecheck
bun test packages/bot/test
bun test packages/bot/test/profession_sdk.test.ts
```

The SDK test builds/signs real gather and craft PTBs through the actual durable transaction journal, using a synthetic fullnode transport and synthetic game projections. It is not a live-game, full farming/combat or public connector certification. Production still requires independent security review, a disposable real database gate, provider connection tests, a real game-server/chain test, backups/restore validation, and explicit deployment authorization.

The service health probe reads its durable Redis connection; a disconnected process reports unhealthy. Redis reconnect and offline queues remain disabled, so uncertain writes are never replayed by the connection.

`bot_observe` returns live profession state without the full static recipe catalogue. Pass `recipes: []` explicitly for output IDs, then `recipes: ["<output_type>"]` for selected recipe details and acquisition sources. The same authored seed catalogue and immutable rules remain authoritative; no second catalogue or cache is maintained.

For repeated monitoring, first retain a full `bot_observe` response, then request
`{ "view": "changes", "after_cursor": <cursor>, "after_fence": <event_fence> }`.
This opt-in view returns ordered retained events, current clock/readiness and control metadata;
it omits the repeated snapshot, checkpoint maps and planning context. Advance the cursor only after
consuming the response. Repeating the same cursor safely returns the same retained events.
Both cursor and fence are required; `needs_resync` requires a new full observation after a gap or
actor replacement. Request the default full view for fresh action planning, recipe details or
rebuilding retained state. Existing full-view callers and watch controls are unchanged. This adds
no event retention limit and does not guarantee a smaller response when many events accumulated.
