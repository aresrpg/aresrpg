# AresRPG RPC

A self-hostable, **read-only** RPC over Sui that serves preprocessed views of
AresRPG on-chain state (SPEC §14). Pure client-side chain indexing is not viable
— a phone cannot fetch the equipment and colors of 100 players it just met, or
scan every kiosk for listings — so this does the heavy lifting while staying
decentralized.

- **Read-only & keyless by construction.** It holds no keys, signs nothing, and
  writes no game state. Everything it returns is re-derivable from public chain
  truth, so anyone can verify it or run their own — the official instance is just
  the one we host.
- **Cache, not authority.** State is a re-derivable cache; RAM-first is correct,
  append-only persistence suffices, and read replicas scale horizontally.

```
        Sui testnet/mainnet
   (gRPC streaming  +  HTTP checkpoint store)
                 │
                 ▼
        ┌─────────────────┐   checkpoints        ┌──────────┐
        │  indexer (Rust) │ ───────────────────▶ │ Redis 8  │
        │  sui-indexer-   │   JSON docs + query   │  (JSON + │
        │  alt-framework  │   engine indexes      │  search) │
        └─────────────────┘                       └────┬─────┘
                                                       │ reads
                                        ┌──────────────▼──────────────┐
                                        │        read-api (Bun)       │
                                        │  /health /v1/status /v1/…   │
                                        │  per-IP rate limit · ETag   │
                                        └──────────────┬──────────────┘
                                                       │ JSON (CDN-cacheable)
                                                       ▼
                                                    clients
```

## Quickstart

```bash
cp .env.example .env        # optional — every value has a safe default
docker compose up           # redis + indexer + read-api, indexing Sui testnet
```

Then:

```bash
curl -s localhost:3000/health
curl -s localhost:3000/v1/status     # indexer tip + lag behind the chain
```

A bare `up` backfills from **genesis** (the watermark climbs from 0). To index
**live from near the chain tip** instead, set `FIRST_CHECKPOINT` to a recent
checkpoint (one-liner in [`.env.example`](./.env.example)) — `/v1/status` lag
then drops to a second or two.

`docker compose up` builds the indexer image from source on first run — the full
Sui cargo compile, which is slow and memory-hungry. **For iterative dev, run the
pieces natively** (below); it is much faster and avoids stressing Docker Desktop.

### Running natively

```bash
# Redis 8 (JSON + query engine in-core):
docker run -d -p 6379:6379 redis:8

# Indexer (from packages/rpc/indexer) — index live from near the testnet tip:
# (fullnode.testnet.sui.io's JSON-RPC route 404s as of 2026-07-08 — its gRPC is
# still fine, see STREAMING_URL below. RPC PROVIDER LAW 2026-07-13: publicnode is
# forbidden — mysten official only — so the latest-checkpoint lookup goes through
# grpcurl against the official fullnode's LedgerService instead of a JSON-RPC mirror.)
TIP=$(grpcurl -max-time 8 fullnode.testnet.sui.io:443 sui.rpc.v2.LedgerService/GetServiceInfo \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["checkpointHeight"])')
REDIS_URL=redis://127.0.0.1:6379 NETWORK=testnet FIRST_CHECKPOINT=$((TIP-30)) \
  cargo run                              # add STREAMING_URL=… for gRPC-primary

# Read-API (from packages/rpc/api):
REDIS_URL=redis://127.0.0.1:6379 bun run server.js
```

## Views (API)

Read-only `GET` JSON. Every view reads the indexer's Redis cache; game views take
query params (below). They return real data once the `ares` pipeline has ingested
the matching events (empty results until then — never a stub).

