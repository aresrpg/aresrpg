// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #933 — clicking a reachable non-adjacent cell stages the existing BFS route and its exact MP cost. The
// browser-heavy DungeonBoard cannot mount in Bun without the missing renderer assets, so the pure verdict lives
// in overlay_intents.test.js and this source contract pins the click edge to that one home.

import { describe, expect, test } from 'bun:test'
import { decode } from '@aresrpg/fight/los'
import { local_move_beats } from '@aresrpg/fight/present'

import { move_plan_dungeon } from '../fight-engine/overlay_intents.js'

describe('#933 — DungeonBoard routes legal clicks through the shared move plan', () => {
  test('the plan is proven before staging and feeds both the path preview and MP remainder', async () => {
    const source = await Bun.file(new URL('../game/screens/hud/world/DungeonBoard.jsx', import.meta.url)).text()
    const walk_start = source.indexOf('const optimistic_walk =')
    const walk_end = source.indexOf('const optimistic_cast =', walk_start)
    const click_start = source.indexOf('const on_cell_click =')
    const click_end = source.indexOf('// Relay:', click_start)
    const walk = source.slice(walk_start, walk_end)
    const click = source.slice(click_start, click_end)

    expect(source).toContain('move_plan_dungeon')
    expect(walk).toContain('plan.path.map(decode)')
    expect(walk).toContain('mp_left: plan.mp_left')
    expect(click).toContain('const plan = move_plan_dungeon')
    expect(click).toContain('if (!plan) return')
    expect(click.indexOf('const plan = move_plan_dungeon')).toBeLessThan(click.indexOf('append_move_step(cell)'))
    expect(click.indexOf('if (!plan) return')).toBeLessThan(click.indexOf('append_move_step(cell)'))
    expect(source).not.toMatch(/\bbfsPath(?:Cost)?\b/)
  })

  test('the highlighted path length is the MP cost rendered for a non-adjacent click', () => {
    const plan = move_plan_dungeon({ cell: { x: 0, y: 0 } }, { x: 2, y: 0 }, { blocked: new Set(), mp: 5 })
    expect(plan).not.toBeNull()
    if (!plan) throw new Error('expected a legal two-cell move plan')

    const beats = local_move_beats({
      fight_id: '0xf1',
      character: '0xc1',
      to_cell: plan.path.at(-1),
      path: plan.path.map(decode),
    })
    const move = beats.find((beat) => beat.kind === 'move')

    expect(move.payload.path).toEqual(plan.path.map(decode))
    expect(move.payload.mp_spent).toBe(plan.mp_cost)
  })
})
