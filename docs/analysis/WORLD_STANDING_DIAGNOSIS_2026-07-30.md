# World-standing diagnosis (#1714)

Base: `origin/edge` at `9ff166ceb5c29fbaa04ea8025ee77d2a20e29a34`.

Decision: diagnosis only. The observed abort is not a missing zone-standing
filter: zones abort 112 is the format-3/member-door polarity guard
(`packages/move/aresrpg/sources/zones.move:15-27`,
`packages/move/aresrpg/sources/zones.move:537-543`). More importantly, character
creation does not write world membership; it schedules a second transaction
after the mint receipt (`packages/frontend/src/roster/store.ts:274-308`,
`packages/move/aresrpg/sources/zones.move:181-206`). The fix-scope instruction
therefore requires the design-fork stop. No Move or application source was
changed.

## 1. Boot-TX census

The direct scene boot is read-only. `GameWorldHost` selects a character, reads
the RPC world binding, reads checkpoint/biome, restores the local position, and
then mounts the scene (`packages/frontend/src/GameWorldHost.tsx:238-315`,
`packages/frontend/src/GameWorldHost.tsx:324-350`). `game/embed.js` performs a
targeted character read before dynamically mounting `embed_voxel.js`
(`packages/frontend/src/game/embed.js:74-103`,
`packages/frontend/src/game/embed.js:115-131`,
`packages/frontend/src/game/embed.js:148-177`). The voxel checkpoint recovery
explicitly performs a read plus local teleport/cache flush and says it submits
no transaction (`packages/frontend/src/game/embed_voxel.js:436-465`).

Transactions reachable automatically from the surrounding host/world-shell are:

