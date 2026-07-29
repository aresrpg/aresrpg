// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1497/#1608 — a world claim has already composed and rendered this entity-keyed roster. The fight init input
// must preserve it through snapshot adoption instead of resolving by the shared template or a shifting ordinal.

import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xfight'
const PRIMARY = '0xchicklet'
const SECONDARY = '0xdraugr'
const MOB_0 = 'mob-0'
const MOB_1 = 'mob-1'

const fight_object = (status = 1) => ({
  id: FIGHT,
  status,
  width: 20,
  height: 19,
  participants: [],
  group_template: PRIMARY,
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [
    { template: '0x0', level: 2, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 },
    { template: '0x0', level: 9, hp: 30, max_hp: 30, cell: 46, ap: 6, mp: 3 },
  ],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  turn_entropy: null,
  turn_ordinal: null,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

describe('world mob identity roster adoption', () => {
  test('the fight board projects each composed member identity through the one input door', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      ctx: {
        mob_roster: [
          { id: MOB_0, template_id: PRIMARY, name: 'Chicklet', min_level: 1, element: 3 },
          { id: MOB_1, template_id: SECONDARY, name: 'Draugr', min_level: 8, element: 2 },
        ],
      },
    })
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 })

    const { fighters } = engine_view(store.getState())
    expect(fighters.get('mob-0')).toMatchObject({
      variant: PRIMARY,
      name: 'Chicklet',
      level: 2,
      element: 3,
      identity_resolved: true,
    })
    expect(fighters.get('mob-1')).toMatchObject({
      variant: SECONDARY,
      name: 'Draugr',
      level: 9,
      element: 2,
      identity_resolved: true,
    })
  })

  test('a genuinely absent display identity surfaces the real template id', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      ctx: {
        mob_roster: [
          { id: MOB_0, template_id: PRIMARY },
          { id: MOB_1, template_id: SECONDARY },
        ],
      },
    })
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 })

    expect(engine_view(store.getState()).fighters.get('mob-1')).toMatchObject({
      variant: SECONDARY,
      name: SECONDARY,
      identity_resolved: false,
    })
  })

  test('a placement-to-active roster reorder keeps each display name on its entity id (#1608)', () => {
    const rapido = {
      id: MOB_0,
      template_id: PRIMARY,
      name: 'Rapido the Plague King',
      min_level: 5,
      element: 3,
    }
    const pecker = {
      id: MOB_1,
      template_id: SECONDARY,
      name: 'Pecker the Widow',
      min_level: 5,
      element: 2,
    }
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      ctx: { spectator: true, mob_roster: [rapido, pecker] },
    })
    store.getState().input({ type: 'snapshot', fight: fight_object(0), version: 1 })

    const placement = engine_view(store.getState()).fighters
    expect(placement.get(MOB_0)?.name).toBe(rapido.name)
    expect(placement.get(MOB_1)?.name).toBe(pecker.name)

    // The active projection may receive the same roster in a different order. Identity is the row id, never
    // whichever display record happens to occupy the fighter's current array ordinal.
    store.getState().input({ type: 'ctx', ctx: { mob_roster: [pecker, rapido] } })
    store.getState().input({ type: 'snapshot', fight: fight_object(1), version: 2 })

    const active = engine_view(store.getState()).fighters
    expect(active.get(MOB_0)).toMatchObject({ id: MOB_0, name: rapido.name, health: 20, level: 2 })
    expect(active.get(MOB_1)).toMatchObject({ id: MOB_1, name: pecker.name, health: 30, level: 9 })
  })
})
