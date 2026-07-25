# SIMULATOR REBUILD — implementation spec

Status: conception-complete (2026-07-25). Replaces `packages/frontend/src/pages/simulator.tsx`
wholesale. Owner constitution: a pure LOCAL fight simulator — any of the 12 classes, roster of up
to 6 characters (the multi-account system), free level/stat/spell allocation, max-roll gear/pets/
relics/weapons, a random generated board, 1–6 mobs picked per start cell, place/start/stop, all
through `@aresrpg/sim` as the sole authority with chain randomness mocked locally, traces
exportable and replayable, ZERO drift from the real game (real generic modules only), fully
persisted in IndexedDB, no chain read or write.

All paths below are repo-absolute from `/Users/sceatstudio/dev/aresrpg/`.

---

## 1. Architecture — one sentence

The simulator runs the REAL sim reducer (`@aresrpg/sim/reduce`) as a local mock chain that emits
the REAL chain event vocabulary into the REAL fight core (`@aresrpg/fight/store`), which the REAL
render/HUD surfaces already consume — so the page is only: a setup reducer over IndexedDB, a
`sim_chain` authority module, and a mount.

```
IndexedDB ⇄ simulator page reducer (setup state: roster · loadouts · board · mob picks)
                     │  START
                     ▼
   sim_chain (NEW, packages/fight/src/sim_chain.js — the LOCAL CHAIN)
   · @aresrpg/sim/board_gen  → the board (chain twin: mask/obstacles/holes/start cells)
   · @aresrpg/sim/reduce     → THE AUTHORITY: reduce(state, command, ctx) per commit / ai_turn
   · encoder                 → sim events + post-state → chain rows (fight_events vocabulary)
                     │  input({type:'snapshot'}) once · input({type:'receipt'}) per turn batch
                     ▼
   @aresrpg/fight/store  (the ONE reducer door — production singleton `fight_store`)
                     │  projections (fight_view / presented_state / wave beats)
                     ▼
   production render + HUD: engine3 tactical board + voxel_fight_adapter + fight session HUD
                     │  trace tee on the same door
                     ▼
   exports: trace_format-2 capsule (fight core) + sim Capsule (timeline.js, carries the seed)
```

Key inversion vs the live game: in production the chain is the authority and `@aresrpg/sim` is
the prediction twin; here the sim IS the authority and the "chain" is a pure local encoder. The
fight core, adapter, HUD, prediction (`predict_cast`), pacing, beats, traces — all byte-identical
production code, untouched.

Determinism root: ONE u32 `fight_seed` shown in the top bar. It seeds `board_gen` (board),
`create_fight_state.rng` (every damage/crit/AI-adjacent roll — the sim threads `state.rng`
through `prng.js`), and mob level rolls. Same seed + same command list = byte-identical fight;
the seed rides both trace exports.

---

## 2. Module map — exact consumption (the drift-proof matrix)

Legend: GENERIC = consumed as-is, zero change. SEAM = a named, minimal change (listed §3).

