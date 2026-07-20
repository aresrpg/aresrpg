// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST money-critical regression: commit_due is level-triggered by the reducer clock, but transaction submit
// is an EDGE. A slow or failed submit must be claimed once for the playable turn before async work starts; repeated
// due ticks (including a busy clear after an executed failure) must never invoke submit again and re-burn gas.
import { describe, expect, mock, test } from 'bun:test'

import { executed_turn_failure, turn_commit_key } from './turn_commit.js'
import { create_fight_store } from './store.js'
import { subscribe_commit_due } from './txs.js'

const FIGHT = 'fight-1'
const CHAR = 'hero-1'
const fight_object = {
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
  mobs: [{ hp: 10, max_hp: 10, cell: 120 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms: 100_000,
  last_action_ms: 1_000,
}
const turn_started = (is_mob, deadline_ms) => ({
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob, idx: 0, deadline_ms },
})

describe('commit_due transaction edge', () => {
  test('slow failing submit stays single-flight across due ticks', async () => {
    let reject_submit
    const pending = new Promise((_, reject) => {
      reject_submit = reject
    })
    const submit = mock(() => pending)
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
    store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } })
    const stop = subscribe_commit_due(store, { submit })

    store.getState().input({ type: 'tick' }, 99_000)
    expect(store.getState().busy, 'the edge claims busy synchronously before the submit can yield').toBe(true)
    for (let tick = 0; tick < 8; tick += 1) store.getState().input({ type: 'tick' }, 99_000 + tick)
    expect(submit, 'a slow submit is invoked once across every due tick').toHaveBeenCalledTimes(1)

    reject_submit(new Error('executed failure with digest'))
    await pending.catch(() => {})
    await Promise.resolve()
    expect(store.getState().busy, 'the rejected edge releases busy without re-arming its epoch').toBe(false)
    for (let tick = 0; tick < 8; tick += 1) store.getState().input({ type: 'tick' }, 99_100 + tick)
    expect(submit, 'a rejected submit without receipt still cannot re-enter').toHaveBeenCalledTimes(1)
    stop()
    const restarted = subscribe_commit_due(store, { submit })
    for (let tick = 0; tick < 8; tick += 1) store.getState().input({ type: 'tick' }, 99_150 + tick)
    expect(submit, 'the reducer-owned claim survives an edge subscription remount').toHaveBeenCalledTimes(1)

    const key = turn_commit_key({ fight_id: FIGHT, entity_id: CHAR, deadline_ms: 100_000 })
    store.getState().input({ type: 'busy', value: false, latch: executed_turn_failure(key, 'digest-burned-once') })
    for (let tick = 0; tick < 8; tick += 1) store.getState().input({ type: 'tick' }, 99_200 + tick)
    expect(submit, 'failure cannot re-arm the same playable-turn submit').toHaveBeenCalledTimes(1)

    store
      .getState()
      .input({ type: 'receipt', receipt: { events: [turn_started(false, 200_000)] }, version: 6 }, 120_000)
    store.getState().input({ type: 'tick' }, 199_000)
    expect(submit, 'receipt feedback re-arms a same-player turn exactly once').toHaveBeenCalledTimes(2)
    restarted()
  })
})
