// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Owner ruling 2026-07-21 (verbatim): "my turn should be instantly committed by the app if I kill the mob (AFTER
// ALL VFX SEQUENCE AND DEATH ANIMATION DONE)" + "fight still not ending after I kill the last mob". The killing
// blow that leaves zero living enemies AUTO-FIRES the turn commit once its death beat has DRAINED — no manual END
// TURN. This is NOT an optimistic victory (the commit's receipt still drives `decided_winner` exactly as today —
// no-false-victory intact); it is an auto-COMMIT that reads the LOCAL fold so MY predicted kill counts, where the
// prior rule ("prediction stays manual, only the receipt auto-commits") did not. Locks: fires exactly ONCE, only
// on lethal, only after the drain; an executed-failed commit is never auto-retried (the reducer's epoch/latch).

import { describe, expect, test, mock } from 'bun:test'

import * as project from '../src/project.js'
import { create_fight_store, PLAYER_TURN_FLOOR_MS } from '../src/store.js'
import { executed_turn_failure, turn_commit_key } from '../src/turn_commit.js'
import { subscribe_commit_due } from '../src/txs.js'
import { local_intent_beats, synthetic_cast_events } from '../src/present.js'
import { encode } from '../src/los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const T0 = 10_000 // the snapshot moment == my playable turn opening (turn_started_at)
const PAST_FLOORS = T0 + 6_000 // > turn_started + PLAYER_TURN_FLOOR_MS (3s) and > last_action(0) + MIN_ACTION_MS (5s)
const MOB_CELL = encode(6, 4)

const mob = (over = {}) => ({ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1, ...over })
const fight_object = (mobs) => ({
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
      cell: encode(2, 2),
    },
  ],
  mobs,
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 100_000,
  last_action_ms: 0,
})

const boot = (mobs = [mob()]) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(mobs), version: 5 }, T0)
  return store
}

// Draft a killing cast on mob `idx`: a STAGED action + the optimistic Hit that predicts it dead, carrying a death
// beat (a local wave) — exactly the shape the board produces when the player drops a lethal spell.
const stage_kill = (store, idx = 0) => {
  store.getState().input({ type: 'stage', intent: { kind: 1, target: MOB_CELL } })
  const beats = local_intent_beats(
    synthetic_cast_events({
      fight_id: FIGHT,
      caster_idx: 0,
      target_cell: MOB_CELL,
      victims: [{ is_mob: true, idx, amount: 30, remaining_hp: 0 }],
    }),
    {
      fight_id: FIGHT,
      resolve_fighter_id: ({ is_mob, idx: i, character }) =>
        character != null ? String(character) : is_mob ? `mob-${Number(i)}` : CHAR,
      resolve_cast: () => ({ spell_id: 'ember_strike' }),
    }
  )
  store.getState().input({ type: 'intent', intent: { kind: 'cast', target_cell: MOB_CELL, damaging: true }, beats })
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: idx, remaining_hp: 0 } })
}

const drain = (store, now = PAST_FLOORS) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}

describe('lethal auto-commit (owner ruling) — fires once, only lethal, only after the drain', () => {
  test('the killing blow auto-commits ONCE its death beat has DRAINED — never mid-animation', () => {
    const store = boot()
    stage_kill(store)

    // past both floors, but the death beat is still presenting → the app must NOT commit mid-animation
    store.getState().input({ type: 'tick' }, PAST_FLOORS)
    expect(project.commit_due(store.getState()), 'no auto-commit while the death beat is still presenting').toBe(false)

    drain(store) // the vfx sequence + death animation finish presenting
    store.getState().input({ type: 'tick' }, PAST_FLOORS)
    expect(project.commit_due(store.getState()), 'the lethal blow auto-commits once its beat has drained').toBe(true)
  })

  test('before the player-turn floor, a drained lethal prediction still holds (floor unchanged)', () => {
    const store = boot()
    stage_kill(store)
    drain(store, T0 + 1_000)
    store.getState().input({ type: 'tick' }, T0 + PLAYER_TURN_FLOOR_MS - 1)
    expect(project.commit_due(store.getState()), 'the min-turn floor still gates the auto-commit').toBe(false)
  })

  test('ONLY lethal — one mob still alive keeps END TURN manual', () => {
    const store = boot([mob({ cell: MOB_CELL }), mob({ cell: encode(8, 8) })])
    stage_kill(store, 0) // kill mob-0 only; mob-1 lives
    drain(store)
    store.getState().input({ type: 'tick' }, PAST_FLOORS)
    expect(project.commit_due(store.getState()), 'a surviving enemy means no auto-commit').toBe(false)
  })

  test('fires EXACTLY once and never re-fires an executed-failed commit', async () => {
    const store = boot()
    stage_kill(store)
    drain(store)
    const pending = Promise.reject(new Error('executed failure with digest'))
    const submit = mock(() => pending)
    const stop = subscribe_commit_due(store, { submit })

    store.getState().input({ type: 'tick' }, PAST_FLOORS)
    expect(store.getState().busy, 'the edge claims busy before the auto-commit can yield').toBe(true)
    expect(submit, 'the lethal auto-commit fires the submit once').toHaveBeenCalledTimes(1)

    await pending.catch(() => {})
    await Promise.resolve()
    // the executed failure latches; more lethal-due ticks must NEVER re-burn gas
    const key = turn_commit_key({ fight_id: FIGHT, entity_id: CHAR, deadline_ms: 100_000 })
    store.getState().input({ type: 'busy', value: false, latch: executed_turn_failure(key, 'digest-burned-once') })
    for (let i = 0; i < 6; i += 1) store.getState().input({ type: 'tick' }, PAST_FLOORS + i)
    expect(submit, 'an executed-failed lethal commit is never auto-retried').toHaveBeenCalledTimes(1)
    stop()
  })
})