| #   | Module (path)                                                                                                      | Simulator uses                                                                                                                                                | Verdict                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `packages/sim/src/reduce.js` (`@aresrpg/sim/reduce`)                                                               | `reduce`, `create_fight_state`, `HAND_SIZE` — the authority                                                                                                   | GENERIC                                                                      |
| 2   | `packages/sim/src/board_gen.js`                                                                                    | `board_seed_from_anchor`, `generate` — the chain board twin (mask/obstacles/holes/6+6 start cells)                                                            | SEAM S1 (export row only)                                                    |
| 3   | `packages/sim/src/fight_ai.js` (`@aresrpg/sim/fight_ai`)                                                           | via `reduce({type:'ai_turn'})` — mob turns                                                                                                                    | GENERIC                                                                      |
| 4   | `packages/sim/src/prng.js`, `turn_seed.js`                                                                         | seeded rng thread; turn-seed only for the deck-glow preview parity fields                                                                                     | GENERIC                                                                      |
| 5   | `packages/sim/src/spell_templates.js` + `chain_spell_corpus.js`                                                    | `normalize_chain_spell_corpus` over the published corpus rows → the sim template map                                                                          | GENERIC                                                                      |
| 6   | `packages/sim/src/equipment_stats.js`                                                                              | `fold_equipment_snapshot` (centered @32768 gear fold) — max-roll loadout → fight stats/ap/mp                                                                  | GENERIC                                                                      |
| 7   | `packages/sim/src/timeline.js` + `recorder.js`                                                                     | Capsule format + the client black box (`open_recording`/`observe_reduce_checked`/`dump_capsule`)                                                              | SEAM S1 (export rows only)                                                   |
| 8   | `packages/fight/src/store.js` (`@aresrpg/fight/store`)                                                             | the `fight_store` singleton + its ONE `input` door (init/snapshot/receipt/intent/predicted/tick/…)                                                            | GENERIC                                                                      |
| 9   | `packages/fight/src/inputs.js`, `project.js`, `present.js`, `board_state.js`, `los.js`, `statuses.js`, `weapon.js` | fold/projections/beats/cell codec (stride-20 `encode(x,y)`)/weapon strike                                                                                     | GENERIC                                                                      |
| 10  | `packages/fight/src/txs.js`                                                                                        | `subscribe_commit_due(store, { submit })` — submit is ALREADY dependency-injected: the simulator injects its LOCAL submit                                     | GENERIC (the load-bearing seam, already DI)                                  |
| 11  | `packages/fight/src/predict_cast.js`                                                                               | own-cast optimistic prediction (already sim-backed) — untouched, keeps working because the store sees ordinary snapshots/receipts                             | GENERIC                                                                      |
| 12  | `packages/fight/src/fight_control.js`                                                                              | `controlled_character_ids` / `selected_controlled_character_id` — THE multi-account seat controller (pure)                                                    | GENERIC                                                                      |
| 13  | `packages/fight/src/capsule.js`, `envelope.js`, `classify_input.js`, `v2/*`                                        | trace_format-2 capsules + v2 replay of them                                                                                                                   | GENERIC                                                                      |
| 14  | `packages/frontend/src/world-shell/fight_trace_tee.js`                                                             | `install_fight_trace_tee` — the door tap; simulator force-arms it (`__ARES_FIGHT_TRACE_ENABLED = true` on page mount)                                         | GENERIC                                                                      |
| 15  | `packages/frontend/src/game/screens/hud/fight_trace_export.js` + `FightReport.jsx`                                 | the result card's trace export button — the SAME export the game ships                                                                                        | GENERIC                                                                      |
| 16  | `packages/engine/src/engine.js` + `src/tactical/index.js` (`@aresrpg/engine3`, `/tactical`)                        | `create_engine` + `create_tactical_board` — standalone-mount precedent: `packages/engine/demo/board_demo.js`                                                  | GENERIC (+ SEAM S4 capsule placeholder)                                      |
| 17  | `packages/frontend/src/world-shell/voxel_fight_adapter.js` + `fight-engine/{phase,overlay_intents}.js`             | renderer #2 wiring: board build, entity specs, beats, cell paints, click relay                                                                                | GENERIC — store-seeded (dev_synth precedent); binding note §7 (cutover lane) |
| 18  | `packages/frontend/src/game/embed_voxel_fight_camera.js`                                                           | the locked-iso fight camera                                                                                                                                   | GENERIC                                                                      |
| 19  | `packages/frontend/src/game/dev/dev_synth_fight.js`                                                                | NOT consumed — it is the PRECEDENT for store seeding (use_dungeon/context/auth seeds, decoded-Fight shape)                                                    | reference only                                                               |
| 20  | `packages/frontend/src/game/data/spell_corpus.js`                                                                  | `load_spell_corpus`/`get_spell_corpus` — the published chain spell corpus (Walrus blob, NOT a chain read)                                                     | GENERIC                                                                      |
| 21  | `packages/frontend/src/game/data/mob_catalog.js`                                                                   | mob GLB resolution (Walrus blob)                                                                                                                              | GENERIC                                                                      |
| 22  | `packages/frontend/src/pages/encyclopedia/world_corpus.ts`                                                         | mob roster: names/roles/level bands/SPELLS (`CorpusMobSpell` = the real minted SpellLevels)                                                                   | SEAM S2 (combat block missing)                                               |
| 23  | `packages/frontend/src/content/seed_manifest.ts`                                                                   | living-content ids (mob/spell identity join) — build-inlined receipt, not a chain read                                                                        | GENERIC                                                                      |
| 24  | `packages/sdk/src/stats.js` (`@aresrpg/sdk/stats`)                                                                 | base AP 6 / MP 3, `get_max_health` (30 + 5·level + vitality), `get_total_stat`, `STATISTICS` vocabulary                                                       | GENERIC                                                                      |
| 25  | `@aresrpg/sdk/classes`, `@aresrpg/sdk/items-data`, `@aresrpg/sdk/jobs` (asset urls)                                | class list, the bundled item catalog with `stats: Record<key,[min,max]>` ranges (max roll = `range[1]`), icons                                                | GENERIC                                                                      |
| 26  | `packages/frontend/src/components/{items,search_picker_modal,entity_display}`                                      | ItemSlot paper-doll (kept-verbatim look), SearchPickerModal, stat/element color tokens                                                                        | GENERIC                                                                      |
| 27  | `packages/frontend/src/game/core/draft.js`                                                                         | the IndexedDB promise-wrapper PATTERN (copied shape, own DB)                                                                                                  | pattern reference                                                            |
| 28  | Roster loaders `packages/frontend/src/roster/{boot_roster,load_roster,store.ts}`                                   | NOT consumed (chain-coupled by design); the simulator seeds the engine store roster directly (`context.dispatch('action/sui_data', …)` — dev_synth precedent) | correctly out of scope                                                       |
| 29  | `packages/frontend/src/world-shell/dungeon_fight_shim.js`                                                          | NOT consumed — the PATTERN for the sim shim (thin ≤120-LoC shim, gate c verb-ban)                                                                             | reference only                                                               |
| 30  | Move sources `packages/move/engine/sources/{fight_events,mob,interleave}.move`, `foundation/sources/mob_ai.move`   | the encoder's shape oracle; `scaled_hp` formula (S3)                                                                                                          | oracle only                                                                  |

