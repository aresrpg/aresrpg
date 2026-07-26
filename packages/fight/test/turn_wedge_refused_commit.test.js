// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST #1045 — THE TURN MUST STAY ENDABLE. A commit the authority REFUSES (a pre-execution abort: zero gas,
// no digest, so no executed-failure latch) used to keep its submit epoch claimed forever: `commit_due` could never
// go true again for that turn, so the deadline auto-pass never fired and the turn never ended. This drives the REAL
// store + the REAL commit edge (txs.subscribe_commit_due) through the EXACT two inputs the production failure path
// dispatches — `rollback` (world-shell/dungeon_run_store.js `commit_turn` catch) then `clear_staged`
// (hud/world/DungeonBoard.jsx `flush_commit` tail) — and asserts the turn can still pass, exactly once, with the
// refused draft GONE (never a retry of the refused actions, never a loop).
import { describe, expect, mock, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { subscribe_commit_due } from '../src/txs.js'

/** drain the submit promise chain (submit → then/catch → finally) so the edge's feedback has landed */
const settle = async () => {
  for (let round = 0; round < 8; round += 1) await Promise.resolve()
}

const FIGHT = 'fight-1045'
const CHAR = 'hero-1045'
const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'yajin',
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
  mobs: [{ hp: 10, max_hp: 10, cell: 120 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms: 100_000,
  last_action_ms: 1_000,
}

/** The store with a live fight on MY turn, one refused cast staged (the #1045 second patient venom). */
const armed_turn = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
  store.getState().input({ type: 'stage', intent: { kind: 1, target: 120, spell_key: 'yajin_patient_venom' } })
  return store
}

describe('#1045 a refused commit leaves the turn endable', () => {
  test('the deadline auto-pass still fires once, with the refused draft discarded', async () => {
    const store = armed_turn()
    /** what the draft looked like at each submit — the recovery must ship a BARE PASS, never the refused cast */
    const drafts = []
    const submit = mock(async () => {
      drafts.push(store.getState().staged.length)
      await Promise.resolve()
      // The production refusal path, verbatim: the reverted turn's prediction is rolled back, then the flush
      // discards the drafted actions. No digest ⇒ no executed-failure latch ⇒ the burn law is never in play.
      store.getState().input({ type: 'rollback' })
      store.getState().input({ type: 'clear_staged' })
      return false
    })
    const stop = subscribe_commit_due(store, { submit })

    store.getState().input({ type: 'tick' }, 99_000)
    expect(submit, 'the deadline edge fires the drafted commit once').toHaveBeenCalledTimes(1)
    await settle()
    expect(store.getState().busy, 'a refused commit releases busy').toBe(false)
    expect(store.getState().staged, 'the refused draft is discarded').toEqual([])

    // THE WEDGE: without a receipt the turn is still MINE and still past its deadline — the bare pass that ends
    // it must still be able to fire.
    for (let tick = 0; tick < 8; tick += 1) store.getState().input({ type: 'tick' }, 99_100 + tick)
    expect(submit, 'the turn stays endable — the auto-pass fires again after the refusal').toHaveBeenCalledTimes(2)
    expect(drafts, 'the recovery ships a BARE PASS: the refused actions are never resubmitted').toEqual([1, 0])

    // NEVER A LOOP: the bare pass failing too keeps the claim — one recovery per turn, not a retry engine.
    await settle()
    for (let tick = 0; tick < 8; tick += 1) store.getState().input({ type: 'tick' }, 99_300 + tick)
    expect(submit, 'a failing bare pass never re-enters — exactly one recovery per turn').toHaveBeenCalledTimes(2)
    stop()
  })
})
