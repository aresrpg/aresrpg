// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1232 — prediction's own occupancy map repeated the last-write-wins collapse #1214 killed on the board.
// A corpse keeps its on-chain cell but never body-blocks, so a live fighter may legally share it. Both index
// builders (the board's and prediction's) must resolve the SAME occupant `find_living_mob_at` / `find_entity_at`
// do: a living occupant claims its cell once and is never displaced by a later corpse write.
import { describe, expect, test } from 'bun:test'

import { occupancy_of } from '../src/occupancy.js'
import { evolve_flush_casts } from '../src/predict_cast.js'
import { single_effect_spell } from '../../sim/test/spell_effect_conformance_matrix.js'
import * as SE from '../../sim/src/spell_effect.js'

const W = 20
const enc = (x, y) => y * W + x
const dec = (c) => ({ x: c % W, y: Math.floor(c / W) })

describe('occupancy_of — the ONE living-wins index (#1214/#1232, the #1070 class)', () => {
  test('a corpse never displaces the living occupant already claimed, whatever the write order', () => {
    const live = { cell: 7, kind: 'mob', idx: 0, alive: true }
    const corpse = { cell: 7, kind: 'mob', idx: 1, alive: false }
    expect(occupancy_of([live, corpse]).get(7)).toEqual({ kind: 'mob', idx: 0, alive: true })
    expect(occupancy_of([corpse, live]).get(7)).toEqual({ kind: 'mob', idx: 0, alive: true })
  })

  test('a corpse still claims a cell no living occupant holds', () => {
    expect(occupancy_of([{ cell: 7, kind: 'player', idx: 0, alive: false }]).get(7)).toEqual({
      kind: 'player',
      idx: 0,
      alive: false,
    })
  })

  test('a cell-less occupant is not an entry', () => {
    expect(occupancy_of([{ cell: null, kind: 'mob', idx: 0, alive: true }]).size).toBe(0)
  })
})

describe('#1232 — evolve_flush_casts snapshots resolve the LIVING occupant of a stacked cell', () => {
  const dmg_spell = single_effect_spell(
    'dmg',
    { kind: SE.K_DAMAGE, value: 10, element: 2, target_filter: SE.TF_NOT_TEAM },
    3,
    false
  )
  const STACK = enc(7, 5)
  // The #1214 stack: a live mob standing on its own kill's corpse, the DEAD row ordered last (higher index).
  const fighter = (id, cell, team, health) => [
    id,
    {
      id,
      cell: dec(cell),
      team,
      health,
      health_max: 200,
      ap: 99,
      ap_max: 99,
      mp: 20,
      mp_max: 20,
      is_player: team === 0,
    },
  ]
  const view = () => ({
    fight_id: '0xstack',
    arena: { width: W, height: 19, cells: new Uint8Array(W * 19) },
    fighters: new Map([
      fighter('p0', enc(5, 5), 0, 120),
      fighter('mob-0', STACK, 1, 200),
      fighter('mob-1', STACK, 1, 0),
    ]),
    turn_order: ['p0', 'mob-0'],
    turn_number: 1,
  })
  const committed = {
    fighters: {
      p0: { cell: enc(5, 5), hp: 120, alive: true },
      m0: { cell: STACK, hp: 200, alive: true },
      m1: { cell: STACK, hp: 0, alive: false },
    },
  }

  test('RED-FIRST: the pre-fire snapshot names the live mob, not the later-indexed corpse sharing its cell', () => {
    const evolved = evolve_flush_casts({
      view: view(),
      committed,
      caster_id: 'p0',
      actions: [{ kind: 1, spell: dmg_spell, target: STACK }],
    })

    expect(evolved).toHaveLength(1)
    expect(evolved[0].occupied.get(STACK)).toEqual({ kind: 'mob', idx: 0, alive: true })
  })
})