Verdict count: 24 modules truly generic, 4 named seams (S1–S4 below), 2 reference-only. No
parallel re-implementation anywhere.

---

## 3. Named seams (the ONLY non-consuming changes; each ≤30 lines, none a fork)

- **S1 — sim package export rows.** `packages/sim/package.json` lacks export entries for
  `./timeline`, `./recorder`, `./board_gen` (files exist, unexported). Add the three rows
  (+ `types/` mirrors like the sibling rows). Pure manifest change.
- **S2 — mob combat block.** The Fight-side mob truth (`MobSpec`: `base_hp, ap, mp, stats` —
  `packages/move/engine/sources/mob.move:52-62`) exists ONLY on chain; the published
  `world_corpus.json` blob carries mob spells + level bands but no combat block
  (`world_corpus.ts:33-41` CorpusMob), and `/v1` skips the stats tail (`rpc/views.ts:283`).
  Seam: (a) client-side, extend the `CorpusMob` interface with OPTIONAL
  `base_hp/ap/mp/stats` fields and have the simulator's mob builder consume them; (b) absent
  fields DEGRADE LOUDLY per the house content pattern: the mob row renders with a `COMBAT BLOCK
UNPUBLISHED` badge and falls back to `{base_hp: 50·max_level, ap: 6, mp: 3, stats: zero}` —
  flagged in the UI, never silent; (c) file ONE issue titled "world_corpus publish leg: include
  the MobSpec combat block" for the seed ceremony (content boundary: the blob is authored in the
  private repo — an issue, not a PR).
- **S3 — `scaled_hp` sim twin.** Port the 4-line pure formula
  (`packages/move/foundation/sources/mob_ai.move` `scaled_hp`) into
  `packages/sim/src/mob_stats.js` (new, exported) with the mirror-comment convention + a golden
  test replicating the Move values — the mob-level → hp derivation the builder uses. (It is a
  parity twin, the exact class of `board_gen.js`/`turn_seed.js` — sim is its home.)
- **S4 — capsule placeholder mesh.** The tactical entity path's model-miss fallback is the debug
  cube. Owner requirement: a CAPSULE mesh placeholder for classes/mobs without a GLB. Change at
  the ONE miss-path home inside `packages/engine/src/tactical/` (grep the debug-cube fallback):
  swap cube → `CapsuleGeometry` tinted by team color. One home, all consumers inherit it.
- **S5 — settlement edge (conditional).** The fight surface's terminal path must not fire chain
  claims on the simulator page. The shim contract already assigns settlement routing to the
  context shim (`dungeon_fight_shim.js` header, job (d)). The sim shim simply does not wire
  `settle_chain_latched`/claim; if at build time a chain-claim call is hard-imported inside the
  fight HUD surface (post-cutover layout may differ), extract it behind the shim seam (function
  injection, ≤20 lines) — never fork the surface, never let the simulator fire a tx.

---

## 4. `sim_chain` — the local chain (NEW: `packages/fight/src/sim_chain.js` + export row)

Home: `packages/fight` (sibling of `predict_cast.js` — it already composes `@aresrpg/sim` with
the chain action vocabulary; node-clean, fully bun-testable). Pure core + one thin driver.

### 4.1 State

```
{ seed, sim_state,            // @aresrpg/sim FightState (rng threaded inside)
  ctx,                        // { spell_templates: Map, arena }  (reduce's ReduceContext)
  board,                      // board_gen.generate output (mask/obstacles/holes/starts)
  version,                    // monotonic "object version", starts 1, +1 per emitted batch
  recorder }                  // @aresrpg/sim/recorder ring (the sim capsule black box)
```

### 4.2 Board (owner: "generate a random fight board")

`board_seed_from_anchor(WORLD_SEED, anchor_x, anchor_z)` with a seed-derived random anchor, then
`board_gen.generate(board_seed, 0)` → `{width, height, shape_mask, obstacles, holes,
start_cells_a, start_cells_b}` — the EXACT chain derivation (`board.move` twin, golden-pinned).
Derive the sim `Arena` from it: `cells` Uint8Array (off-mask/obstacle/hole ⇒ 1), `spawns_a/b`
from the start cells (decode stride-20 → `{x,y}` via `@aresrpg/fight/los` `decode`). REROLL =
new seed. The board renders ALONE IN THE VOID under a true isometric camera (§7) — the anchor still
picks WHICH board the chain derivation yields, it is no longer a place the board is rendered at.

### 4.3 Snapshot bootstrap

