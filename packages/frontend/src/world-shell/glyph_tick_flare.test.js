// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GLYPH TICK FLARE — presentation observes the actor the eye is currently watching, never fold glyph lifetime
// internals or packet arrivals. The plan is a pure delta over one primitive actor id: poll echoes are inert, each
// paced turn transition emits the complete active glyph cell set exactly once.

import { describe, expect, test } from 'bun:test'

import { glyph_tick_flare_plan, visible_turn_actor_id } from './voxel_fight_folds.js'

const GLYPH_CELLS = [101, 102, 121, 122]

const fight_view = (overrides = {}) => ({
  fight_id: '0xfight',
  winner: -1,
  presenting: false,
  presenting_entity_id: null,
  active_entity_id: '0xplayer',
  my_glyphs: GLYPH_CELLS,
  ...overrides,
})

describe('visible_turn_actor_id — the presentation clock, never the ahead-of-eye chain clock', () => {
  test('reads the paced replay actor while a turn presents, then falls back to the active actor', () => {
    expect(
      visible_turn_actor_id(
        fight_view({ presenting: true, presenting_entity_id: 'mob-0', active_entity_id: '0xplayer' })
      )
    ).toBe('mob-0')
    expect(visible_turn_actor_id(fight_view())).toBe('0xplayer')
  })

  test('terminal and absent fights have no visible live-turn actor', () => {
    expect(visible_turn_actor_id(fight_view({ winner: 0 }))).toBeNull()
    expect(visible_turn_actor_id(null)).toBeNull()
  })
})

describe('glyph_tick_flare_plan — one subtle full-zone cue per visible turn transition', () => {
  test('first observation establishes a baseline without inventing a turn tick', () => {
    expect(glyph_tick_flare_plan(undefined, fight_view())).toEqual({
      visible_actor_id: '0xplayer',
      glyph_cells: [],
    })
  })

  test('a replayed snapshot of the same actor never flares twice', () => {
    expect(glyph_tick_flare_plan('mob-0', fight_view({ presenting: true, presenting_entity_id: 'mob-0' }))).toEqual({
      visible_actor_id: 'mob-0',
      glyph_cells: [],
    })
  })

  test('an actor transition emits every active glyph cell without aliasing the projection', () => {
    const view = fight_view({ presenting: true, presenting_entity_id: 'mob-1' })
    const plan = glyph_tick_flare_plan('mob-0', view)

    expect(plan).toEqual({ visible_actor_id: 'mob-1', glyph_cells: GLYPH_CELLS })
    expect(plan.glyph_cells).not.toBe(view.my_glyphs)
  })

  test('the final replay-to-player handoff is a turn transition, while an empty zone stays inert', () => {
    expect(glyph_tick_flare_plan('mob-1', fight_view()).glyph_cells).toEqual(GLYPH_CELLS)
    expect(glyph_tick_flare_plan('mob-1', fight_view({ my_glyphs: [] })).glyph_cells).toEqual([])
  })

  test('terminal/null transitions never flare stale glyph cells', () => {
    expect(glyph_tick_flare_plan('mob-0', fight_view({ winner: 0 }))).toEqual({
      visible_actor_id: null,
      glyph_cells: [],
    })
  })
})
