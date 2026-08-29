# AresRPG indexer

The indexer is the chain's one projectionist and the only writer of its FalkorDB Redis. It streams
Sui checkpoints through one sequential Rust pipeline and produces four rebuildable surfaces:

1. The graph: current live state and relationships.
2. Per-address sales ZSETs: bounded player marketplace history.
3. Analytics: exact activity membership, decimal money buckets, and 90-day primary-shop detail.
4. `evt:*` pub/sub: post-projection change notifications.

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
| `REDIS_URL` | FalkorDB connection; defaults to local Redis |
| `REMOTE_STORE_URL` | HTTP checkpoint backfill/polling source |
| `STREAMING_URL` | Optional live gRPC checkpoint source |
| `GRAPHQL_URL` | Boot-only lineage and publication lookup |
| `INGEST_MAX_CONCURRENCY` | Checkpoint fetch ceiling |
| `RUST_LOG` | Rust log filter |

The store binds itself to the original package and chain. Starting it against another game or
network refuses instead of mixing projections.

Analytics has no migration or schema-version state. When its projection changes, destroy the local
store and replay from the original publication checkpoint. Ordinary resumes remain network-free
and append the configured latest package to the stored activity lineage.

## Storage laws

- Output objects, dynamic fields, custody, and deleted pre-state are the graph writers.
- Events feed pub/sub, sales history, and analytics; successful game-package calls feed activity.
  Realized market price remains the sole event-derived graph value because no object contains it.
- Exact money and Character lifecycle observations are written once to daily hashes under their
  stable checkpoint coordinates. Replays overwrite the same fields. The server derives the five
  visible chart intervals at read time, while the current Character total comes from graph nodes.
- Successful callers use ordinary address sets for active-player ranges and one first-interaction
  sorted-set entry for lifetime unique addresses. Successful game transaction volume uses one
  numeric field per checkpoint in each visible bucket; replays overwrite that checkpoint's count.
  There are no transaction digests, custom Lua, or analytics schema state.
- Shop details prune by timestamp to 90 days. Server-mesh online samples are best effort and expire.
- Every large integer and money value is stored as a decimal string.
- Writers update only the properties they own; sparse dynamic-field outputs never replace a node.
- Custody transitions replace the old edge and create the new edge in one checkpoint batch.
- Graph writes complete before pub/sub publishes.
- The watermark is the final write. A crash before it replays an idempotent batch.
- The graph is the resync. Pub/sub has no replay log.

The current labels, relationships, and channel names live in
`packages/server/src/protocol.ts`, which mirrors `graph.rs`, `publish.rs`, and `events.rs` and is
covered by server/indexer gates. Do not maintain another schema table here.

## Source layout

```text
src/
├── main.rs       boot and sequential pipeline assembly
├── analytics.rs  exact activity, money buckets, and primary-shop history
├── boot.rs       indexes, package binding, lineage, start checkpoint
├── pipeline.rs   checkpoint filtering and write-batch composition
├── decode.rs     BCS layout twins
├── ownership.rs  custody resolution
├── graph.rs      decoded objects and deletes to Cypher
├── events.rs     Move event BCS twins and evt:* routing
├── publish.rs    projection notifications and market history
├── store.rs      FalkorDB execution and watermark-last commit
└── gates.rs      layout, event, zone-size, and package-size parity
```

`decode`, `ownership`, `graph`, `events`, and `publish` are pure checkpoint-to-output transforms.

## Parity gates

Run from this package:

```bash
cargo test
```

The suite requires compiled Move output and fails when:

- A projected Move layout differs from `tests/layout_snapshot.txt`.
- A routed event's fields differ from compiled bytecode.
- A Move event is neither routed nor explicitly deferred.
- A route references an event that no longer exists.
- The zone-size twin differs.
- The production Move package exceeds its publication headroom.

After an intentional projected layout change, update the Rust twin and consumers, then ratify the
snapshot with:

```bash
UPDATE_LAYOUTS=1 cargo test
```
