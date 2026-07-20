// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ACK-WINDOW MOB ROLLBACK (BOOT23 headed-run regression: "there is still the rollback
// of mobs movements" — the rig walks to its target, snaps back to its pre-turn cell, then re-corrects).
//
// MECHANISM (adjudicated from the BOOT23 video + code): TWO MIRRORS OF ONE CORE, ONE ASYNC PUMP APART.
//   · use_dungeon.dungeon      — project.board_view, a SYNCHRONOUS zustand subscriber (dungeon_run_store.js
//                                `fight_store.subscribe(...)` tail) — fresh the instant any core input folds.
//   · context.get_state().fight — project.engine_view, recomputed on every core change by game/core/modules/
//                                fight.js BUT delivered via context.dispatch → game.js's PassThrough actions
//                                pump → folded ≥1 async cycle LATER (fight.js's own comment: "get_state()
//                                lags one async dispatch cycle behind").
// drain_wave's turn-settle `.finally` releases the replay_owned claim and THEN acks 'presented' — the design
// wants the ack-triggered reconcile to snap the rig true. But that reconcile read the CONTEXT mirror, which
// still held the projection computed BEFORE the ack (the mob masked at its pre-turn cell). With the claim just
// released and placed_cell freshly stamped at the move's real destination, entity_fold_action saw
// placed(NEW) ≠ fighter.cell(OLD) with no beat owning the id and fired its position safety net: a smooth WALK
// back to the masked pre-turn cell. The next pump's projection then walked it forward again — the rollback.
//
// THE CONTRACT (the fix): the adapter's fight authority (board_fight_authority) derives from the CORE at read
// time — the same synchronous lane the dungeon mirror rides — so the ack-window reconcile always sees the
// revealed cell and the fold verdict for the just-presented mob is a benign same-cell upsert, never a walk.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight'
import { engine_view } from '@aresrpg/fight'

import { board_fight_authority, entity_fold_action } from './voxel_fight_folds.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const OLD_CELL = 105 // the mob's pre-turn cell (encoded, grid_width 20) → { x: 5, y: 5 }
const NEW_CELL = 107 // its receipt MobMoved destination → { x: 7, y: 5 }
const OLD_XY = { x: 5, y: 5 }
const NEW_XY = { x: 7, y: 5 }

const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})

/** A decoded-Fight-shaped object the snapshot door adopts (mirrors presented_mask.test.js's harness). */
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: OLD_CELL, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

/** My committed end-turn resolving the mob's whole turn in ONE receipt (the SIMDRIVE single-PTB fold). */
const CASCADE = [
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
  event('MobMoved', { idx: 0, to_cell: NEW_CELL }),
  event('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 100 }),
  event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 7, remaining_hp: 43 }),
  event('TurnEnded', { is_mob: true, idx: 0 }),
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
]

/** Drive the real core through adopt → receipt → (optionally) the mob turn's ack; returns the store. */
const drive_to_ack = ({ ack }) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, 2_000)
  const mob_turn = store.getState().wave.find((turn) => turn.source_id === 'mob-0')
  expect(mob_turn, 'the receipt must pace a non-local mob turn').toBeTruthy()
  if (ack) store.getState().input({ type: 'presented', seq: mob_turn.seq }, 3_000)
  return store
}

/** The adapter's per-id state at the exact `.finally` instant: claim released, ack folded, rig at the move's
 *  destination (the arrival beat stamped placed_cell), the acked turn gone from the wave. */
const ACK_WINDOW_GUARDS = {
  has_entity: true,
  is_dying: false,
  walking: false,
  replay_owned: false,
  placed: NEW_XY,
  queued: false,
}

