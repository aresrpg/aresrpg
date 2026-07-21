// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import * as project from './project.js'
import { create_fight_store, presented_state } from './store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const START = 105
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
      cell: START,
      stats: { agility: 0 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 315, ap: 4, mp: 3, level: 1, stats: { agility: 0 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}
const vanish = [
  { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: START, damaging: false },
  { kind: 'Granted', target_is_mob: false, target_idx: 0, point_kind: 1, granted: 1 },
]

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const predict = (store, intent_id, now) =>
  store.getState().input({ type: 'predicted', intent_id, actions: vanish, basis_version: 6 }, now)

describe('silent grant claims rebase when an earlier prediction disappears', () => {
  test('the second Vanish contributes only its own +1 when the first Vanish fumbles', () => {
    const store = boot()
    predict(store, 'vanish:a', 2_000)
    predict(store, 'vanish:b', 2_010)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(5)

    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: {
          events: [
            {
              type: '0xpkg::fight_events::CriticalFailure',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 },
            },
            {
              type: '0xpkg::fight_events::Cast',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
            },
            {
              type: '0xpkg::fight_events::Cast',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
            },
          ],
        },
      },
      2_100
    )

    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
    expect(project.board_view(store.getState()).escrow[0].committed).toMatchObject({
      mp: 4,
      claimed_mp: 1,
      pending_mp: 0,
    })
  })

  test('the remaining Vanish rebases to +1 after targeted rollback of its predecessor', () => {
    const store = boot()
    predict(store, 'vanish:a', 2_000)
    predict(store, 'vanish:b', 2_010)

    store.getState().input({ type: 'rollback', intent_id: 'vanish:a' }, 2_100)

    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
    expect(project.board_view(store.getState()).escrow[0].committed.pending_mp).toBe(1)
  })
})
