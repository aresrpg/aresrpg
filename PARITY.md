# PARITY — the four-view divergence census (#1336)

**Question:** do solo, coop, spectate and simulator fold, project and render the SAME fight?
**Verdict:** yes — one pipeline, verified rather than assumed. The bug was the **missing ratchet**, not a
divergent view. This document is the census that establishes it, and the new gate is what keeps it true.

Commit `75184fbb` ("route every viewer through one chain fold") claimed the property. It shipped a real
enforcement floor — a dependency-cruiser rule fencing the raw chain decoder to `core_inbox.js`, and
`viewer_fingerprint_parity.test.js` proving the **headless core** is viewer-free for actor / partner /
spectator. Both stop below the layer the player actually sees, and neither knows the simulator exists.

---

## 1 · The one pipeline

Every view is the SAME zustand singleton (`packages/fight/src/store.js` `fight_store`), the SAME write door
(`store.js:131 make_input` — the one-reducer law), the SAME canonical fold, and the SAME projections. A view
composition is allowed to differ in exactly two ways: the `ctx` its shim supplies at `init`, and which
ingresses carry rows to the door. Nothing else.

```
raw bytes ─→ decode ─→ classify ─→ core ingest ─→ canonical fold ─→ projections ─→ renderers
```

| hop               | file:line                                 | role                                                            |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------- |
| the one door      | `packages/fight/src/store.js:131`         | `input(msg, now)` — the only writer of fight state              |
| envelope bridge   | `packages/fight/src/classify_input.js:47` | door message → `fight_input` union, total                       |
| core fold wrapper | `packages/fight/src/store.js:82`          | folds the core FIRST, then the presentation adapter             |
| source routing    | `packages/fight/src/core_ingest.js:83`    | `ingest_chain_read` — snapshot / receipt / poll / p2p / journal |
| the ONE decoder   | `packages/fight/src/core_inbox.js:294`    | `board_state_from_fight` — sole rich-view decode home           |
| committed truth   | `packages/fight/src/core_project.js:92`   | `project_board` — the only committed-state owner                |
| presentation fold | `packages/fight/src/fold.js:119`          | `recompute` — pacing, retirement floor, provider token          |
| presented/display | `packages/fight/src/fold.js:323,329`      | the two wave-masked projections                                 |
| board projection  | `packages/fight/src/project_views.js:140` | `board_view`                                                    |
| engine projection | `packages/fight/src/project_views.js:227` | `engine_view`                                                   |
| memoized door     | `packages/fight/src/project.js:23,29`     | `engine_view_of` / `fight_view` — one memo per state            |

---

## 2 · Per-view chain, raw input → rendered state

### solo — `verdict: SAME FOLD`

| hop                         | file:line                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| chain read → snapshot door  | `packages/frontend/src/world-shell/dungeon_run_store.js:1071` (`sync_dungeon_fight`, ctx built at `:1075-1086`)    |
| journal pager → `'journal'` | `packages/frontend/src/rpc/fight_journal.js:63` → `dungeon_run_store.js:135`                                       |
| SSE frames → the same door  | `fight_stream_link.js:39` → `dungeon_run_store.js:1242` (`if (owns()) fight_store.getState().input(message, now)`) |
| own-cast receipts           | `dungeon_run_store.js:1286`, `:1377`, `:1445` (`type:'receipt'`)                                                   |
| own prediction              | `dungeon_run_store.js:1389` (`rollback`), DungeonBoard `optimistic_cast` → `type:'predicted'`                      |
| fold                        | `store.js:188 reduce_chain_input` → `core_ingest.js:101` → `fold.js:119 recompute`                                 |
| render                      | `project_views.js:227 engine_view` → `voxel_fight_adapter.js:1092 drain_wave` / `DungeonBoard.jsx`                 |

### coop — `verdict: SAME FOLD` (solo + one extra ingress that cannot move truth)

Everything above, plus the party transport's courtesy channel:

