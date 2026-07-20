// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'

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

describe('receipt wave resolvers', () => {
  test('mob beats carry real ids, the presentation spell, and the pre-receipt path', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, 2_000)
    const { beats } = store.getState().wave.find((turn) => turn.source_id === 'mob-1')
    const cast = beats.find((beat) => beat.kind === 'cast')
    const move = beats.find((beat) => beat.kind === 'move')
    const damage = beats.find((beat) => beat.kind === 'damage')
    const from = { x: PRE_MOB_CELL % 20, y: Math.floor(PRE_MOB_CELL / 20) }
    const to = { x: 107 % 20, y: Math.floor(107 / 20) }
    const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)

    expect(cast.payload.entity_id).toBe('mob-1')
    expect(cast.payload.spell_id).toBe('mob_attack_dungeon')
    expect(move.payload.path).toHaveLength(distance)
    expect(damage.payload.target_id).toBe(CHAR)
  })

  test('a confirmed overkill damage beat clamps to the victim HP-before', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({
      type: 'snapshot',
      fight: {
        ...FIGHT_OBJECT,
        participants: [{ ...FIGHT_OBJECT.participants[0], hp: 1, max_hp: 50 }],
      },
      version: 5,
    })
    store.getState().input({
      type: 'receipt',
      receipt: {
        events: [
          event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
          event('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 100 }),
          event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 4, remaining_hp: 0 }),
          event('TurnEnded', { is_mob: true, idx: 0 }),
        ],
      },
      version: 6,
    })

    const damage = store
      .getState()
      .wave.find((turn) => turn.source_id === 'mob-0')
      ?.beats.find((beat) => beat.kind === 'damage')
    expect(damage?.payload).toMatchObject({ target_id: CHAR, damage: 1, new_health: 0, killed: true })
  })
})