`snapshot_from_sim(sim_state, board, roster, mobs)` → the decoded-Fight shape the store's
snapshot door adopts (`board_state_from_fight` input). Shape oracle: the two existing
hand-builders — `world-shell/fight_board_simdrive.test.js:17-60` and
`game/dev/dev_synth_fight.js:71-119`. Fields: `id, status:1, width, height, participants[]
(owner: LOCAL_ADDRESS, character: sim_c<i>, class, team:0, hp/max_hp/ap/mp/base_ap/base_mp,
cell (encoded), ready, casts_this_turn:0, weapon)`, `mobs[] (level, hp/max_hp, cell, ap, mp)`,
`group_template, group_base_ap/mp, queue (from @aresrpg/sim/fight_state generate_turn_order —
the §17.28 interleave), turn_ptr, turn_deadline_ms, placement_deadline_ms, world_seed: BigInt,
spawn_id, obstacles, holes, shape_mask, start_cells_a/b, anchor_x, anchor_z`.
Dispatch: `fight_store.getState().input({type:'init', fight_id, my_key:null, ctx:{…}})` then
`input({type:'snapshot', fight, version:1})` — exactly the shim pattern
(`dungeon_fight_shim.js`), with `ctx.my_entity_id` = the focused roster character id and
`ctx.offset = {x:0, z:0}` identity codec (dev_synth precedent).

### 4.4 The event encoder — sim events → chain rows (THE mock the owner named)

`encode_sim_step(pre_state, post_state, sim_events) → [{type: '0xsim::fight_events::<Kind>',
parsedJson}]`, consumed by the store as `input({type:'receipt', version: ++v,
receipt:{events}})` — the same rows `normalize_events` decodes via the SDK's
`decode_fight_event` (`packages/fight/src/inputs.js:505`). Vocabulary oracle:
`fight_events.move` + the `apply_action` arms (`inputs.js:272-473`). Mapping (sim event names
from `packages/sim/src/reduce.js`):

