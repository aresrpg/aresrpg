# AresRPG architecture law

This file describes the current system, in present tense. It is the first document to read when
changing architecture. It contains no history and no implementation checklist.

One sentence owns the model:

> Move owns game truth; the indexer projects it; the server pushes it; reducers retain it; the SDK writes it; the engine presents it; `seed/` authors content.

## The one law

Every fact has one owner. Every other appearance is a derivation, transport, cache, or
presentation. A derived copy must be disposable and must never become another write authority.

When an owner or public contract changes, every projection and consumer changes in the same
work. The old path is deleted. This monorepo does not keep compatibility twins between its own
packages.

## System flow

```text
AUTHORED CONTENT
seed/*.json ──SDK publication──▶ Sui content objects

LIVE WRITES
UI intent ──reducer──▶ observer ──SDK PTB──▶ Sui Move
                                             │
                                             └──certified receipt──▶ reducer

LIVE READS
Sui checkpoints ──▶ indexer ──▶ FalkorDB graph + evt:* pub/sub
                                      │                 │
                                      └──────▶ server ◀─┘
                                                  │
                                           protocol packets
                                                  │
                                             app reducers
                                                  │
                                      React UI + Three.js engine

EPHEMERAL REALTIME
client presence/chat/fight drafts ◀──server Redis mesh──▶ other clients
```

The chain is authoritative. Receipts and server packets can describe the same transaction at
different times, so reducers are monotonic and idempotent. Arrival order is never authority.

## Package ownership

| Home                   | Owns                                                                                                                                                                               | Must not own                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/move-math`   | Pure on-chain values, validation, curves, grids, and deterministic transforms                                                                                                      | Objects, capabilities, clocks, entropy, state writes                                |
| `packages/control`     | The deployment lineage's administrative capability and freeze authority                                                                                                            | Gameplay, content values, player state                                              |
| `packages/move-combat` | Authority-free deterministic fight state and transitions over plain values                                                                                                         | UID, keys, custody, transfers, events, clocks, entropy sources, transaction context |
| `packages/seed`        | Registry-rooted living content objects and AdminCap-gated content mutation                                                                                                         | Player state or gameplay custody                                                    |
| `packages/move`        | Player and world objects, authority, custody, events, randomness, clocks, and the thin fight lifecycle wrapper                                                                     | Duplicated combat rules, authored content, browser or indexer policy                |
| `packages/fight`       | Deterministic TypeScript fight runtime and presentation inputs mirroring Move                                                                                                      | Chain access, React, rendering                                                      |
| `packages/immutable`   | Shared TypeScript vocabularies and tested mirrors of stable game math                                                                                                              | Live state, network access                                                          |
| `packages/sdk`         | Every client-side Sui transaction plus the explicit one-shot Party checkpoint and linked-Item tooltip reads, PTB composition, object-ref cache, receipt projection, gas accounting | General player-facing reads, app state                                              |
| `packages/indexer`     | Checkpoint decoding and the only writes to the FalkorDB projection and indexer pub/sub                                                                                             | Game authority, authored content                                                    |
| `packages/server`      | Initial snapshots, graph reads, subscriptions, presence/chat/fight relay, one reducer per connection                                                                               | Durable game truth, chain writes                                                    |
| `packages/protocol`    | Client/server packet types, parsing, domain routing lists, shared wire-safe projections                                                                                            | Independent gameplay state                                                          |
| `packages/frontend`    | App reducers, effect observers, UI, local prediction, reconciliation                                                                                                               | Direct `@mysten` access, authoritative game state                                   |
| `packages/engine`      | Terrain, models, cameras, audio, effects, rendering, collision presentation                                                                                                        | Network, wallet, gameplay authority                                                 |
| `seed/`                | Authored items, mobs, spells, recipes, worlds, boards, distributions, Mastery offers, structures, and assets                                                                       | Live player state                                                                   |
| `pins.json`            | Deployment lineage, shared object addresses, and published content fingerprints                                                                                                    | Authored gameplay values                                                            |

Dependencies point toward smaller owners: frontend composes engine/fight/immutable/protocol/SDK;
server composes engine/fight/protocol; protocol composes fight/immutable. Engine, fight, and
immutable do not depend on application packages.

## State and effects

The frontend and server use the same shape:

```text
input ──▶ pure reducer ──▶ new state ──▶ observer ──▶ effect
                                      effect result ──▶ new input