| hop                     | file:line                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| peer relay in           | `packages/frontend/src/p2p/lobby-room.js:254` → `game/screens/fight-stream.js:114 apply_peer_batch` |
| the door's courtesy arm | `store.js:251` — legality-gated, enters as `source:'intent'`, **paints only**                       |
| retirement by claim     | `core_ingest.js:56 reconcile_courtesy`                                                              |
| placement ghosts        | `store.js:233` — cosmetic; overlaid on the fighter Map only (`project_views.js:417`)                |

Courtesy rows never reach canonical truth: they are stamped `intent`, and `fold.js:128` filters the
authoritative tail on `source !== 'intent'` before anything commits. **Proven, not asserted** — the gate drives
the coop leg with a live courtesy relay and its canonical sequence is byte-identical to solo's.

### spectate — `verdict: SAME FOLD`

| hop                              | file:line                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| entry                            | `packages/frontend/src/world-shell/world_fight.js:100 spectate_world_fight` → `dungeon_fight_shim.js:34` |
| ctx                              | `dungeon_run_store.js:1076-1079` — `address: null`, `my_entity_id: null`, `spectator: true`              |
| ingress                          | the SAME `refresh()` + journal walk + SSE link; no receipts, no intents                                  |
| seatlessness is in the FOLD      | `fold.js:141-142` (`my_key = null`), `fold.js:106 provider_of`                                           |
| local pushes refused at the door | `store.js:109` — `LOCAL_PUSH` requires `provider === 'local_turn'`                                       |

The spectating branches in `dungeon_run_store.js:1149,1174,1189` gate **side effects only** (settlement, claim,
liquidation) and every one of them reads `project.board_view(...)` — the same projection. No second status math.

### simulator — `verdict: SAME FOLD`

| hop             | file:line                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| local chain     | `packages/fight/src/sim_chain.js` — `@aresrpg/sim` is the authority; this is a pure encoder                                |
| bootstrap       | `packages/frontend/src/simulator/fight_shim.js:301` (`type:'snapshot'`, `snapshot_from_sim`)                               |
| ctx             | `fight_shim.js:279-300` — same keys, `LOCAL_ADDRESS`, `beat_ctx.grid_width` imported from `GRID_W`                         |
| drive           | `fight_shim.js:100 feed` → `type:'receipt'` through the same door                                                          |
| status encoding | `sim_chain_events.js:133 status_rows_from_sim` → `statuses.js:112 status_row_of` — the SAME encoder `predict_cast.js` uses |

The simulator inverts production (sim is the authority, the "chain" is the encoder) but consumes the identical
door, fold and projections. Its only structural asymmetry is transport coverage: it delivers `receipt` rows
exclusively and therefore never exercises the `journal` admission leg (`core_ingest.js:117`). Both legs
converge on `admit_verified` with `how: 'observed'`, so this is a coverage note, not a divergence.

---

## 3 · What was checked for, and what was found

| divergence class hunted           | method                                                                 | result                                                             |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| a second committed fold           | `apply_action` call-site census                                        | confined to `packages/fight/src/**` — zero frontend re-folds       |
| a second decoder                  | `board_state_from_fight` call-site census                              | one caller (`core_inbox.js:294`), depcruise-fenced                 |
| two byte sources, two normalizers | `normalize_journal_page` census                                        | one normalizer, two transports (SSE + pager) by design             |
| per-view damage math              | resistance / hp-arithmetic sweep across `frontend/src`                 | none — all damage resolves in `@aresrpg/sim`                       |
| per-view status math              | status-encoder census                                                  | one home (`statuses.js status_row_of`), shared by sim + prediction |
| per-view blocked-cell math        | `presentation_blocked_cells` census                                    | one home, three call sites                                         |
| per-view legality                 | `peer_batch_legality`, `overlay_intents`, `predict_cast`               | one home each                                                      |
| projected-state divergence        | **empirical replay of a recorded fight through all four compositions** | **zero differing canonical steps**                                 |

The empirical run is the load-bearing one: the production capture `trace_0x3f6103fb…c33a.json` (1307 recorded
door messages, 8 distinct canonical fingerprints, a real mob death) driven through all four compositions
produced **identical canonical image sequences, step for step**.

---

## 4 · Deleted