| sim event                              | chain rows emitted                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fight_placed`                         | `Placed{character, cell}` (players) — mobs are pre-placed in the snapshot                                                                                                                                                                                                                                                                                                                             |
| `fight_ready`                          | `Ready{character}`                                                                                                                                                                                                                                                                                                                                                                                    |
| `fight_started`                        | nothing (the start is visible as the first `TurnStarted`)                                                                                                                                                                                                                                                                                                                                             |
| `fight_turn_start`                     | `TurnStarted{is_mob, idx, deadline_ms}` — deadline stamped `now + TURN_MS` (real-time UX like the chain's `clock + turn_ms`; determinism lives in the sim commands, not the clock)                                                                                                                                                                                                                    |
| `fight_turn_end`                       | `TurnEnded{is_mob, idx}`                                                                                                                                                                                                                                                                                                                                                                              |
| `fight_turn_skipped`                   | `TurnEnded{…}` for the skipped seat (stun/dead skip)                                                                                                                                                                                                                                                                                                                                                  |
| `fight_moved` (player)                 | `Moved{character, to_cell}` (path end; the renderer re-walks the path — production behavior)                                                                                                                                                                                                                                                                                                          |
| `fight_moved` (mob)                    | `MobMoved{idx, to_cell}`                                                                                                                                                                                                                                                                                                                                                                              |
| `fight_moved.tackled`                  | `Tackled{runner_is_mob, runner_idx, ap_lost, mp_lost}` (deltas from pre→post pools)                                                                                                                                                                                                                                                                                                                   |
| `fight_cast`                           | `Cast{caster_is_mob, caster_idx, target_cell}` + per effect, in order: `Hit{victim_is_mob, victim_idx, amount, remaining_hp}` (remaining_hp read from POST-state — authoritative, never re-derived), `Displaced{target_is_mob, target_idx, to_cell}`, `Drain`/`Granted{target…, point_kind, removed/granted}`, `StatusAdded{target…, status}` for timed effects, `CriticalFailure{caster…}` on fumble |
| `fight_trap_triggered`                 | its `effects` encode exactly like a cast's (Hit/Displaced/…)                                                                                                                                                                                                                                                                                                                                          |
| `fight_turn_effects` (DoT/glyph ticks) | `Hit` rows per damage tick / `Granted` per heal-shaped tick                                                                                                                                                                                                                                                                                                                                           |
| `ap_reserve_used`                      | `Granted{point_kind:0, granted}`                                                                                                                                                                                                                                                                                                                                                                      |
| `hand_update`                          | NOT a chain row — forwarded as the store's own `input({type:'hand_update', hand})` (name_keys)                                                                                                                                                                                                                                                                                                        |
| `fight_ended`                          | `Victory{}` (winner 0) / `Defeat{}` (winner 1) / DRAW (winner 2) → `Defeat` + a page-level DRAW banner                                                                                                                                                                                                                                                                                                |

Effect-record field shapes: read `packages/sim/src/fight_spells.js` (`process_spell_cast`
effects) and `fight_actions.js` at implementation time — the encoder switches on
`effect.type`. Every unmapped effect type must `throw` in dev (loud), never silently drop.

**The drift gate (mandatory, RED-first):** `packages/fight/src/sim_chain.test.js` — for a
scripted multi-turn fight (moves, casts w/ AoE + displacement + DoT + trap + a death + victory),
fold the encoder's rows through `apply_action` and assert the OBSERVABLE PROJECTION (cell / hp /
alive / active / winner per fighter) equals the sim post-state's own projection at every batch
boundary. This is the "one observable, two folders" twin contract (`packages/fight/src/v2/
fold.js` header) applied to the mock — the mechanical proof the mock cannot drift.

### 4.5 The submit door (player turns) — zero new seams

Production already injects submit: `subscribe_commit_due(store, { submit })`
(`packages/fight/src/txs.js:31`). The simulator's submit:

1. read `staged` intents → sim commands (`move` with the drafted path, `cast{spell_id, target}`
   decoded to `{x,y}`, `end_turn`) — the staged shapes are the same the PTB composer reads
   (`turn_commit.js compose_turn_actions`);
2. fold each through `reduce(sim_state, cmd, ctx)`, tap the recorder
   (`observe_reduce_checked` — physics tripwires live);
3. encode all resulting events → ONE receipt batch → `input({type:'receipt', version:++v, …})`;
4. return `{ok:true}`. Errors → `{ok:false, error}` (the core rolls the prediction back itself).
   No PTB, no gas, no digest — and the production optimistic-prediction/reconcile machinery
   (predict_cast → 'predicted' → receipt claim/retire) runs UNCHANGED against these receipts.

### 4.6 Mob turns

On any emitted `TurnStarted{is_mob:true}` the driver (after the presentation wave for the prior
batch, next macrotask) folds `reduce(sim_state, {type:'ai_turn', entity_id}, ctx)` → one receipt
batch. The AI is `@aresrpg/sim/fight_ai` — the deterministic on-chain-policy skeleton; its
"chain &Random" weighted draw is exactly what the owner said to mock: the sim's seeded thread.
Consecutive mob turns chain until a player seat's TurnStarted lands.

### 4.7 STOP / restart

STOP mid-fight = `reduce({type:'abandon'})` per living roster seat → terminal rows → the result
card; or (setup shortcut) `input({type:'init', fight_id:null})` teardown + page reducer back to
`setup`. START always builds a FRESH `fight_id` (`sim:<seed>:<n>`).

---

## 5. Content & builders (all chain-free)

New module `packages/frontend/src/simulator/content.js` (pure; unit-tested):

- **Classes**: `@aresrpg/sdk/classes` (12). Class GLBs via the character-create path
  (`game/screens/character-glb.js` / `character-pedestal.js` precedent); missing model ⇒ S4
  capsule.
- **Spells**: `game/data/spell_corpus.js` blob → `normalize_chain_spell_corpus` → the sim
  template map; per-class grouping via the corpus rows' class field + `seed_manifest.spells`.
  Spell LEVELS: baseline 1, raised freely up to each template's `levels.length`; spell points
  budget = `(level − 1)` (chain law: `character_link.move:505-510`), stat points =
  `(level − 1) × 5` (`character_link.move:538-544`). The editor enforces both budgets.
- **Items (max roll)**: `@aresrpg/sdk/items-data` (bundled catalog; `stats:
Record<key,[min,max]>`). MAX ROLL = `range[1]` per stat — derived, never hardcoded. Fold to
  the centered wire (`32768 + value` per `ITEM_STAT_CATALOG_ORDER`) and through
  `fold_equipment_snapshot` (`@aresrpg/sim/equipment_stats`) → `{stats, ap_max, mp_max}`.
  Slots = the paper-doll set the old page proved (6 relics + HEAD/AMULET/HANDS/CHEST/WEAPON/
  RING1/RING2/BELT/PET/LEGS/FEET); weapon filtered by the class's weapon category; pets at
  full power (their stat contribution at range max).
- **Character → fight seat**: hp/max_hp via `get_max_health` (`@aresrpg/sdk/stats` — 30 +
  5·level + vitality where vitality = allocated + gear), base AP 6 / MP 3 + gear ap/mp deltas
  (the `fold_equipment_snapshot` outputs), stats = allocated + centered gear fold. Also stamp the
  seeded engine-store character records with the `equipment_stats` aggregate so the production
  HUD's `stats_of` reads feed `predict_cast` identically.
- **Mobs**: `world_corpus.ts` mob rows (identity/role/level band) + `CorpusMobSpell` rows →
  sim spell templates (they are the real minted SpellLevels; convert via the same
  `normalize_chain_spell_corpus` shape); combat block per S2; hp via S3 `scaled_hp`; GLB via
  `mob_catalog.js`; level slider clamped to `[minLevel, maxLevel]`, default = band roll from the
  fight seed.

---

## 6. Multi-account roster + IndexedDB (the page's own reducer domain)

**The finding:** the game's multi-account machinery is ALREADY generic — seat control is
`packages/fight/src/fight_control.js` (pure: `controlled_character_ids(participants, address)` +
auto seat-focus), the core re-resolves `my_key` from `ctx.my_entity_id` on every `ctx` input
(`store.js` 'ctx' arm), and team joins are DI-generic (`owned_team_actions_core.js`). Only the
roster LOADERS are wallet/chain-coupled — and those are correctly not reused. The simulator's
"identity provider" is therefore just data:

- `LOCAL_ADDRESS = '0xsim…'` (one constant); every roster character's `owner` = it ⇒
  `controlled_character_ids` returns all seats ⇒ the production seat-focus switching drives the
  whole roster — the owner's "multi account simulation" with zero new mechanism.
- Seat focus switch = `input({type:'ctx', ctx:{my_entity_id: <char id>}})` (the production
  MULTICHAR path, `store.js` 'ctx' arm) + the same auto-focus `fight_control` selector the live
  board uses.
- Engine-store seed for HUD surfaces: `context.dispatch('action/sui_data', {characters,
loaded:true, …})` + `use_dungeon.setState({fight_id, phase:'playing', mob_names/levels/
elements, in_session:false, …})` — the dev_synth_fight proven seed set (`dev_synth_fight.js:
168-205`).

**Page reducer** (FP constitution: ONE reducer per stateful domain):
`packages/frontend/src/simulator/reducer.ts` — pure
`reduce_simulator(state, input) → state` over:

```
{ phase: 'setup' | 'fight',
  seed: number,
  roster: SimCharacter[≤6],        // {id:'sim_c1'…, name, class_id, male, colors, level,
                                   //  stat_alloc{6}, spell_levels{}, loadout{slot→template_id}}
  focus_id: string | null,
  board: { anchor:{x,z}, generated } ,
  mob_picks: { cell:number → {template_id, level} },     // red start cells
  placements: { cell:number → character_id },            // blue start cells
  fight: { fight_id, version } | null }