| Transaction site                           | Boot or mount trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Composition/submission                                                                                                                                                                                                                                                                                                                                                                                       | Idempotence / repeat-burn verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate item-stack merge                 | An authenticated entry at `/` or `/characters` starts `boot_roster`; its background `load_roster` calls the sweep after the owned-item snapshot (`packages/frontend/src/GameWorldHost.tsx:169-185`, `packages/frontend/src/roster/boot_roster.js:41-75`, `packages/frontend/src/roster/load_roster.js:188-222`). A transaction is attempted only when no fight is active and at least one duplicate pair exists, capped at 32 pairs (`packages/frontend/src/world-shell/auto_merge_stacks.js:49-56`).                                                                               | `submit_stack_merges` composes `sdk.merge_stacks_ptb` and submits it through `run_tx('merge_stacks', …)` (`packages/frontend/src/chain/write/write_stack_merge.js:20-48`).                                                                                                                                                                                                                                   | Non-idempotent: success deletes source objects. A module-session latch is consumed before submit, so there is at most one attempt per app session; the latch resets next boot, executed failures can burn again next boot, and bags over the 32-pair cap intentionally require later boot transactions (`packages/frontend/src/world-shell/auto_merge_stacks.js:30-36`, `packages/frontend/src/world-shell/auto_merge_stacks.js:53-75`).                                                                                                                                                                                                                                     |
| Stranded pet-claim collection              | Every authenticated `GameWorldHost` mount starts the sweep (`packages/frontend/src/GameWorldHost.tsx:187-198`). A durable local-storage gate must work, `/v1/pet-claims` must return an eligible claim, and each claim is processed sequentially (`packages/frontend/src/world-shell/lootbox_actions.js:232-285`).                                                                                                                                                                                                                                                                  | Each claim composes `sdk.claim_pet_ptb` and submits `run_tx('claim_pet', tx)` (`packages/frontend/src/world-shell/lootbox_actions.js:151-194`).                                                                                                                                                                                                                                                              | Non-idempotent: success consumes `PetBoxClaim`. It is once per address per module session, cross-tab locked, and an executed/ambiguous failure is durably excluded from later automatic boots; only a proven zero-gas/pre-execution refusal remains boot-eligible (`packages/frontend/src/world-shell/lootbox_actions.js:216-240`, `packages/frontend/src/world-shell/lootbox_actions.js:243-266`). There may be multiple transactions in one boot, one per stranded claim (`packages/frontend/src/world-shell/lootbox_actions.js:263-284`).                                                                                                                                 |
| Cold-boot unjoined/ghost-world healer      | `GameWorldHud` mounts `DiscoveryPrompts` (`packages/frontend/src/game/screens/hud/world/GameWorldHud.jsx:279-285`). Its 10-second character-doc view returns a reason only for an identity-matched explicit `world: null`, or a world absent from the live catalog (`packages/frontend/src/game/screens/hud/world/DiscoveryPrompts.jsx:92-115`, `packages/frontend/src/game/screens/hud/world/world_travel_state.js:37-64`). The effect then calls `auto_join_world` (`packages/frontend/src/game/screens/hud/world/DiscoveryPrompts.jsx:159-198`).                                 | `auto_join_world` builds `join_world_ptb`; self-pay submits through `run_tx`, while eligible zkLogin sessions may submit through the sponsor path (`packages/frontend/src/world-shell/world_join.js:138-195`). The PTB calls `zones::join_world` (`packages/sdk/src/sui/write/game_world.js:62-92`).                                                                                                         | Repeat-burn risk. The guard is only a module-session `Set`, consumed before send (`packages/frontend/src/world-shell/world_join.js:95-103`, `packages/frontend/src/world-shell/world_join.js:138-142`). A fresh reload re-arms it. If `/v1` is stale-null/stale-ghost, `zones::join_world` executes even when a checkpoint already exists: it preserves that checkpoint, rewrites the world field, and emits `WorldJoined` (`packages/move/aresrpg/sources/zones.move:181-206`). It also automatically migrates a character between worlds, contrary to the recorded manual-switch-only ruling (`packages/frontend/src/game/screens/hud/world/world_travel_state.js:47-64`). |
| First-character receipt auto-join          | This is not a cold-boot transaction, but its executor is armed at scene mount. The first free mint and a paid mint that is the wallet's first settled character call `begin_join` after the mint receipt (`packages/frontend/src/roster/store.ts:274-308`, `packages/frontend/src/roster/store.ts:383-401`, `packages/frontend/src/roster/store_reducer.ts:105-140`). `embed_voxel` wires the request effect (`packages/frontend/src/game/embed_voxel.js:530-545`), which calls the same `auto_join_world` path (`packages/frontend/src/world-shell/join_request_effect.js:25-47`). | Same separate `zones::join_world` PTB and self-pay/sponsor submission as the healer (`packages/frontend/src/world-shell/world_join.js:146-195`, `packages/sdk/src/sui/write/game_world.js:67-91`).                                                                                                                                                                                                           | Non-idempotent separate transaction. It is once per character per module session; a failed first attempt is not retried in that session, but a later reload can enter the cold-boot healer above (`packages/frontend/src/world-shell/world_join.js:95-103`, `packages/frontend/src/world-shell/world_join.js:138-142`). Additional paid characters are deliberately not adopted/auto-joined (`packages/frontend/src/roster/store.ts:326-336`, `packages/frontend/src/roster/store_reducer.ts:129-140`).                                                                                                                                                                      |
| Owned-party follower world alignment       | Scene mount calls `wire_party_reads` and `wire_group_loop`, then `wire_group_loop` immediately resynchronizes (`packages/frontend/src/game/embed_voxel.js:530-545`, `packages/frontend/src/world-shell/group_wiring.js:156-164`, `packages/frontend/src/world-shell/group_wiring.js:209-264`). Once party/roster truth says an owned follower is in a different world from the selected leader, the reducer emits `join_world`; same-world followers only emit a read (`packages/party/src/group_loop.js:395-463`).                                                                 | The edge automatically calls `join_world_action` for each emitted row (`packages/frontend/src/world-shell/group_wiring_core.js:133-145`), which builds and submits `run_tx('join_world', tx)` (`packages/frontend/src/world-shell/world_join.js:105-128`).                                                                                                                                                   | Non-idempotent automatic world switch. The reducer preserves an existing in-memory follower row and latches digest-bearing failures, but a fresh app rebuilds that state from indexed roster/party truth (`packages/frontend/src/world-shell/group_wiring_core.js:118-131`, `packages/party/src/group_loop.js:418-436`). A stale cross-world roster can therefore cause another rejoin burn on a later boot; it also violates manual-switch-only semantics.                                                                                                                                                                                                                  |
| Boot fight liquidation / forfeit           | The first spawn poll calls `resume_world_fight` once for the selected character (`packages/frontend/src/game/world_spawns.js:329-348`). A live expired fight is read and classified, but the boot resume supplies a consent dialog before any transaction (`packages/frontend/src/world-shell/world_fight.js:352-405`, `packages/frontend/src/world-shell/fight-liquidation.js:282-301`).                                                                                                                                                                                           | Only after the player chooses rejoin does it compose/submit `turns::force_start` or `turns::crank`; choosing forfeit uses `actions::abandon` (`packages/frontend/src/world-shell/fight-liquidation.js:291-306`, `packages/frontend/src/world-shell/world_fight.js:382-405`, `packages/frontend/src/world-shell/dungeon_actions.js:434-461`, `packages/frontend/src/world-shell/dungeon_actions.js:505-520`). | **Not an automatic boot spend now.** No consent means no PTB. A chosen liquidation is once per deadline/deduped on a digest; forfeit is an explicit choice (`packages/frontend/src/world-shell/fight-liquidation.js:249-253`, `packages/frontend/src/world-shell/fight-liquidation.js:291-314`).                                                                                                                                                                                                                                                                                                                                                                             |
| Resumed-board automatic turn/deadline work | If boot resumes a still-presentable fight, the mounted board subscribes to the reducer's due edge. A due player turn submits even with a zero-action draft (`packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx:928-949`). Each refreshed non-spectated fight also probes expired placement/turn deadlines (`packages/frontend/src/world-shell/dungeon_run_store.js:1243-1262`).                                                                                                                                                                                         | The due edge calls `commit_turn`; deadline janitors call the same `force_start`/`crank` writers above (`packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx:934-948`, `packages/frontend/src/world-shell/fight-liquidation.js:64-117`, `packages/frontend/src/world-shell/fight-liquidation.js:120-168`).                                                                                          | Automatic after the fight is mounted, not an unconditional scene-boot send. Turn commits are keyed/latch-protected per exact fight/entity/deadline, and janitors are single-flight/deduped per deadline (`packages/fight/src/turn_commit.js:78-108`, `packages/frontend/src/world-shell/fight-liquidation.js:69-117`).                                                                                                                                                                                                                                                                                                                                                       |

