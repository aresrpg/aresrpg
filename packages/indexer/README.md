# AresRPG Indexer

The chain's one projectionist. A Rust binary that streams Sui checkpoints and writes the game's
live state into FalkorDB — **the ONLY writer of this Redis**. Everything it stores is a
re-derivable cache of public chain truth: replay the same checkpoints, get the same store.

The one consumer is the central server (stateless, reads the graph directly, streams to
browser clients). The old read-api layer is dead (deleted; its frozen tree lives in git history).

```
      Sui fullnode (gRPC streaming + HTTP checkpoint store)
                          │  checkpoints
                          ▼
                ┌───────────────────┐
                │  indexer (Rust)   │  sui-indexer-alt-framework, ONE sequential pipeline
                └─────────┬─────────┘
                          │  GRAPH.QUERY · ZADD · PUBLISH
                          ▼
                ┌───────────────────┐
                │ FalkorDB (Redis)  │  graph = live truth · zsets = sales history
                │                   │  pub/sub = live wire · plain keys = bookkeeping
                └─────────┬─────────┘
                          │  Cypher reads · XREAD-free: SUBSCRIBE + graph resync
                          ▼
                   central server → clients
```

## Configuration — two ids, everything else derived

A deploy passes **exactly two game-specific values** (owner ruling 2026-08-11): the game
package's ORIGINAL id and its LATEST upgrade id. At boot the indexer derives:

- **type origins** — events and object types match against the original address (Sui type
  identity pins to the defining package); the upgrade id validates the lineage on-chain.
- **start checkpoint** — the checkpoint containing the original package's publish transaction
  (`package.previous_transaction` → checkpoint), used only when no watermark exists yet.

Hand-pasted allowlists and hand-anchored checkpoints are the disease the rewrite removes.

| Env | Meaning |
| --- | --- |
| `PACKAGE_ORIGINAL` | original game package id (`0x…`) |
| `PACKAGE_LATEST` | latest upgrade id (`0x…`) — lineage-validated at boot |
| `REDIS_URL` | the FalkorDB instance |
| `REMOTE_STORE_URL` / `STREAMING_URL` | checkpoint sources (backfill / live gRPC) |
| `GRAPHQL_URL` | official GraphQL endpoint, boot derivation only (default testnet) |
| `FIRST_CHECKPOINT` | optional override of the derived start (fresh pipelines only) |

A resuming deploy (a watermark exists) never touches the network at boot; the
graph indexes are declared idempotently on every start.

## The storage constitution

Exactly three data surfaces — nothing else, ever (owner ruling: no parallel storage kinds):

1. **GRAPH** (`GRAPH.QUERY aresrpg`) — *what exists now*. Live custody, social, presence,
   engagement state. Every write idempotent (MERGE / per-property SET / edge replace).
2. **ZSETs** — *the one history product*: `sales:{address}`, a 30-day sales window per
   address. Member = `{ckpt}:{tx}:{evt}|{json}` (coordinate prefix = replay-idempotent),
   score = `ts_ms`, capped at 500 rows, 90-day idle TTL.
3. **PUB/SUB** — *what is happening*. Every decoded game event, published fire-and-forget.
   Payloads carry their checkpoint number; a consumer that sees a gap re-reads the graph.
   **The graph is the resync** — no replay transport exists, by design.