```

Vanilla zustand store, one `input` door; IndexedDB is a PERSISTENCE EDGE: a store subscriber
flushes (debounced) to IDB, boot hydration re-enters through `input({type:'hydrated', …})` —
no async write into the store ever (deep-tier law).

**IndexedDB** (pattern: `game/core/draft.js` promise wrapper — copy the 30-line helper shape):
DB `aresrpg_simulator` v1, stores: `roster` (key = character id), `setup` (key `'current'`:
seed/board/mob_picks/placements/focus), `traces` (last 10 exports, key = `<fight_id>`).

---

## 7. Render + HUD mount

`packages/frontend/src/simulator/mount.js` — the page's imperative composition (the
`board_demo.js` standalone precedent, upgraded to production wiring):

1. `create_engine` (`@aresrpg/engine3`) into the page canvas with `void_scene: true` — the world
   composition MINUS the world: no streaming ring, no far shell, no cloud deck, no ambient particles,
   a near-black backdrop, and an ORTHOGRAPHIC camera at the tactical tilt (owner ruling 2026-07-25:
   "do not show the terrain, show the void with a single fight board, isometric view"). The renderer,
   lighting and every mount seam stay the world's own. Quality prefs via `quality_pref.js`.
2. `create_tactical_board` (`@aresrpg/engine3/tactical`).
3. `create_voxel_fight_adapter` (`world-shell/voxel_fight_adapter.js`) — the production
   renderer-#2 wiring: entities (real GLBs + S4 capsules), beats, VFX/SFX, cell paints,
   click relay (placement picks + turn drafting).
4. `create_fight_camera` (`game/embed_voxel_fight_camera.js`) — the locked-iso fight camera.
5. SETUP-mode painting rides the adapter's placement channels: blue cells = `start_cells_a`
   (placement picks), red cells = `start_cells_b` (mob pick targets — a setup-phase click on a
   red cell opens the mob picker; this one interaction is simulator-owned UI, the paint itself
   is the adapter's placement channel).
6. Fight session HUD: mount the PRODUCTION fight surface components (today:
   `game/screens/hud/world/DungeonBoard.jsx` + `DeckCluster` + `FightReport`) inside the page
   shell, stores seeded per §6. **Binding note:** the fight-truth cutover lane is actively
   moving `world-shell/fight_*` + `game/core/modules/fight.js` — the implementing worker binds
   to whatever the fight surface's mount component is AT BUILD TIME (grep GameWorldHud's fight
   branch), consumes only its public mount + the seeded stores, and applies S5 if a chain-claim
   is hard-wired. Never copy the surface.
7. Trace tee: set `window.__ARES_FIGHT_TRACE_ENABLED = true` before `install_fight_trace_tee`
   on page mount — the ring records every door input from the first fold.

Engine lifecycle: single mount per page visit, `destroy()` on unmount; never touch the game
world session singleton (`embed_voxel.js` is NOT imported — its D158 singleton belongs to the
game world tab).

---

## 8. Trace export — byte-compatible, two formats, both replayable in-repo

| Format                                                   | Home (the format's constitution)                   | Produced by                                                                                                       | Replayed by                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| trace_format-2 envelope capsule                          | `packages/fight/src/capsule.js` (`capsule_export`) | the door tee (`fight_trace_tee.js`) → the SAME FightReport export button the game ships (`fight_trace_export.js`) | `packages/fight/src/v2/replay.js` (`replay_trace`)                                                                                    |
| sim Capsule (arena + templates_raw + initial + commands) | `packages/sim/src/timeline.js`                     | `sim_chain`'s recorder (`recorder.js dump_capsule`), meta carries `{seed, fight_seed}`                            | `timeline.js replay_capsule` — the replay-gate door; a captured fight IS a fixture candidate for `packages/sim/test/fixtures/replay/` |

The TRACE button (top bar + result card) downloads both as one JSON
(`aresrpg-simfight-<seed>-<fight_id>.json` `{sim_capsule, envelope_capsule}`), and appends to
the IDB `traces` ring. The sim capsule is the deterministic one (commands + seed ⇒ byte-stable
re-fold); the envelope capsule replays the presentation/fold pipeline.

---

## 9. UI concept (gothic terminal — power tool)

Tokens from the house DNA (read `pages/simulator.tsx` + encyclopedia): near-black `#0c0c14`,
gold `#c8963c`, cyan accents, JetBrains Mono, 8–10px uppercase tracking-[0.2em] micro-labels,
sharp corners, 1px `rgba(255,255,255,0.06)` borders, `rgba(255,255,255,0.02)` fills. Dense,
keyboard-friendly, everything visible at once on desktop; the page is a TOOL, not a shop window.

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ SIMULATOR   SEED [c81f3a92]⟳   BOARD 14×9 ANCHOR (812,-64)⟳   ▷ START  ■ STOP  ⤓ TRACE │
├──────────────┬────────────────────────────────────────────────┬────────────────────┤
│ ROSTER       │                                                │ INSPECTOR          │
│ ┌──┐┌──┐┌──┐ │                                                │ [char: KAELIS]     │
│ │C1││C2││C3│ │           VOXEL BOARD VIEWPORT                 │ CLASS  senshi ▾    │
│ └──┘└──┘└──┘ │   (engine3 terrain + tactical board +          │ LEVEL  [200]       │
│ ┌──┐┌──┐┌+─┐ │    production fight adapter)                   │ STATS 995/995 pts  │
│ │C4││C5││  │ │                                                │  VIT [400] WIS [0] │
│ └──┘└──┘└──┘ │   setup: blue cells ← click to place roster    │  STR [595] INT [0] │
│ FOCUS: C2    │          red  cells ← click → MOB PICKER       │  CHA [0]  AGI [0]  │
│──────────────│   fight: production board input (draft/cast)   │ SPELLS 199/199 pts │
│ MOBS (3/6)   │                                                │  [spell rows + lvl]│
│ · c12 Aether…│                                                │ LOADOUT (max roll) │
│   LV 18  ✕   │                                                │  [relic rail +     │
│ · c07 Gronk… │                                                │   paper-doll grid] │
├──────────────┴────────────────────────────────────────────────┴────────────────────┤
│ FIGHT HUD strip (production spell deck / turn controls / timer — fight phase only) │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Flows (each maps 1:1 to an owner requirement):