Negative census findings:

- `write_follow_checkpoint` is named like a write but mutates only the module
  `_cache` and returns a local acknowledgement; it creates no PTB
  (`packages/frontend/src/world-shell/world_checkpoint.js:303-319`).
- Ordinary world-position persistence is IndexedDB on a five-second cadence, not
  on-chain (`packages/frontend/src/world-shell/spawns_adapter.js:74-95`).
- Fast-travel wiring merely subscribes on mount; it calls the world-join writer
  only after a traveler state transitions to `joining`
  (`packages/frontend/src/world-shell/fast_travel_effects.js:111-130`).
- Zone search is only registered as an `[F]` prompt at HUD mount; composition is
  below the human trigger (`packages/frontend/src/game/screens/hud/world/DiscoveryPrompts.jsx:221-251`).

Therefore app boot does **not** have a zero-transaction invariant. At minimum,
the authenticated host has conditional pet-claim and stack-merge spenders, the
HUD has the null/ghost world healer, and party restoration can automatically
switch owned followers (`packages/frontend/src/GameWorldHost.tsx:169-198`,
`packages/frontend/src/game/screens/hud/world/DiscoveryPrompts.jsx:164-198`,
`packages/frontend/src/world-shell/group_wiring_core.js:133-145`).

## 2. Creation auto-enter

