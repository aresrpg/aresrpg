// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1497 — a world claim has already composed and rendered this positional roster. The fight init input must
// preserve it through snapshot adoption instead of resolving every mob from the shared primary template.

import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xfight'
const PRIMARY = '0xchicklet'
const SECONDARY = '0xdraugr'

const fight_object = () => ({
  id: FIGHT,
  status: 1,
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
          { template_id: PRIMARY, name: 'Chicklet', min_level: 1, element: 3 },
          { template_id: SECONDARY, name: 'Draugr', min_level: 8, element: 2 },
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
        mob_roster: [{ template_id: PRIMARY }, { template_id: SECONDARY }],
      },
    })
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 })

    expect(engine_view(store.getState()).fighters.get('mob-1')).toMatchObject({
      variant: SECONDARY,
      name: SECONDARY,
      identity_resolved: false,
    })
  })
})