1. **Roster**: `+` on an empty slot → class picker (12 classes, capsule/GLB preview via the
   pedestal component) → a named character appears; click a card → INSPECTOR edits it; ✕ with
   confirm deletes. All edits hit the page reducer and persist (reload-proof).
2. **Level/stats/spells**: level input 1–200; stat inputs budgeted `(lvl−1)×5` with live
   remaining counter; spell rows (the class's real corpus spells) with level steppers budgeted
   `(lvl−1)`; RESET buttons per section.
3. **Loadout**: paper-doll (the old page's kept-verbatim ItemSlot look) → SearchPickerModal
   filtered per slot; every equip shows the max-rolled stat block in its tooltip; right-click/
   long-press clears (keep the old page's proven touch handling).
4. **Board**: seed + anchor rerolls regenerate + repaint instantly (setup phase only).
5. **Mob picks**: click red cell → searchable mob picker (portrait, role badge, level band) →
   level stepper within band; up to 6; ✕ per row.
6. **Placement**: click blue cell with a roster card focused → place; only placed characters
   fight; swap by re-click.
7. **START/STOP** as §4.5/§4.7; during the fight the production HUD owns input; seat focus
   auto-follows the active owned seat (`fight_control`), manual override by clicking a roster
   card.
8. **Result card** = the production FightReport (trace export button included) + `REMATCH`
   (same seed) / `NEW SEED` actions.
   i18n: every new string in all six locales (`packages/frontend/src/i18n/locales/`), same commit
   as the surface introducing it.

---

## 10. What dies · what is kept

DIES (wholesale, same PR as the replacing route): `pages/simulator.tsx` (1332 ln — the legacy
STAMINA/COOLDOWN stat calculator; its math in `constants/simulator.ts` predates the AP/MP model
entirely), `pages/simulator_content.ts` (189 ln — the camelCase/levelsJson bridge feeding that
dead math), `constants/simulator.ts` (verify no other importer; delete what only the old page
used), their tests. KEPT (as noted in-code once already): the ItemSlot paper-doll composition +
SearchPickerModal flow + the class-grid styling — re-expressed in the new setup panel.
`/simulator` route path stays (`app.tsx:203-210` — swap the lazy import target).

Known accepted divergences (documented, not bugs): (1) the deck crit GLOW preview derives from
§7 turn-seed snapshot fields while the sim authority rolls crits on its rng thread — the glow
may mispredict in the simulator (cosmetic; the sim's roll is the truth; a follow-up may thread
sim pre-rolls into ctx); (2) turn deadlines are real-clock (UX) — replay determinism rides the
sim capsule's command list, never the clock.

---

## 11. LANE PLAN (Opus workers, ≤~90 min each, file-disjoint; every slice ends green on

`bun run test && bun run lint && bun run typecheck` at repo root — the CI-exact invocations)

**L0 — page shell + reducer + persistence (VISIBLE FIRST).**
Files: `packages/frontend/src/simulator/{reducer.ts,persistence.ts}`,
`packages/frontend/src/pages/simulator.tsx` (REPLACED: new shell — top bar, three panes, roster
CRUD + inspector class/level/stat/spell editors, no board yet), i18n ×6, tests for the reducer
(budget clamps, hydration round-trip) + a persistence test.
Acceptance: `/simulator` renders the new shell; create 6 characters, allocate, reload → state
survives (IDB); old simulator code deleted; gates green.

**L1 — content module.**
Files: `packages/frontend/src/simulator/content.js` (+ `content.test.js`), S2 client half in
`world_corpus.ts` (optional fields + loud degrade), S3 `packages/sim/src/mob_stats.js`
(+ golden test), S1 export rows in `packages/sim/package.json`.
Acceptance: unit tests prove max-roll fold vs hand-computed vectors from 3 real items (one
negative-stat item included), class seat build (hp/ap/mp) vs the sdk formulas, mob build with
and without the combat block (degrade path asserted), `scaled_hp` golden matches Move values.

**L2 — `sim_chain` core (the mock chain).**
Files: `packages/fight/src/sim_chain.js` (+ export row), `packages/fight/src/sim_chain.test.js`.
Pure only — no frontend imports. Board derivation, snapshot builder, encoder, submit fold,
ai-turn fold, recorder tap, capsule dump.
Acceptance (RED-first): the §4.4 twin-observable parity test over a scripted fight covering
move/tackle/cast/AoE/displacement/DoT/trap/status/death/victory; a determinism test (same seed +
commands twice ⇒ identical trace digests via `timeline.js digest`); a physics test (zero
tripwire violations across the scripted corpus).

**L3 — board viewport mount (setup phase).**
Files: `packages/frontend/src/simulator/mount.js`, S4 capsule fallback in
`packages/engine/src/tactical/`, wiring into the page (board pane), placement + mob-picker
interactions, mob picker component.
Acceptance: driven proof (screenshot per the repo's verification law): reroll regenerates the
board in the void; blue-cell placement paints; red-cell click opens the picker (verified against the
ORTHOGRAPHIC projection — ray construction differs); a placed GLB-less class shows a capsule.

**L4 — fight phase end-to-end.**
Files: `packages/frontend/src/simulator/fight_shim.js` (the sim context shim: store seeds §6,
`subscribe_commit_due` local submit, mob-turn driver, seat focus, STOP), HUD mount per §7.6
(+ S5 only if needed), trace tee arming + TRACE button + IDB traces ring.
Acceptance: driven full fight vs 2+ mobs with 2+ roster characters — place, start, cast spells
from the real deck, mob turns animate, seat focus switches, kill → production result card; STOP
mid-fight works; TRACE downloads the dual capsule; `replay_trace` + `replay_capsule` of the
downloaded file both fold clean in a bun test.

**L5 — QA + audit pass.**
Sad paths first: empty roster START (blocked with reason), 0 mobs (blocked), death of the
focused seat (focus falls to next owned living seat — `fight_control` selector), DRAW banner,
reload mid-fight (fight state is NOT persisted — page returns to setup with roster intact, by
design), i18n completeness sweep, `bun run lint`+`typecheck`+`test` + the review checklist
(`.claude/skills/review/SKILL.md`).

Dependency order: L0 → L1 → L2 are parallel-safe after L0 merges the directory skeleton
(L1/L2 are file-disjoint from L0 and each other); L3 needs L1+L2; L4 needs L3; L5 last.

## 12. Open questions

None. The two judgment calls a worker might stumble on are decided above: mob combat data =
S2 (loud degrade + seed-side issue, never a hardcode presented as truth), and the fight HUD
binding under the live cutover = §7.6 binding note + S5.