```

- One reducer owns each stateful domain.
- Callbacks, promises, timers, sockets, and render loops never write stores directly.
- Long-lived mutable maps belong inside an observer or reducer boundary and are not game truth.
- Selected UI state derives from per-identity state; it is not maintained as a synchronized
  second copy.
- Presentation fires from state deltas. Events may enrich a delta but do not make arrival order
  authoritative.

The player app and `/demo` arm different observers. The player app owns wallet/server effects;
the demo owns content editing and local simulation. Their arming sets live in
`packages/frontend/src/app_modules.ts` and are census-tested.

## Chain write law

The frontend never imports `@mysten/*`. It asks the SDK to compose a transaction from resolved
objects, simulates the exact unsigned bytes, signs once, executes once, and folds the certified
receipt. An executed failure has a digest and is never automatically retried. Each SDK session
retains the last executed digest and lazily waits for that transaction to become visible through
its write transport before resolving or signing the next write. This propagation barrier never
delays the completed receipt; if it fails, the next transaction remains unsubmitted.

The SDK logs every certified transaction once with digest and net gas. Its receipt-fed cache owns
fresh object references; explicit hydration is the only bootstrap read for unknown transaction
inputs, while the lazy previous-digest barrier synchronizes consecutive writes. Two narrow
presentation reads are explicit exceptions: Party may snapshot one external
character checkpoint for run-to, and a chat item hover may read that exact Item plus its rolled
stat field through a session-bounded LRU. Package type identity uses original package IDs;
Move-call targets use latest package IDs.

## Projection law

The indexer is a layout twin of Move and the sole FalkorDB writer. Output objects and deleted
pre-state write the graph. Events publish receipt/lifecycle facts; authoritative object writes
may publish full-row invalidations after projection. The graph is a rebuildable current-state
cache, not another authority.

Each indexer owns one private disposable FalkorDB and can run independently in any location.
Nothing coordinates or migrates databases between indexers; a destroyed store replays from the
original package publication and reconstructs every graph and chain-analytics projection.

Production ingests historical checkpoints from the official HTTP checkpoint store, then follows
the live edge through the fullnode gRPC checkpoint subscription. Helm requires that streaming
endpoint, and the HTTP source remains only backfill and failure fallback; an omitted production
stream is a render error, never a silent polling deployment.

The same sequential checkpoint pass owns a separate rebuildable analytics projection in that
indexer's FalkorDB. Successful calls across the game-package lineage write exact UTC activity
membership plus one first-interaction timestamp per address. Exact money and Character lifecycle
observations are stored once in daily buckets; the server derives chart intervals at read time and
reads the current Character count from the graph. Only high-volume active-player membership is
pre-bucketed into 15-minute, hourly, daily, weekly, and calendar-month sets. Successful game
transaction volume stores one replay-safe numeric count per checkpoint in those same visible
buckets plus a permanent all-time hash. Net gas uses the same checkpoint identity for every
submitted gameplay attempt, including executed failures, while deployment-only core calls and
publish, upgrade, and seed transactions contribute neither gas nor player/address activity.
Rebuilding analytics means replaying that indexer from the original publication checkpoint.

Item deltas are bidirectional: current kiosk custody streams the complete row, while pre-state
custody streams removal when an item moves away or is destroyed. Clients never retain absent graph rows.

Indexer writes complete before their pub/sub notification. The server can therefore re-read the
graph on a notification or gap. Async reads are latest-request-wins per identity.

`packages/indexer/src/gates.rs` pins decoded layouts and routed event fields against compiled Move
bytecode. A Move layout or event change is incomplete until the indexer twin and its consumers
pass those gates.

## Realtime server law

Each connection owns one server reducer tracking every allowed character. The graph Redis carries
`evt:*` chain projections. The mesh Redis carries only ephemeral presence, chat, heartbeats, and
fight-action courtesy relays.

Online history is the deliberate exception to chain replay: authenticated websocket presence is
off-chain. Server heartbeats collapse cluster totals into one-minute samples, 15-minute aggregates
through seven days, and daily aggregates afterward. The admin surface labels their separate source
and freshness; the indexer never pretends it can reconstruct past connections.

The server sends an ordered initial snapshot; `packet/characters` is the ready barrier. After
that, graph events and narrow reads push deltas. The server validates identity, locality, rate,
and relay voice, but it never becomes game authority.

Reader processes boot independently of projection freshness. The server pushes its cached
checkpoint lag every five seconds; a connected client blocks interaction while freshness is
unknown or more than 300 checkpoints behind, shows rolling progress and ETA, and unlocks
automatically inside that safe window.

## Critical workflows

### Authentication

The frontend obtains an Enoki or wallet-backed signing session, then opens the websocket. The
server issues a challenge and verifies the personal-message signature. Until
`packet/connection_accepted`, the socket carries no application packets. One address owns one live
connection; replacement is terminal until the player explicitly reconnects. Login reads no game
state from chain—the app becomes ready only after the server's indexed snapshot.

### World actions

The selected character's projected checkpoint and live pose compose one SDK action. Move proves
travel and writes the result. The receipt folds facts it certifies; the indexer/server projection
reconciles surrounding world state. Each discovered zone is a deterministic shared object derived
under its slim World. Only first discovery mutates World to claim that address; refresh, gather, and
engage mutate the target Zone, so unrelated zones never share a consensus write. Zone populations
are server-derived from published content, never re-rolled by the client. WorldContent stores
seed-derived ordinary-mob-to-archimob mappings
in an upgrade-safe dynamic field. Move and the server twin use a separate deterministic stream to
give every generated eligible member one independent 1% identity replacement while preserving its
group, position, and level scalar.

Party run-to is the sole direct player checkpoint read. The authenticated SDK reads another
member's current-world and checkpoint dynamic fields once, refuses a different world, then the
client runs toward that immutable snapshot. It never polls or claims to know the member's live pose.

### Fights

Core Move owns Fight identity, player authority, character custody, entropy, events, and settlement.
`packages/move-combat` owns the deterministic authority-free state machine embedded in that object.
Core authenticates an action and supplies bounded plain entropy and time values; combat returns one
deterministic transition. Fight entropy is pipelined one boundary ahead: each boundary executes the
previously committed `u64`, then its terminal Random draw commits the next one. An out-of-gas retry
therefore repeats the same combat result without adding a second transaction. `packages/fight` is
the TypeScript presentation twin. Local drafts relay
through the mesh for immediate presentation; End Turn commits the ordered draft as one PTB. Receipts
and indexed witnesses converge through structural turn identities.

The terminal checkpoint supplies the settlement plan after presentation drains. Owned participants
returning to one personal kiosk settle and collect through one Random-bound PTB; different kiosks
form separate batches. Team drop selection uses entropy sealed when combat ended, while settlement
Random rolls only fixed-shape item statistics. The certified settlement receipt enables Continue immediately. `RESULT_FOR`
exists only for interrupted-client recovery. Character level and experience come from the projected
Character row. Result presents before level-up.

Biome structure packs own sparse deterministic slots, weighted voxel types, terrain-fit limits, and an optional
integer scale range. Each placement derives its type, 90-degree rotation, and scale from its world cell. Search
margins derive per pack, so a colossal landmark never makes dense tree packs scan its footprint. A biome may opt
into rare engine-shaped mountain passes or ravines; the canonical column sampler subtracts their feathered cuts
before city terrain, so near terrain, far terrain, preview, scatter, and collision consume the same surface.

World content owns cities: fixed 3x3 regions, stable slugs, anchors, structure packs, and one dungeon slug each.
Dungeon content independently owns each stable dungeon slug, key, and ordered room composition.
The `/demo` content editor authors both sources directly. City structures and map entrances derive
from world content; zone discovery carries no copied portal fact.
The city build registry maps a slug to one city-specific deterministic compiler; cities share artifact mechanics,
not a universal settlement grammar. Each compiler owns its complete 3x3 land-use map, sparse eight-block target
height grid, structures, and local dressing rules. Thebes plans organic streets, a river, fields, gardens, districts,
and connected WFC interiors; other cities may instead preserve ravines, terraces, caves, or fortifications. One
target-height adapter drives near terrain, far terrain, collision, roads, bridges, and plateaus. Generated voxel
operations are tri-state: absent preserves procedural terrain, a material adds or replaces it, and explicit air
subtracts it. The same operation function owns render and collision occupancy, so caves create no parallel world
store or gameplay coordinate system; dungeon entrances remain at the authored surface anchor. Generation
partitions final operations into provenance-hashed, palette-compressed 32³ chunks. Runtime solves nothing:
workers compile terrain immediately, request only intersecting city artifacts, and decode/cache only intersecting
chunks. The ordinary collision and WebGPU voxel-mesh paths remain the consumers.

Dungeon runs are Character dynamic-field state coordinated by `packages/move/sources/dungeon.move`.
Entering proves travel to the authored city anchor and burns the dungeon's key. Rooms compose
ordinary fights; the fight machine has no parallel dungeon path. A run stores only dungeon slug,
room, and committed seed. The server/UI scope its lobby by dungeon slug, while Move remains the
authority on legal run and room transitions.

Mastery is one soulbound derived object per address. Once per Sui epoch, an owned free Character
proves access to a player-chosen WorldContent; Move draws one of that world's city dungeons and
snapshots the entry-level reward. Any owned winner may validate it only through a final-room Fight
created in the assigned world strictly after assignment. Missing an epoch expires the spendable score.
Seed-authored MasteryOffer objects exchange that score for statless items. Loot-box rewards retain
their existing open/claim randomness, while direct consumables such as reset scrolls mint directly.
Seed-authored airdrops and giftcards create portable distribution vouchers. An eligible external
holder pays to send its airdrop voucher to the authenticated game wallet; that wallet pays a
separate redemption into its personal kiosk. Redemption is the one final-item mint: statless items
and fixed-endpoint pets need no entropy, and pet feed scaling keeps the stored endpoint neutral
until the owner feeds the pet. Printed cards use an AresRPG `/gift` URL whose fragment carries the
zkSend bearer key across Google login; zkSend transports the voucher to the game wallet, then the
same ordinary redemption path runs. The bearer fragment never reaches the server.
The private operator prepares printable bearer files before its named web-signer action; no wallet
private key or generic transaction surface exists in this repository.

### Content

JSON under `seed/content/` is the authoring truth. The `/demo` editors change those files without
arming a wallet session. Validation rejects invalid structure before publication. The admin SDK
diffs authored content against published content and writes only the required batches. See
`CONTENT_UPGRADES.md` for the operational ceremony.

### Marketplace

Sui Kiosk objects own listings and custody. The indexer projects the current market and sales
history. The server pushes one observed category window plus aggregate counts. The frontend
reconciles packets and its own certified receipts in one marketplace reducer.

## Extending the system

Before adding anything, locate the existing owner and compose it. A new fact requires an explicit
owner. A new projection names that owner and stays read-only. A new effect enters through the
owning reducer. A new cross-language twin receives a mechanical parity gate.

A change is architecturally complete when it can be explained as:

```text
owner changed → contract changed → every projection changed → old path deleted → invariant sealed
```

If the explanation needs two owners for one fact, the data model is wrong.

## Documentation ownership

- `ARCHITECTURE.md`: current system topology and laws.
- `DECISIONS.md`: active rulings and their motives; search the domain being changed.
- `AGENTS.md`: repository working agreement, safety, and required gates.
- `.claude/rules/code-law.md`: detailed rationale for executable TypeScript lint laws.
- `CONTENT_UPGRADES.md`: content and package publication operations.
- `CONTRIBUTING.md`: branch, release, and contributor workflow.
- Package READMEs: package-specific operation only; they do not redefine this file.
- Changelogs, provenance, source lists, and `worlds-study/`: history or research, never current
  architecture.
