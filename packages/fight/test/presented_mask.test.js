// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { presented_state, create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const PRE_MOB_CELL = 105
const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})
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
  mobs: [
    { template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 },
    { template: '0xabc', hp: 30, max_hp: 30, cell: PRE_MOB_CELL, ap: 4, mp: 3, level: 1 },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}
const CASCADE = [
  event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
  event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 10, remaining_hp: 20 }),
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: true, idx: 1, deadline_ms: 0 }),
  event('MobMoved', { idx: 1, to_cell: 107 }),
  event('Cast', { caster_is_mob: true, caster_idx: 1, target_cell: 100 }),
  event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 7, remaining_hp: 43 }),
  event('TurnEnded', { is_mob: true, idx: 1 }),
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
]

describe('presented state wave mask', () => {
  test('my committed segment is immediate and the mob segment reveals only after its ack', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, 2_000)

    const raw = store.getState()
    const before = presented_state(raw)
    expect(before.fighters.m0?.hp ?? raw.view.mobs[0].hp).toBe(20)
    expect(before.fighters.m1?.cell).toBe(PRE_MOB_CELL)
    expect(before.fighters.p0?.hp).toBe(50)
    expect(before.winner).toBe(store.getState().winner)

    const mob_turn = store.getState().wave.find((turn) => turn.source_id === 'mob-1')
    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 3_000)
    const after = presented_state(store.getState())
    expect(after.fighters.m1.cell).toBe(107)
    expect(after.fighters.p0.hp).toBe(43)
  })
})