No. The free creation builder calls
`creation::create_character_free`, then `character::lock_in_kiosk`; it never
calls `zones::join_world`
(`packages/sdk/src/sui/write/items_creation.js:140-223`). The paid builder has
the same create-then-lock shape
(`packages/sdk/src/sui/write/items_creation.js:233-315`). Move creation funnels
both paths through `mint_character`, which calls `character::new_brand` and
returns the character/lock pledge
(`packages/move/gifting/sources/creation.move:159-192`,
`packages/move/gifting/sources/creation.move:195-226`). The new character's base
fields end at its position anchor; there is no world field in the base object
(`packages/move/aresrpg/sources/character.move:160-180`).

World membership first gets written by the separate
`zones::join_world` call. On first join it creates
`CheckpointKey { world }`, then calls `character_link::y1` to upsert
`WorldFieldKey` with the world ID
(`packages/move/aresrpg/sources/zones.move:181-206`,
`packages/move/aresrpg/sources/character_link.move:42-46`,
`packages/move/aresrpg/sources/character_link.move:106-111`). The authoritative
membership read is `world_field`, and `in_world` requires that option to equal
the requested world (`packages/move/aresrpg/sources/character_link.move:420-433`).

For the first character only, the frontend schedules that second transaction
from the receipt: selection and `begin_join` are paired
(`packages/frontend/src/roster/store_reducer.ts:105-111`), the session fold emits
`join_request` (`packages/world/src/session_gate.js:114-131`), and the mounted
edge calls `auto_join_world`
(`packages/world/src/session_gate.js:245-256`,
`packages/frontend/src/world-shell/join_request_effect.js:29-47`). A true
additional paid character is left off-world by the creation flow
(`packages/frontend/src/roster/store.ts:326-336`,
`packages/frontend/src/roster/store_reducer.ts:129-140`).

Exact fork: making “creation puts every character in a world and a character is
never off-world” true requires changing the creation/transaction design so the
membership/checkpoint write is atomic with every mint, and deciding the
destination for additional characters. Keeping the current two-transaction
receipt effect necessarily permits an off-world state if the second
transaction is delayed or fails
(`packages/frontend/src/roster/store.ts:274-308`,
`packages/frontend/src/world-shell/join_request_effect.js:34-47`). This is the
fix-scope's explicit stop case, so no source was modified.

## 3. The abort-112 seam

Abort 112 is `zones::EMemberZone`: “this zone derives MEMBER LISTS (format 3) —
claim it through the member doors”
(`packages/move/aresrpg/sources/zones.move:22-27`). The exact failing predicate
is:

```move
let format = y162(world, zx, zy);
if (members) assert!(format == 3, ENotMemberZone)
else assert!(format != 3, EMemberZone);
```

That predicate is at
`packages/move/aresrpg/sources/zones.move:537-543`. `y162` reads the on-chain
`ZoneGroupCommitment` sibling field and extracts its root's format byte
(`packages/move/aresrpg/sources/zones.move:775-783`). Thus 112 proves that the
client called an original/single-spec claim door while that on-chain commitment
was format 3.

It is not the world-standing predicate, a travel flag, or a checkpoint abort:

| Gate                 | Predicate and abort                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| World membership     | `character_link::in_world(character, wid)`, zones 102 (`packages/move/aresrpg/sources/zones.move:521-525`).                                                                                                                                                                                                        |
| Per-world checkpoint | `character_link::has_checkpoint(character, wid)`, zones 103 (`packages/move/aresrpg/sources/zones.move:523-526`).                                                                                                                                                                                                  |
| Claim-door polarity  | Original door requires format != 3; failure is zones 112 (`packages/move/aresrpg/sources/zones.move:537-543`).                                                                                                                                                                                                     |
| Travel               | Runs only after format and group authentication; failures are `world::ECheckpointFuture`/`ETravelTooFar`, codes 120/121 in the **world** module (`packages/move/aresrpg/sources/zones.move:544-555`, `packages/move/aresrpg/sources/world.move:689-703`, `packages/frontend/src/game/core/abort_copy.js:248-250`). |