Bookkeeping (not a data surface): `idx:watermark`, `idx:chain_id`, `idx:package_original`
(the store is BOUND to its game at first boot — a restart against another package refuses,
the chain-id guard's sibling), `idx:checkpoint:latest` — plain keys, watermark written AFTER
data.

## Graph schema

IDs and addresses are canonical `0x…` hex strings. **Every scalar that can exceed 2⁵³ is a
STRING property** (MIST, u128 bitmaps, u64 seeds) — FalkorDB integers are i64 and money never
touches a float. Every written node carries `ckpt` (the checkpoint that last wrote it).

### Nodes

| Node | Properties | Source (per-property writers) |
| --- | --- | --- |
| `:User` | `address` | created lazily by edges |
| `:Kiosk` | `id`, `profits` (string) | Kiosk object |
| `:Character` | `id`, `owner` (refreshed from the co-present kiosk's owner at every kiosk custody write, and from the seat's `Player{owner}` at every fight write), `name`, `classe`, `sex`, `level`, `experience`, `color_1..3`, `vitality`, `wisdom`, `strength`, `intelligence`, `chance`, `agility`, `available_points` | Character struct |
| | `hp`, `hp_ms` | `HpKey` DF |
| | `job_<slug>` (one prop per job — 15 fixed slugs; each job is its OWN DF, so a map prop would need read-modify-write) | `JobXpKey(job)` DFs |
| | `spells` (map name→level), `spell_points_spent` | `SpellBookKey` / `SpellSpentKey` DFs |
| | `folded_stats` | `FoldedKey` DF (byte-mirror of the chain's own fold — never computed here) |
| | `world`, `x`, `z`, `at_ms`, `pet` | `CurrentWorldKey` + `CheckpointKey(world)` DFs (rooted = `at_ms > now`, derived by consumers) |
| | `dungeon_run` (map: world, room, x, z, seed(string) \| null — NULLed when the run's DF is removed) | `DungeonRunKey` DF |
| | `ambush` (map: mob_type, x, z, scalar, board_seed(string), hp \| null) | `AmbushKey` DF, `fires == true` only |
| `:Item` | `id`, `name`, `item_type`, `category`, `level`, `amount` | Item struct (`item_type` IS the template key — template addresses derive from it; no template edge, no template prop) |
| | `stats`, `damages` | `StatsKey` / `DamagesKey` DFs |
| | `puits`, `apps` | `ForgeKey` DF |
| | `pet_power`, `pet_last_day` | `FeedKey` DF (power = feed count 0..60; scaled stats derive at the consumer) |
| `:Fight` | `id`, `world`, `x`, `z`, `phase` (placement\|active\|ended), `winner`, `access_a/b`, `managed`, `wagered`, `dungeon_room`, `drops_rolled`, `turn_ptr`, `turn_seed` (string), `placement_ms`, `turn_started_ms`, `machine` (serialized: board, closed, queue, openers, fighters, zones, turn_casts) | Fight object — one latest-wins blob for the machine; nobody graph-queries inside a board mask |
| `:Party` | `id` | Party object |
| `:Kolizeum` | `id`, `pledge` (string), `pot` (string), `format`, `level_min/max`, `allowed` (array \| null), `fight_id` | Kolizeum object |
| `:Sale` | `id`, `template`, `price` (string), `supply` | Sale object (supply is the only field that moves) |
| `:Airdrop` | `id`, `template`, `amount_each`, `whitelist` (array) | Airdrop object (shrinks per claim; empty = fully claimed) |
| `:Giftcard` | `id`, `template`, `amount` | Giftcard object |
| `:BoxClaim` | `id`, `box_template`, `rolled_template`, `amount` | loot_box::BoxClaim object (soulbound loot claim; deleted at claim) |
| `:CrushClaim` | `id`, `seed` (string), `revealed`, `owed` (51-int array \| null until revealed) | forgemagie::CrushClaim object (soulbound crush commitment) |
| `:Zone` | `world` (the World OBJECT id — the stable key; `world_name` rides along from the co-present World), `zx`, `zz`, `seed` (string), `searched_at_ms`, `mob_taken` (string, u128), `res_taken` (array) | `Field<ZoneKey, Zone>` DF on the World UID (world id→name resolved from the 20 World objects at boot). Groups/packs/portal are NEVER stored — pure derivation, client-mirrored |
| `:Market` | `item_type`, `last_sale_mist` (string), `last_sale_ms` | THE one event-derived write (no object carries a realised price) — latest-wins |
| `:Meta` | `version`, `sealed`, `chain`, `package_original`, `package_latest` | Version object, registry seal, boot config |

### Edges

```cypher
(User)-[:OWNS]->(Kiosk)                                  // source: Kiosk.owner (the KioskOwnerCap
                                                          // is wrapped in the PersonalKioskCap —
                                                          // never visible as an owned object)
(Kiosk)-[:HOLDS]->(Character|Item)                       // kiosk custody (place or lock)
(Character)-[:EQUIPS {slot}]->(Item)                     // item AddressOwner == a known Character
                                                          // id (typed resolver rule — never a User)
(Fight)-[:FIGHTER {team, seat}]->(Character)             // from FighterKey(seat) dof Field objects,
                                                          // NEVER from the fighters vector (a
                                                          // settled player stays in the vector)
(Character)-[:MEMBER_OF {order}]->(Party)                // order 0 = leader (derived, never stored)
(Party)-[:INVITED]->(Character)
(User)-[:FRIEND]->(User)                                 // DIRECTED whitelist — never symmetric
(Item|Character)-[:LISTED_IN {price, exclusive, at_ms}]->(Kiosk)   // kiosk Listing DF decode
(User)-[:CAN_BUY {min_price}]->(Item|Character)          // PurchaseCap object → its AddressOwner
(User)-[:HOLDS_VOUCHER]->(Giftcard)                      // follows the voucher through zksend hops
(User)-[:HOLDS_CLAIM]->(BoxClaim|CrushClaim)             // the soulbound grind-safe roll claims
```

**Deliberately absent** (the content cut, owner-ratified): ItemTemplate / MobTemplate /
SpellTemplate / Recipe nodes, drops/recipe/spawn/yield edges, World nodes — the frozen corpus
ships as JSON in this repo; the 20 sealed World objects are read directly. The indexer
projects LIVE state only.

## The laws

1. **Objects are the sole graph writers.** Checkpoint output objects (+ `input_objects`
   pre-state, + the deleted-ids sweep) drive every node and edge. Events feed pub/sub and the
   sales zsets only. Sole exception: `:Market.last_sale` (law 9).
2. **`input_objects` are a first-class source.** A deleted object's id alone is unlabelable;
   the pre-state names its type, owner, and edges to reap.
3. **Per-property writes, never node replacement.** hp, jobs, spells, run, ambush, stats,
   forge, feed are independent DFs — a checkpoint carries only what changed; each decoded
   source SETs exactly its own properties.
4. **One ownership edge per object.** kiosk → character-address → fight-custody → kiosk: each
   transition deletes the old edge and creates the new one in the same write batch. An object
   can never read as held in two places. `Character.owner` is refreshed at every custody move
   (the Fighter enum carries it), so "my characters" survives mid-fight.
5. **Replay convergence.** Crash after data, before watermark → the checkpoint replays: MERGE
   and per-property SET converge, edge replace converges, zset members carry their
   `{ckpt}:{tx}:{evt}` coordinate so re-adds collide into no-ops. Nothing increments.
6. **Transactions apply in order** within a checkpoint — ownership inversions forbidden.
7. **The sale discriminator — three independent gates, all required.** A kiosk purchase is a
   sale only when: the event type's phantom `T` is a game type (foreign collections filter on
   the TYPE, the body cannot tell) · `price > 0` (the 0.01 SUI royalty floor makes a genuine
   0-price sale impossible, and every protected-policy extract is 0-price — so a spoofed
   `royalty_rule::pay` in the same PTB can never launder plumbing into sales) ·
   `royalty_rule::pay` present · the object is a game output of the tx. Zero-price never
   stamps `:Market`, shop sales included.
8. **Exclusive sales are event-invisible.** `purchase_with_cap` emits nothing: the sale is
   derived from the PurchaseCap deletion + the kiosk `profits` delta in that tx, MINUS any
   same-tx public-sale prices of that kiosk. Ambiguous cases (two caps of one kiosk in one
   tx, or a delta fully explained by public sales) are skipped with a warn — money history
   never guesses. History rows only (side-tagged), never `:Market`.
9. **Market stats.** `last_sale_mist` = paid ÷ purchased stack `amount` (the event price is
   the LOT price), latest-wins by checkpoint order. Supply = `SUM(Item.amount)` grouped by
   `item_type` — live, exact, no stored counter anywhere. Marketcap = supply × last_sale,
   computed by the reader.
10. **Indexes are declared at boot**: every node's key property (`id` / `address` /
    `item_type` / `(world, zx, zz)`), plus `Item.item_type` and `Character.world`.
11. **Non-goals.** No post-hoc combat/craft log (one-shot outcomes live on the wire; state
    shows results, not moments). No derived values (regen, scaled pet stats, marketcap,
    rooted, leader — consumers compute). No frozen content.

## Pub/sub topics

Payload: `{ckpt, tx, evt, ts_ms, type, data}` — `data` mirrors the Move event field-for-field
(u64 → string, ids → hex). Gap detection = `ckpt` monotonicity per topic; recovery = re-read
the graph.

| Channel | Events |
| --- | --- |
| `evt:character:{id}` | CharacterCreated · WorldJoined · ItemEquipped/Unequipped · DungeonEntered/RoomCleared/Ended · PartyJoined/Left |
| `evt:fight:{id}` | FightCreated · FightStarted · FightEnded · DropsRolled |
| `evt:world:{name}` | ZoneSearched · ResourceGathered · RareGathered · FightCreated |
| `evt:party:{id}` | PartyCreated · PartyJoined · PartyLeft |
| `evt:social:{address}` | FriendListCreated · FriendAdded · FriendRemoved |
| `evt:kolizeum` | KolizeumCreated · KolizeumPaid |
| `evt:economy` | SaleBought · AirdropCreated/Claimed · GiftcardMinted/Redeemed · Crafted · RuneScribed · GearCrushed · LootBoxOpened · LootClaimed · PetFed · genuine kiosk ItemListed/Purchased/Delisted (phantom-`T`-filtered, plumbing-suppressed) |
| `evt:content` | TemplateCreated · MobTemplateCreated · SpellCreated · RecipeCreated · LootTableSet (ceremony-time, then silent forever) |

## The Move-parity gates

The projection is a TWIN of the Move layer, and twins drift (measured 2026-08-12: a Move
audit changed `Fight`/`DungeonRun` layouts and birthed `loot_box` the same morning the twins
were written). `src/gates.rs` makes drift a compile-day red, not an audit-day discovery:

- **Layout snapshot** — every datatype the projection reads (the manifest in `gates.rs`) is
  extracted from the COMPILED bytecode (`sui move build` output) and diffed against
  `tests/layout_snapshot.txt`. A Move edit to a depended-on struct reds `cargo test`;
  ratifying it (`UPDATE_LAYOUTS=1 cargo test`) is the deliberate act that says the twins
  were resynced too.
- **Existence** — a renamed module or deleted struct the projection matches on is a hard
  error, never a silently orphaned arm.
- **Event census** — every `event::emit` in the Move sources must be routed (`events.rs`)
  or explicitly deferred; both directions checked (an unrouted emit AND a dead route red).

The gates need the Move build on disk and ERROR when it is absent — never a skip.

## Layout

```
packages/indexer/
├── Cargo.toml         # framework pinned to the sui CLI rev; redis; no HTTP server
├── src/
│   ├── main.rs        # boot: two ids → derivation; one sequential pipeline
│   ├── store.rs       # watermark-after-data; GRAPH.QUERY / ZADD / PUBLISH executors
│   ├── decode.rs      # BCS twins of every Move struct — pinned against live captures
│   ├── ownership.rs   # pure: checkpoint owner walk (kiosk 2-hop, character-address, custody)
│   ├── graph.rs       # pure: decoded objects + deletes → Cypher batch (offline-tested)
│   └── publish.rs     # pure: events → pub/sub payloads + sales-zset rows
└── tests/             # fixture replays: checkpoint in → exact write batch out
```

`decode.rs`, `ownership.rs`, `graph.rs`, `publish.rs` are pure functions — checkpoint data in,
write batch out, never a store read. That is what makes them unit-testable offline and the
whole store a re-derivable cache.