describe('ack-window mob position authority (the BOOT23 rollback)', () => {
  test('the two mirrors diverge for one pump: pre-ack projection masks, the core reveals at the ack', () => {
    const pre_ack = engine_view(drive_to_ack({ ack: false }).getState())
    expect(pre_ack.fighters.get('mob-0').cell, 'the wave mask must hold the mob at its pre-turn cell').toEqual(OLD_XY)
    const post_ack = engine_view(drive_to_ack({ ack: true }).getState())
    expect(post_ack.fighters.get('mob-0').cell, 'the ack must reveal the moved cell').toEqual(NEW_XY)
  })

  test('MECHANISM (the documented bug shape): folding the one-pump-stale mirror row walks the rig back', () => {
    // What context.get_state().fight held while the ack's reconcile ran: the projection computed BEFORE the
    // ack folded (the pump had not yet delivered the post-ack recompute). Feeding the fold that row with the
    // adapter's real ack-window guards reproduces the exact rollback verdict observed live.
    const stale_mirror = engine_view(drive_to_ack({ ack: false }).getState())
    const verdict = entity_fold_action(stale_mirror.fighters.get('mob-0'), ACK_WINDOW_GUARDS)
    expect(verdict).toEqual({ kind: 'walk', to: OLD_XY })
  })

  test('CONTRACT: the adapter authority at the ack window never rolls the just-presented mob back', () => {
    const store = drive_to_ack({ ack: false })
    store.getState().input({ type: 'presented', seq: store.getState().wave.find((t) => !t.is_local).seq }, 3_000)
    // the ack-triggered reconcile (drain_wave subscriber) reads the adapter's ONE authority:
    const fight = board_fight_authority({ core: store.getState(), roster: [] })
    const mob_row = fight.fighters.get('mob-0')
    expect(mob_row.cell, 'the authority must serve the revealed post-move cell at the ack window').toEqual(NEW_XY)
    const verdict = entity_fold_action(mob_row, ACK_WINDOW_GUARDS)
    expect(verdict, 'the just-presented mob must reconcile as a benign same-cell upsert, never a walk').toEqual({
      kind: 'upsert',
    })
  })

  test('CONTRACT: adapter click/hover/VFX/log reads cannot resolve a one-pump-old fighter from the context mirror', async () => {
    const store = drive_to_ack({ ack: false })
    const stale_mirror = engine_view(store.getState())
    const mob_turn = store.getState().wave.find((turn) => !turn.is_local)
    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 3_000)

    // The exact betrayal: a click/hover/VFX lookup against the frozen context mirror resolves OLD_CELL even
    // though the live core now projects NEW_CELL through the adapter's synchronous board authority.
    expect(stale_mirror.fighters.get('mob-0').cell).toEqual(OLD_XY)
    expect(board_fight_authority({ core: store.getState() }).fighters.get('mob-0').cell).toEqual(NEW_XY)

    // Wiring guard: every executable adapter read must enter through board_fight_authority. Catch direct access,
    // destructuring, and passing the stale getter into a combat-log helper that immediately reads `fight.fighters`.
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    const stale_read =
      /context\.get_state\(\)\.fight|\{\s*fight\s*\}\s*=\s*context\.get_state\(\)|emit_(?:cast_context|effect|death|trap)_line\(context\.get_state/
    const stale_read_lines = source.split('\n').flatMap((line, index) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && stale_read.test(line) ? [index + 1] : []
    })
    expect(stale_read_lines, 'adapter reads must never use the one-pump-stale context fight mirror').toEqual([])
  })

  test('CONTRACT: render-frame authority reads reuse one projection per immutable core version', async () => {
    // S2 MIRROR KILL (07-17): the version-keyed cache moved to its ONE app-wide home — fight/project.js's
    // WeakMap memo (roster now rides INSIDE the core state as ctx.roster, so one key covers both). The
    // adapter's authority read must BE that shared surface, never a second local cache.
    const adapter = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(adapter, 'the adapter authority read is the shared memoized core view').toContain(
      'const read_board_fight = fight_view'
    )
    const project_src = await Bun.file(new URL('../../../fight/src/project.js', import.meta.url)).text()
    expect(project_src, 'the one projection memo lives in @aresrpg/fight project.js').toContain(
      'const VIEWS = new WeakMap()'
    )
    expect(project_src).toContain('if (!VIEWS.has(s)) VIEWS.set(s, engine_view(s))')
  })
})