No change to character standing can cure 112. To pass the common claim gauntlet,
the character must have `WorldFieldKey == wid`, have that world's checkpoint,
name a live group, and satisfy travel; but a format-3 group additionally requires
`claim_mob_group_in_zone_members` (or its occupied-zone twin), not the original
door (`packages/move/aresrpg/sources/zones.move:381-407`,
`packages/move/aresrpg/sources/zones.move:521-565`). The SDK's correct member
composer calls that member door, consumes the `MemberGroupTicket` through
`fight::open_group`, adds each committed member, and closes with
`fight::create_members` (`packages/sdk/src/fight.js:314-417`). The original
composer instead calls `claim_mob_group[_in_zone]`, which is exactly the door
format 3 rejects (`packages/sdk/src/fight.js:184-294`).

The frontend selects between those composers solely from
`member_template_ids.length`
(`packages/frontend/src/world-shell/dungeon_engage_actions.js:198-201`,
`packages/frontend/src/world-shell/dungeon_engage_actions.js:251-280`). The
observed on-chain 112 therefore proves that the rendered/request row arrived
without its format-3 member roster and the original composer was submitted.
The current abort-copy table has no zones-112 mapping, only 108 and 110, so any
“wrong zone / travel” label is not the Move predicate that actually failed
(`packages/frontend/src/game/core/abort_copy.js:252-269`).

## 4. The disagreement

### Render path

The scene renders against the frontend session-binding home, not a fresh
character-object membership read: it accepts a world only when the binding
store's character ID matches the selected character
(`packages/frontend/src/game/world_spawns.js:269-279`). That binding is normally
published from the `world` field each row of `/v1/characters` carries
(`packages/frontend/src/world-shell/session_gate.js:122-140`). A stale binding
could make the client render an old world's groups, but the corresponding Move
failure would be zones 102, not the witnessed 112
(`packages/move/aresrpg/sources/zones.move:521-525`).

For groups, the renderer:

1. reads the discovered-zone list on the shared six-second `/v1/zones` poll
   (`packages/frontend/src/rpc/zones_poll.ts:1-24`);
2. selects the current chain zone plus up to eight adjacent discovered zones
   and reads each single-zone state
   (`packages/frontend/src/game/world_spawns.js:329-383`,
   `packages/frontend/src/rpc/client.ts:406-422`);
3. accepts a state as resolvable when both consumed bitmaps are arrays—the
   eligibility test does **not** require `group_root`
   (`packages/frontend/src/game/zone_rows.js:92-132`);
4. derives live rows from seed/root/bitmaps, dropping only consumed bits
   (`packages/sim/src/zone_derive.js:609-621`,
   `packages/sim/src/zone_derive.js:637-721`);
5. feeds every derived row to the core and then places each mob once templates
   and terrain resolve
   (`packages/world/src/spawns_reconcile.js:145-153`,
   `packages/world/src/spawns_zones.js:404-417`,
   `packages/frontend/src/game/world_spawns.js:291-327`,
   `packages/frontend/src/game/world_spawns.js:434-482`).

The `/v1` single-zone document carries `group_root`, but explicitly serves
`null` for either a genuine pre-commitment zone **or snapshot lag**
(`packages/rpc/api/views.js:716-736`,
`packages/rpc/api/views.js:757-773`). The JavaScript format decoder treats an
absent root as legacy format 1
(`packages/sim/src/zone_derive.js:170-182`). It therefore derives and renders
mono-spec rows with no `.members`; the claim reducer turns absent `.members`
into an empty `member_template_ids` list
(`packages/sim/src/zone_derive.js:649-721`,
`packages/world/src/spawns_zones.js:146-171`).

### The two disagreeing homes

- **Client derivation-format home:** nullable `/v1` zone
  `group_root`, where absence is interpreted as legacy format 1
  (`packages/rpc/api/views.js:769-772`,
  `packages/sim/src/zone_derive.js:170-182`).
