# AresRPG indexer

The indexer is the chain's one projectionist and the only writer of its FalkorDB Redis. It streams
Sui checkpoints through one sequential Rust pipeline and produces five rebuildable surfaces:

1. The graph: current live state and relationships.
2. Per-address sales ZSETs: bounded player marketplace history.
3. Analytics: exact activity membership and decimal money buckets.
4. Monthly address leaderboards.
5. `evt:*` pub/sub: post-projection change notifications.

One server stack consumes its own indexer. Any number of indexers may run independently around the
world, each with a private disposable FalkorDB. The indexer never owns gameplay authority or
authored content. See the repository `ARCHITECTURE.md` for the complete system flow.

## Configuration

The deployment supplies the original and latest game package IDs plus the original living-content
package ID. Type identity matches original packages; lineage validation uses the latest package.
On a fresh store, boot derives the original publication checkpoint. A store with a watermark
resumes without a network-dependent boot query.

| Environment | Meaning |
| --- | --- |
| `PACKAGE_ORIGINAL` | Original game package ID; required |
| `PACKAGE_LATEST` | Latest game package upgrade ID; required |
| `SEED_PACKAGE_ORIGINAL` | Original living-content package ID; required |
| `KARES_MARKET_POOL` | The KARES market's fee pool object (`pins.json` `kares_market_pool.id`). Optional; set with the two below or not at all |
| `KARES_TREASURY` | The address that fee pool pays (`kares_treasury`) |
| `KARES_COIN_TYPE` | The KARES coin type (`kares_coin_type`) |
| `REDIS_URL` | FalkorDB connection; defaults to local Redis |
| `REMOTE_STORE_URL` | HTTP historical backfill and streaming-failure fallback |
| `STREAMING_URL` | Live gRPC checkpoint source |
| `GRAPHQL_URL` | Boot-only lineage and publication lookup |
| `INGEST_MAX_CONCURRENCY` | Checkpoint fetch ceiling |
| `RUST_LOG` | Rust log filter |

The HTTP archive fills every restart and reconnect gap, even when live streaming is healthy.
A gRPC provider's retained history may begin after our watermark; its `NOT_FOUND` response must
not trap replay on that provider. Live checkpoints still arrive over gRPC.

The store binds itself to the original package and chain. Starting it against another game or
network refuses instead of mixing projections.

This leaderboard release requires a full game-package republish: sale-proof signatures now carry
the source kiosk and emit `listing_rule::SellerProved`, and the unused public math XP helper was
removed. A compatible upgrade is not supported for this change.

Leaderboards require replay from the original publication checkpoint. An older store without
leaderboard metadata refuses startup rather than presenting partial seasons. Rebuild that private
store before running this version; do not initialize scores from current Character balances.

Boot marks a fresh store with the numeric analytics format (`idx:analytics_schema` =
`compact-v1`) and refuses a store holding any other format. Ordinary resumes remain network-free and append the configured latest package to the stored activity lineage.

## Storage laws

- Output objects, their pre-state inputs, dynamic fields, custody, and deleted pre-state are the
  only graph writers.
- Events feed pub/sub, sales history, and analytics; successful non-deployment game-package calls feed activity.
- A kiosk reaches the graph only once it holds or lists a game Item or Character; its profits,
  owner and personal cap then update that node, and an unrelated kiosk leaves no record.
- The indexer counts only what the game's packages did: calls must target a certified game
  version, events and objects must carry the original game type. Royalty revenue is the balance
  the game's own `TransferPolicy` objects collected; an exclusive sale counts only when the sold
  type's policy collected royalty in that transaction.
- Numeric analytics use the compact checkpoint-marked format described in [ARCHITECTURE.md](../../ARCHITECTURE.md).
  Character lifecycle records and distinct-address membership retain their separate semantics.
- Server-mesh online samples are best effort and expire.
- Every large integer and money value is stored as a decimal string.
- Writers update only the properties they own; sparse dynamic-field outputs never replace a node.
- Custody transitions replace the old edge and create the new edge in one checkpoint batch.
- Graph writes complete before pub/sub publishes.
- The watermark is the final write. A crash before it replays an idempotent batch.
- The graph is the resync. Pub/sub has no replay log.

The current labels, relationships, and channel names live in
`packages/server/src/protocol.ts`, which mirrors `graph.rs`, `publish.rs`, and `events.rs` and is
covered by server/indexer gates. Do not maintain another schema table here.

`AresHandler::writes` is the pure core: one lifted checkpoint in, its ordered write list out.

## Tests and parity gates

Run from this package:

```bash
cargo test
```

Tests live in `test/`. `test/core.rs` is the one core suite: each case drives a whole scenario
through `AresHandler::writes`, a store commit, a decoder or boot, and captured payloads sit in
`test/fixtures/` with their provenance. `test/gates.rs` holds the Move parity gates. The suite
requires compiled Move output and `redis-server` on PATH; storage cases start isolated Unix-socket
Redis processes. The gates fail when:

- A projected Move layout differs from `tests/layout_snapshot.txt`.
- A decoded event's fields differ from compiled bytecode.
- A Move event is neither decoded nor explicitly deferred.
- A decoded event no longer exists.
- The zone-size or character-price twin differs.
- The production Move package exceeds its publication headroom, or a Random door is exposed.

`tests/` keeps only the layout snapshot and two captured fixtures the SDK tests also import.

After an intentional projected layout change, update the Rust twin and consumers, then ratify the
snapshot with:

```bash
UPDATE_LAYOUTS=1 cargo test
```