| Route               | Serves                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health`           | process liveness (never rate-limited)                                                                                                                                                        |
| `/v1/status`        | indexer tip, committer watermark, lag behind the chain                                                                                                                                       |
| `/v1/characters`    | bulk character profiles — `?ids=` (csv) or `?owner=` (name, class, position, equipment)                                                                                                      |
| `/v1/listings`      | kiosk marketplace listings — `?category= &min_level= &max_level= &sort= &cursor= &limit=`                                                                                                    |
| `/v1/pools`         | liquidity-pool reserves + spot price — `?template=` for one                                                                                                                                  |
| `/v1/shop`          | first-party shop sales, supply remaining — `?active=true`                                                                                                                                    |
| `/v1/zones`         | per-world discovery / zone state — `?world=` (required), `?discovered=`                                                                                                                      |
| `/v1/encyclopedia`  | on-chain liveness of minted item templates + worlds — `?kind=items\|worlds`                                                                                                                  |
| `/v1/config`        | global game dials, class base stats, character-creation config                                                                                                                               |
| `/v1/kolizeum`      | kolizeum lobby state — `?id=` for one, `?status=` to filter                                                                                                                                  |
| `/v1/fights`        | the Fight object — `?id=` (resync), `?character=` (active fight), `?world=` (browse)                                                                                                         |
| `/v1/fight-results` | a wallet's pending soulbound FightResults — `?owner=` (required)                                                                                                                             |
| `/v1/names`         | D52 SuiNS reverse resolution — `?addresses=` (csv, ≤100) → `{address: name\|null}`. Chain-direct GraphQL + Redis TTL cache (`NAMES_CACHE_TTL_SEC`), NOT an indexer view — see `api/suins.js` |

Responses are CDN-friendly: they carry `Cache-Control` + an ETag and honour
`If-None-Match` (→ `304`).

**Object-state gaps (land with object-snapshot indexing).** A few fields are
Character/Zone object or dynamic-field state, not carried by any event, so they
read `null`/last-known today: character `colors` + `level`, live per-zone spawn
rosters, and the exact-live `Sale.minted` / kolizeum roster. The fight views
(`/v1/fights`, `/v1/fight-results`) serve the same event-faithful slice — a
fight's existence, status, roster, turn cursor and terminal results — while the
live per-combatant board (cells, HP/AP/MP, mob identities, turn queue) is object
state that rides the presence layer + the client's sim replay (SPEC §14).

## Rate limits

Per-IP, backed by the same Redis (`INCR` + `EXPIRE`). A window admits up to
`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_SEC`; over the limit returns
`429` with `Retry-After` and `X-RateLimit-*` headers. `/health` is exempt. A
trusted proxy/CDN should set `X-Forwarded-For`; otherwise the socket address is
used.

## Configuration

All env-driven; see [`.env.example`](./.env.example). Highlights:

| Var                     | Default                              | Component |
| ----------------------- | ------------------------------------ | --------- |
| `REDIS_URL`             | `redis://redis:6379` (compose)       | all       |
| `REMOTE_STORE_URL`      | `https://checkpoints.testnet.sui.io` | indexer   |
| `STREAMING_URL`         | — (remote-store polling if unset)    | indexer   |
| `NETWORK`               | `testnet`                            | indexer   |
| `FIRST_CHECKPOINT`      | — (genesis if unset)                 | indexer   |
| `RATE_LIMIT_MAX`        | `120`                                | api       |
| `RATE_LIMIT_WINDOW_SEC` | `60`                                 | api       |

The gas pool is a separate, **opt-in** sponsor (`docker compose --profile gas
up`) — see [`gas-pool/README.md`](./gas-pool/README.md). It is the only component
that holds a key, and that key is a fresh, dedicated sponsor key — never a
production key.

Redis itself carries **no authentication**. `docker-compose.yml` publishes it to
`127.0.0.1` only by default, so it's reachable from the host but not the network.
Exposing it further requires adding `--requirepass <secret>` to the redis
`command` in `docker-compose.yml`, then updating every `REDIS_URL` /
`GAS_POOL_REDIS_URL` to include the password.

## Design notes

### Store: Redis 8 core is enough (spike verdict)

The premortem risk was "the query engine can't express a listing filter we need."
Spiked and **cleared**: the stock `redis:8` image (8.8.0) ships **ReJSON** (native
JSON) and **search** (the query engine) as in-core bundled modules — no
`redis-stack` / module image required. The marketplace-listing shape works
directly:

```
JSON.SET listing:L1 $ '{"category":"weapon","level":40,"price":1200,…}'
FT.CREATE idx:listings ON JSON PREFIX 1 listing: SCHEMA
  $.category AS category TAG  $.level AS level NUMERIC SORTABLE  $.price AS price NUMERIC SORTABLE
FT.SEARCH idx:listings '@category:{weapon} @level:[30 50]' SORTBY price ASC   # → the one match
FT.AGGREGATE idx:listings * GROUPBY 1 @category REDUCE COUNT 0 REDUCE MIN 1 @price   # pool/shop stats shape
```

Filter-by-tag + numeric-range + sort + group/aggregate all hold, so the listing,
pool, and shop views map cleanly onto one store.

### Ingestion

The indexer is built on Mysten's
[`sui-indexer-alt-framework`](https://github.com/MystenLabs/sui) (pinned to the
current mainnet rev, matched to the `sui` CLI). It supports two testnet sources,
both verified to advance the watermark from here:

- **Remote store** (`REMOTE_STORE_URL`, HTTP checkpoint bucket) — reliable
  backfill + polling; the default.
- **gRPC streaming** (`STREAMING_URL`, e.g. `https://fullnode.testnet.sui.io:443`)
  — live primary, with the remote store as automatic backfill.

Each pipeline tracks its own **committer watermark** and resumes from it, so
restarts are exactly-once and in order. The store is non-transactional, so the
watermark is buffered and flushed _after_ the data write of each batch — a crash
never advances it past committed data (writes are idempotent `JSON.SET` upserts,
so replay converges). Redis keys:

| Key                                                                                                                                                                                                                                                              | Written by     | Holds                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| `rpc:checkpoint:latest`                                                                                                                                                                                                                                          | handler        | latest ingested checkpoint (seq, epoch, ts) |
| `rpc:watermark:{pipeline}`                                                                                                                                                                                                                                       | store          | committer watermark (replay position)       |
| `rpc:chain_id`                                                                                                                                                                                                                                                   | store          | chain the cache is bound to (mix guard)     |
| `rpc:character:{id}` · `rpc:pool:{id}` · `rpc:sale:{id}` · `rpc:zone:{world}:{zx}:{zy}` · `rpc:template:{id}` · `rpc:world:{id}` · `rpc:listing:{item}` · `rpc:kolizeum:{id}` · `rpc:run:{pass}` · `rpc:config` · `rpc:creation` (+ `rpc:idx:*` membership sets) | `ares` handler | the game read-model the §14 views read      |

Two pipelines run: `checkpoints` (the liveness spine) and `ares` (the game
read-model). The `ares` handler walks every checkpoint event, matches it by
`(module, name)`, BCS-decodes the body and projects it into the Redis shapes the
views read — a **pure**, unit-tested mapping (`indexer/src/handlers/ares/`), so
the store stays a re-derivable cache. It ingests the AresRPG packages (game,
items, dungeon, kolizeum, pools, fight) plus native `0x2::kiosk` listing events.
The fight slice projects the Fight object + soulbound FightResults (see
`indexer/HANDLERS.md`); its granular board/turn events stay deferred (live
board = presence + client sim replay). An optional `ARES_PACKAGES` allowlist
(canonical `0x…` addresses) hardens it against look-alike foreign packages once
the packages publish.

### Valkey swap

The store uses only standard Redis 8 features (native JSON + the query engine).
[Valkey](https://valkey.io) is a drop-in swap **iff** the JSON + query modules are
present (e.g. `valkey-bundle`, or Valkey + the corresponding modules) — the
indexer and API speak plain `JSON.*` / `FT.*` and never depend on Redis-only
internals. Point `REDIS_URL` at the Valkey instance; nothing else changes.

## Layout

```
packages/rpc/
├── indexer/            # Rust — checkpoint ingestion → Redis (sui-indexer-alt-framework)
├── api/                # Bun  — read-only HTTP JSON API
├── gas-pool/           # opt-in Mysten sui-gas-pool sponsor (--profile gas)
├── docker-compose.yml  # redis + indexer + api (+ gas-pool under the gas profile)
└── .env.example
```

## License

MIT OR Apache-2.0. This is an open, self-hostable read layer over public chain
data — run your own and verify ours.