- **Move claim-format home:** the actual on-chain
  `ZoneGroupCommitment` sibling dynamic field, whose root byte is read by
  `y162` immediately before the claim-door assertion
  (`packages/move/aresrpg/sources/zones.move:537-543`,
  `packages/move/aresrpg/sources/zones.move:775-783`).

When the first home is null/stale while the second is format 3, the client
renders legacy-shaped rows, emits an empty member roster, selects the original
claim composer, and Move rejects it with 112 before group lookup or travel
(`packages/frontend/src/game/zone_rows.js:124-132`,
`packages/world/src/spawns_zones.js:158-170`,
`packages/frontend/src/world-shell/dungeon_engage_actions.js:263-280`,
`packages/move/aresrpg/sources/zones.move:537-548`). This is the concrete
render-visible/on-chain-eligible disagreement behind the witness.

A press normally tries to shrink this disagreement with fresh chain-direct zone
and commitment reads
(`packages/frontend/src/world-shell/dungeon_engage_actions.js:142-180`). But
that gate deliberately selects the derivation/original door when the commitment
read returns null
(`packages/frontend/src/world-shell/dungeon_engage_actions.js:97-100`). If the
read side reports no commitment while the authoritative Move dynamic field is
format 3, the preflight admits the old door and the format assertion produces
the witnessed 112
(`packages/frontend/src/world-shell/dungeon_engage_actions.js:97-100`,
`packages/move/aresrpg/sources/zones.move:537-543`).

A blind client filter on `group_root == null` is not an unambiguous small cure:
the RPC contract deliberately collapses “pre-commitment legacy zone” and
“snapshot lag” to the same null, while Move deliberately treats a genuinely
missing on-chain commitment as legacy format 1
(`packages/rpc/api/views.js:769-772`,
`packages/move/aresrpg/sources/zones.move:775-783`). Distinguishing those cases
needs a read-contract/design decision, and the broader creation-membership fork
already activates the requested diagnosis-only stop.

## Verification

No red/green fix run exists because no fix landed. Only this report is touched,
so there is no touched package-specific suite beyond the required frontend
suite.

The fresh clone initially had no `node_modules`. These were the raw first
attempts:

```text
$ bun run lint
$ NODE_OPTIONS=--max-old-space-size=6144 eslint . && prettier . --check && bun scripts/check-doc-file-references.mjs && bun run --cwd packages/sim lint && bash scripts/check-constraints.sh
/opt/homebrew/bin/bash: line 1: eslint: command not found
error: script "lint" exited with code 127
```

```text
$ bun run typecheck
$ bun run --cwd packages/engine typecheck && bun run --cwd packages/sdk typecheck && bun run --cwd packages/sim typecheck && bun run --cwd packages/frontend typecheck
$ tsc --noEmit --checkJs
/opt/homebrew/bin/bash: line 1: tsc: command not found
error: script "typecheck" exited with code 127
error: script "typecheck" exited with code 127
```

```text
$ cd packages/frontend && bun test src
bun test v1.3.5 (1e86cebd)

error: Cannot find package 'i18next-browser-languagedetector' from '/private/tmp/codex-lanes/world-standing/repo/packages/frontend/test/preload/i18n_detector_pin.js'

 0 pass
 518 fail
 518 errors
Ran 518 tests across 518 files. [107.00ms]
```

A copy of the matching local checkout's dependency tree was then staged inside
this ignored lane `node_modules` (no network and no tracked-file change).

### `bun run lint`

The first dependency-complete attempt was killed during ESLint:

```text
$ bun run lint
$ NODE_OPTIONS=--max-old-space-size=6144 eslint . && prettier . --check && bun scripts/check-doc-file-references.mjs && bun run --cwd packages/sim lint && bash scripts/check-constraints.sh
/opt/homebrew/bin/bash: line 1: 21386 Killed: 9                  NODE_OPTIONS=--max-old-space-size=6144 eslint .
error: script "lint" exited with code 137
```