**`store.fold` — a dormant second fold door on the store's public surface** (`store.js:441`, now removed).

```js
fold: (log) => log.reduce(apply_action, empty_state(get().fight_id)),
```

Zero callers repo-wide — not one test, not one tool. It folded a raw log from `empty_state`, bypassing the
snapshot base, the append-only retirement floor and the accept machine entirely: a second committed-state
answer, reachable from every consumer that already holds the store, sitting one autocomplete away from
`committed_truth`. The one-reducer law says `input()` is the only writer and `committed_truth` the only
committed reader; this was a third path with no reason to exist. Deleted, with its now-unused `apply_action` /
`empty_state` imports.

---

## 5 · The class gate

`packages/fight/test/four_view_parity.test.js` — one recorded event sequence, four real store compositions,
byte-identical canonical projections asserted step for step.

It compares the **chain-committed** image read through the projections the product renders from
(`board_view(...).committed`, `engine_view(...).committed_*`, `fight_fingerprint`). Presentation pacing is
deliberately excluded: my own turn paints at click while a peer's paces over ~3s, and that asymmetry is the
design, not a bug. What every viewer must agree on is what the chain says happened.

**All four already agreed — the gate ships as the ratchet, and it has teeth:**

- non-vacuity is asserted in-test: > 4 canonical steps, > 2 distinct fingerprints, a fighter actually dies,
  and the first and last committed states differ. A frozen fold cannot pass this quietly.
- a **positive control** ships in the same file: it re-points one view at a second fold (the store's
  presentation `recompute`) and asserts the comparator goes red.
- demonstrated red, not merely claimed — re-pointing the `simulator` leg at that second fold:

```
(fail) four-view class gate — one recorded fight, one fold (#1336)
       > simulator publishes the byte-identical canonical sequence solo does
 4 pass, 1 fail
```

restored to green immediately after.

Coverage now ladders: `viewer_fingerprint_parity.test.js` holds the **core** viewer-free (recorded coop
capsule, three viewers); this holds the **store + projections** view-free (recorded production trace, four
compositions); the depcruise `fight-state-ingress-single-home` rule holds the **import graph**.

---

## 6 · Filed, not fixed (outside this lane's fence)

1. **`fight-sfx.js`'s module handler is dead code.** `packages/frontend/src/game/core/modules/fight-sfx.js:84`
   subscribes `packet/fightCastResult`; that event has **no emitter anywhere in the repo** — the beat pipeline
   replaced it (`voxel_fight_adapter.js:1092 drain_wave` → `bind_render_turn` → `play_cast_inner`). So the
   local player's death sting and the player caster whoosh never fire, while the mob layer voices normally
   through the adapter. The module's `play_hurt_sfx` export is live and used by the adapter — only `observe()`
   is dead. A second home for "when does a cast sound play", one half of which is a corpse. Deleting it is
   correct but silently retires an intended feature: an owner call, not a worker's.
2. **Two parity-image implementations.** `fingerprint.js` (viewer-free, chain turn ordinal + statuses) and
   `legacy_hash.js` (`canonical_state` / `state_hash`, re-exported from `inputs.js:621`) both hash "the fight's
   canonical state". The legacy pair is load-bearing across ~10 test files as the store-equality oracle, so
   collapsing it is a real refactor with its own review surface — not a rider on a parity lane.
3. **Glyph expiry rides a viewer-local clock.** `fold.js:189` decrements `turns_remaining` on the local
   `my_turn_no` rising edge because the client has no chain glyph read. Only the caster holds `my_glyphs`, so
   no two views disagree about a rendered zone today — but the lifetime is derived from a per-viewer counter
   rather than the canonical turn ordinal, which is the shape of a future divergence.
4. **Pre-existing flake in `packages/sim`.** `test/oracle/reduce_properties.test.js` — "law 6 … generation and
   folding are both pure functions of the seed" times out at 5000 ms under full-suite load (green in
   isolation, 6.5 s; failure count varies 1–2 between runs). `packages/sim` has no dependency on
   `packages/fight` and this lane touches no sim source, so it is untouched by this work — but it is a red
   line in the suite and wants a timeout raise or a split.
