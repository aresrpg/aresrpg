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

| Home                 | Owns                                                                                                     | Must not own                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/move-math` | Pure on-chain values, validation, curves, grids, deterministic transforms                                | Objects, capabilities, clocks, entropy, state writes |
| `packages/move`      | Sui objects, authority, custody, dynamic fields, events, randomness, clocks, state transitions           | Browser or indexer policy                            |
| `packages/fight`     | Deterministic TypeScript fight runtime and presentation inputs mirroring Move                            | Chain access, React, rendering                       |
| `packages/immutable` | Shared TypeScript vocabularies and tested mirrors of stable game math                                    | Live state, network access                           |
| `packages/sdk`       | Every client-side Sui transaction, PTB composition, object-ref cache, receipt projection, gas accounting | Player-facing reads, app state                       |
| `packages/indexer`   | Checkpoint decoding and the only writes to the FalkorDB projection and indexer pub/sub                   | Game authority, authored content                     |
| `packages/server`    | Initial snapshots, graph reads, subscriptions, presence/chat/fight relay, one reducer per connection     | Durable game truth, chain writes                     |
| `packages/protocol`  | Client/server packet types, parsing, domain routing lists, shared wire-safe projections                  | Independent gameplay state                           |
| `packages/frontend`  | App reducers, effect observers, UI, local prediction, reconciliation                                     | Direct `@mysten` access, authoritative game state    |
| `packages/engine`    | Terrain, models, cameras, audio, effects, rendering, collision presentation                              | Network, wallet, gameplay authority                  |
| `seed/`              | Authored items, mobs, spells, recipes, worlds, boards, shops, structures, and assets                     | Live player state                                    |
| `pins.json`          | Deployment lineage, shared object addresses, and published content fingerprints                          | Authored gameplay values                             |

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
receipt. An executed failure has a digest and is never automatically retried.

The SDK logs every certified transaction once with digest and net gas. Its receipt-fed cache owns
fresh object references; explicit hydration is the only bootstrap read for unknown transaction
inputs. Package type identity uses original package IDs; Move-call targets use latest package IDs.

## Projection law

The indexer is a layout twin of Move and the sole FalkorDB writer. Output objects and deleted
pre-state write the graph. Events publish receipt/lifecycle facts; authoritative object writes
may publish full-row invalidations after projection. The graph is a rebuildable current-state
cache, not another authority.

Indexer writes complete before their pub/sub notification. The server can therefore re-read the
graph on a notification or gap. Async reads are latest-request-wins per identity.

`packages/indexer/src/gates.rs` pins decoded layouts and routed event fields against compiled Move
bytecode. A Move layout or event change is incomplete until the indexer twin and its consumers
pass those gates.

## Realtime server law

Each connection owns one server reducer tracking every allowed character. The graph Redis carries
`evt:*` chain projections. The mesh Redis carries only ephemeral presence, chat, heartbeats, and
fight-action courtesy relays.

The server sends an ordered initial snapshot; `packet/characters` is the ready barrier. After
that, graph events and narrow reads push deltas. The server validates identity, locality, rate,
and relay voice, but it never becomes game authority.

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
reconciles surrounding world state. Zone populations are server-derived from published content,
never re-rolled by the client.

### Fights

Move owns the fight object. `packages/fight` is its deterministic presentation twin. Local drafts
relay through the mesh for immediate presentation; End Turn commits the ordered draft as one PTB.
Receipts and indexed witnesses converge through structural turn identities.

The terminal checkpoint supplies the settlement plan after presentation drains. The certified
settlement receipt enables Continue immediately. `RESULT_FOR` exists only for interrupted-client
recovery. Character level and experience come from the projected Character row. Result presents
before level-up.

Dungeon runs are Character dynamic-field state coordinated by `packages/move/sources/dungeon.move`.
Rooms compose ordinary fights; the fight machine does not gain a parallel dungeon combat path.
World content owns the key and ordered room compositions. The server/UI scope a lobby to one
portal for presentation, while Move remains the authority on legal run and room transitions.

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