The rerun completed ESLint and Prettier, then failed in later environment-bound
constraint gates. The decisive raw tail was:

```text
== AresRPG Move field-definition cap gate (all structs ≤ 32 fields) ==
  ↻ absent/stale build witness; running sui move build --path packages/move/aresrpg
  ✗ NO VERDICT: sui move build --path packages/move/aresrpg failed: Unexpected error acquiring lock for package at . (lock file: `/Users/sceatstudio/.move/git/.cdb4ee2aea69cc6a83331bbe96dc2caa9a299d21329efb0336fc02a82e1839a8.lock`): Operation not permitted (os error 1)

Caused by:
    Operation not permitted (os error 1)
MOVE FIELD-CAP GATE FAILED (nothing was judged). Fix the Move build error above, then re-run sui move build --path packages/move/aresrpg.

== AresRPG arch gate · semgrep (dataflow: laundered writes, fight effect-freedom, functor purity) ==
  semgrep failed (exit 2) on scripts/arch/fixtures/red:
    Fatal error: exception Failure("Failed to create system store X509 authenticator: ca-certs: empty trust anchors.\nPlease report an issue at https://github.com/mirage/ca-certs, including:\n- the output of uname -s\n- the distribution you use\n- the location of default trust anchors (if known)\n")
ARCH GATE (semgrep) FAILED.

== AresRPG zero-drift gate · world fight ≡ simulator fight (issue #914) ==
  ✗ FAIL: 2 unresolvable import(s) on a fight path — the module would throw at load:
      packages/frontend/src/p2p/lobby-room.js → @trystero-p2p/core
      packages/frontend/src/p2p/lobby-room.js → @trystero-p2p/mqtt
ARCH GATE (zero-drift: world fight ≡ simulator fight) FAILED.

CONSTRAINT GATES FAILED.
error: script "lint" exited with code 1
```

This is not a Prettier short-circuit: the command reached
`scripts/check-constraints.sh`. The source scan also reported `new_rogue=0`,
manifest lineage passed, fixture adjudication passed, SPDX passed, i18n passed,
dependency-cruiser passed, Move Display passed, and framework-rev passed before
the final aggregate constraint failure.

### `bun run typecheck`

```text
$ bun run typecheck
$ bun run --cwd packages/engine typecheck && bun run --cwd packages/sdk typecheck && bun run --cwd packages/sim typecheck && bun run --cwd packages/frontend typecheck
$ tsc --noEmit --checkJs
$ tsc --build
$ tsc --build
$ tsc --noEmit
```

Exit 0.

### `cd packages/frontend && bun test src`

The only failures were the three allowed live-network tests:

```text
$ cd packages/frontend && bun test src
bun test v1.3.5 (1e86cebd)

src/chain/read_templates.test.js:
error: Unable to connect. Is the computer able to access the url?
  path: "https://graphql.testnet.sui.io/graphql",
 code: "ConnectionRefused"
(fail) read_templates event-type regression (testnet) > get_item_templates resolves a non-empty catalog including pet_lootbox (item::TemplateCreated, category field)

src/chain/live_reads.test.js:
RpcError: Unable to connect. Is the computer able to access the url?
 methodName: "BatchGetObjects",
 serviceName: "sui.rpc.v2.LedgerService",
 code: "INTERNAL"
(fail) D105 live gRPC wrapper regression (testnet) > getObject(shared registry fixture) → `{ object }` wrapper unwraps to json + BigInt-able version

error: Was there a typo in the url or port?
  path: "https://graphql.testnet.sui.io/graphql",
 code: "FailedToOpenSocket"
(fail) D105 live gRPC wrapper regression (testnet) > get_owned_items(addr) → array (kiosk-union consumer smoke — getOwnedKiosks/getKiosk/getObject wrappers)

 4503 pass
 67 skip
 3 fail
 2 snapshots, 96837 expect() calls
Ran 4573 tests across 518 files. [28.68s]
```
