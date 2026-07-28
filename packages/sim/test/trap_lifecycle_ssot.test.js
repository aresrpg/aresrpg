// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { check_traps } from '../src/fight_traps.js'
import { create_fight_state, reduce } from '../src/reduce.js'

const cell = x => ({ x, y: 1 })

const entity = (id, at, is_player) => ({
  id,
  name: id,
  cell: at,
  health: 100,
  health_max: 100,
  ap: 6,
  ap_max: 6,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'trap-ssot',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const arena = {
  width: 7,
  height: 3,
  radius: 0,
  center: { x: 3, y: 1 },
  cells: new Uint8Array(21),
  spawns_a: [],
  spawns_b: [],
}

const trap_state = () => {
  const state = create_fight_state({
    fight_id: 'trap-ssot',
    arena_seed: 1493,
    arena_radius: 0,
    arena,
    team0: [entity('player', cell(6), true)],
    team1: [entity('mob', cell(1), false)],
  })
  return {
    ...state,
    started: true,
    turn_order: ['mob'],
    traps: [
      {
        id: 1,
        source_id: 'player',
        anchor: cell(2),
        cells: [cell(2)],
        payload: [],
      },
      {
        id: 2,
        source_id: 'player',
        anchor: cell(4),
        cells: [cell(2), cell(4)],
        payload: [],
      },
    ],
  }
}

describe('#1493 trap lifecycle is one trigger per ordered entry', () => {
  test('trap A is consumed at step k while overlapping trap B stays armed until step k+n', () => {
    const first = check_traps(trap_state(), cell(2), 'mob')
    expect(first.triggered).toBe(true)
    expect(first.state.traps.map(trap => trap.id)).toEqual([2])

    const second = check_traps(first.state, cell(4), 'mob')
    expect(second.triggered).toBe(true)
    expect(second.state.traps).toEqual([])
  })

  test('one move emits one trigger event per trap in walk order', () => {
    const moved = reduce(
      trap_state(),
      { type: 'move', entity_id: 'mob', path: [cell(5)] },
      { arena, spell_templates: new Map() },
    )
    const triggers = moved.events.filter(
      event => event.type === 'fight_trap_triggered',
    )

    expect(triggers.map(event => event.cell)).toEqual([cell(2), cell(4)])
    expect(moved.state.traps).toEqual([])
  })

  test('end turn does not consume an un-walked trap', () => {
    const ended = reduce(
      trap_state(),
      { type: 'end_turn', entity_id: 'mob' },
      { arena, spell_templates: new Map() },
    )

    expect(ended.state.traps.map(trap => trap.id)).toEqual([1, 2])
    expect(
      ended.events.some(event => event.type === 'fight_trap_triggered'),
    ).toBe(false)
  })
})
