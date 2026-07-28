# Trap lifecycle mechanism — #1493

## Search boundary

The mandatory first pass searched `packages/sim/src/**/*.{js,jsx}`,
`packages/fight/src/**/*.{js,jsx}`, and `packages/frontend/src/**/*.{js,jsx}` with
case-insensitive `trap`, assignment/mutation forms (`traps:`, `my_traps:`,
`place_traps`, `drop_traps`, `gone`, `cell_entries.push/pop`, and
`pending_trap_cells`), and both static and dynamic import expressions. Positive
controls were the static imports at `packages/sim/src/reduce.js:32`,
`packages/fight/src/fold.js:23`, and
`packages/frontend/src/world-shell/dungeon_fight_sync.js:12`; the same
`.js`/`.jsx` include set found no dynamic trap import. These globs also found
the `.jsx` trap-placement positive control at
`packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx:580`.

## Every trap-state writer / clearer

### Simulation

- `packages/sim/src/reduce.js:897` — `create_fight_state` initializes the
  authoritative sim `traps` array.
- `packages/sim/src/fight_traps.js:43-48` — `place_trap` appends exactly one
  trap row with a monotonic id.
- `packages/sim/src/fight_traps.js:303-346` — `check_traps` finds the first
  covering trap and removes exactly that index before resolving its payload.
- `packages/sim/src/reduce.js:445-489` — `walk_path` calls `check_traps` once
  per entered cell and appends one `fight_trap_triggered` event for every
  successful trigger; the reducer emits individual events in path order, not
  one batch-consumption event.
- `packages/sim/src/effect_board.js:42` — the deterministic Move-twin board
  primitive initializes `cell_entries`.
- `packages/sim/src/effect_board.js:64-82` — the Move-twin `place_trap`
  mutates `cell_entries` by appending one trap row.
- `packages/sim/src/effect_board.js:161-172` — the Move-twin `on_enter`
  `swap_remove`s only the first covering trap.
- `packages/sim/src/effect_board.js:213-227` — end-turn duration maintenance
  rebuilds `cell_entries` but explicitly retains every trap; only glyphs
  expire.

### Fight fold / projection

- `packages/fight/src/store_state.js:66` — fight initialization is the
  legitimate whole-domain clear of the local `my_traps` prediction ledger.
- `packages/fight/src/store_prediction.js:248-285` — a predicted trap cast
  appends one local trap record (including its footprint, payload, anchor, and
  placement order).
- `packages/fight/src/trap_ledger.js:91-114` — `fold_trap_ledger` is the sole
  canonical consumption (`gone`) writer: it folds ordered authoritative
  entered cells over the evolving rows, marks only the first live covering row
  per entry, and records `version:event:step` identity.
- `packages/fight/src/trap_ledger.js:122-139` and
  `packages/fight/src/store.js:227-241` — `present_trap` advances only the
  overlay cursor for one already-canonical trigger, selected by anchor; it
  cannot write `gone`.
- `packages/fight/src/store.js:372-389` — a whole-turn `presented` ack applies
  the same trigger ids as an idempotent headless/watchdog presentation fallback;
  it processes only actual `trap_trigger` beats and cannot affect an untriggered
  row.
- `packages/fight/src/store.js:244-260` — `drop_traps` filters optimistic trap
  records for failed/dropped casts (with an applied-version guard intended to
  preserve committed rows).
- `packages/fight/src/project_views.js:364-365` — the projection is read-only:
  the sim door takes canonical non-`gone` rows, while `trap_prims` retains a
  consumed row only until its fold-derived trigger is presented.
- `packages/fight/src/fight_render_events.js:128-192,438-505` — the
  presentation producer is read-only: it walks concrete trap rows in path order
  and emits one `trap_trigger` beat carrying that row's anchor for each match.
- `packages/fight/src/trap_ledger.js:20-34` — `read_fight_traps` is a
  read-only decoder of authoritative `Fight.fx.cell_entries`; it does not
  mutate lifecycle state.
- `packages/fight/src/predict_cast.js:382-435` — `state_from_view` creates
  ephemeral sim trap rows from the projection for deterministic cast
  prediction; the returned temporary sim state is not a persistent fight
  writer.

### Frontend

- `packages/frontend/src/world-shell/dungeon_fight_sync.js:45-62` — a chain
  object read decodes authoritative `Fight.fx` trap rows and writes that
  snapshot projection fact through the fight store's `ctx.chain_traps` input.
- `packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx:580` — a
  click-time trap placement writes through the fight reducer's `place_traps`
  field; the component owns no trap collection.
- `packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx:675-676`,
  `:729`, `:833-856` — flush validation classifies placed/dropped trap casts
  and sends only failed or rejected drafts through the fight reducer's
  `drop_traps` rollback door.
- `packages/frontend/src/world-shell/voxel_fight_adapter.js:1029-1042` — an
  authoritative `trap_trigger` beat sends its anchor and stable id through the
  fight reducer's presentation input; it owns no trap list and cannot consume
  canonical state.
- `packages/frontend/src/world-shell/voxel_fight_adapter.js:1686-1689` — the
  board overlay is read-only: it paints `engine_view.trap_prims`; it owns no
  trap list.
- `packages/frontend/src/game/dev/dev_bot_seam.js:300-330` and
  `packages/frontend/src/game/dev/dev_synth_fight.js:270-278` — dev-only
  harnesses can feed `place_traps` through the same fight-store prediction
  door; neither has a separate clearer.

### Writers deleted by this fix

- `origin/edge:packages/fight/src/trap_ledger.js:126-150` — the final-position
  `occupied_anchor` clearer was deleted; the surviving canonical fold now
  reduces ordered entries over evolving rows instead of independently mapping
  the whole path across every trap.
- `origin/edge:packages/fight/src/project_views.js:367-380` — the old
  projection suppressed a trap from presented/optimistic fighter occupancy
  without a trigger event.
- `origin/edge:packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx:153,991-1000,1065-1083`
  — `pending_trap_cells` plus its turn-boundary `drop_traps` dispatch was a
  parallel component-local lifecycle writer.

## Symptom mechanisms

1. **First trigger made all traps vanish:** the former `fold_trap_ledger`
   evaluated each trap independently against the whole reconstructed path, so
   one receipt marked every crossed row `gone`; the old overlay immediately
   filtered all `gone` rows when the first paced trigger reconciled, instead of
   retaining later rows until their own ordered trigger beats.
2. **End-turn pre-cleared an untriggered trap:** the deleted
   presented-fighter occupancy suppression and `pending_trap_cells`
   turn-boundary rollback treated projected/upcoming position or turn
   advancement as consumption without an authoritative trigger event.
