// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST — THE DEAD-GENERATION ROLLBACK. Two turn submits can be in flight at once: the commit edge fires,
// its receipt lands and opens the NEXT turn, and only THEN does the first flight report its failure. Both
// flights fed the SAME unguarded door, so the LOSER's feedback clobbered the WINNER's state — an unstamped
// `rollback` wipes every optimistic entry (including the live turn's, which that tx never touched), and an
// unstamped busy release unlatches a claim it does not own. The fix is a generation stamp, not a lock: every
// async result carries the submit epoch it was BORN under, and the reducer refuses one from a dead generation.
import { describe, expect, mock, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { turn_submit_epoch } from '../src/turn_commit.js'
import { subscribe_commit_due } from '../src/txs.js'

/** drain the submit promise chain (submit → then/catch → finally) so the edge's feedback has landed */
const settle = async () => {
  for (let round = 0; round < 8; round += 1) await Promise.resolve()
}

const FIGHT = 'fight-a6'
const CHAR = 'hero-a6'
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
  mobs: [{ hp: 20, max_hp: 20, cell: 120 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms: 100_000,
  turn_entropy: 100_000,
  turn_ordinal: 1,
  last_action_ms: 1_000,
}

/** The store on MY turn with one action drafted — the state a deadline auto-commit fires against. */
const armed_turn = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
  store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } })
  return store
}

const predicted_entries = (store) => Object.values(store.getState().entries).filter((e) => e.source === 'intent')

describe('A6 — a submit result from a dead generation is refused at the reducer door', () => {
  test('a stale flight rollback cannot wipe the live turn it never submitted', async () => {
    const store = armed_turn()
    /** the first flight never settles on its own — the test decides WHEN it reports, out of order */
    let report_first = () => {}
    const submit = mock(() => new Promise((resolve) => (report_first = resolve)))
    const stop = subscribe_commit_due(store, { submit })

    store.getState().input({ type: 'tick' }, 99_000)
    expect(submit, 'the deadline edge fires the drafted commit').toHaveBeenCalledTimes(1)
    const dead_epoch = store.getState().commit_attempt_epoch
    expect(dead_epoch, 'the submit claims a generation before going in flight').toBeTruthy()

    // The WINNER lands: an authoritative receipt folds and advances the submit generation.
    store.getState().input({ type: 'receipt', receipt: { events: [] }, version: 6, fight_id: FIGHT }, 99_100)
    // The run store mirrors its own flight ending (dungeon_run_store's busy mirror carries no epoch).
    store.getState().input({ type: 'busy', value: false }, 99_100)
    expect(turn_submit_epoch(store.getState()), 'the live generation is not the dead one').not.toBe(dead_epoch)

    // The player drafts and paints on the LIVE turn — state the stale flight has no claim over.
    store
      .getState()
      .input(
        {
          type: 'intent',
          intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 8 },
          version: 6,
          event_idx: 0,
        },
        99_200
      )
    expect(predicted_entries(store), 'the live turn is painted').toHaveLength(1)

    // ONLY NOW does the dead flight report its failure — the loser's rollback walks the same door.
    report_first(false)
    await settle()

    expect(predicted_entries(store), "a dead generation's rollback never touches the live turn").toHaveLength(1)
    stop()
  })

  test('a stale flight release cannot unlatch the live submit claim', async () => {
    const store = armed_turn()
    let report_first = () => {}
    const submit = mock(() => new Promise((resolve) => (report_first = resolve)))
    const stop = subscribe_commit_due(store, { submit })

    store.getState().input({ type: 'tick' }, 99_000)
    const dead_epoch = store.getState().commit_attempt_epoch

    // A NEWER attempt claims the door and is itself in flight — busy is ITS latch, not the dead flight's.
    const live_epoch = `${dead_epoch}-next`
    store.getState().input({ type: 'busy', value: true, attempt_epoch: live_epoch }, 99_200)

    report_first(true)
    await settle()

    expect(store.getState().busy, "a dead generation never releases the live attempt's latch").toBe(true)
    expect(store.getState().commit_attempt_epoch, 'the live claim survives the stale settle').toBe(live_epoch)
    stop()
  })
})
