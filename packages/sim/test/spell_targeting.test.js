// SPELL TARGETING — can_target's free_cell gate (traps/glyphs/teleport land on a FREE, NON-BLOCKED cell).
// The chain twin is spell_target::can_cast_at; the client twin is overlay_intents.cast_range_set_dungeon.

import { describe, expect, it } from 'bun:test'

import {
  can_target,
  effect_hits,
  get_aoe_cells,
} from '../src/spell_targeting.js'
import {
  SHAPE_ALLMAP,
  SHAPE_CONE,
  SHAPE_CROSS,
  SHAPE_LINE,
  SHAPE_RING,
  SHAPE_TBAR,
  TF_NONE,
  TF_NOT_ENEMY,
  TF_NOT_SELF,
  TF_NOT_TEAM,
  TF_ONLY_CASTER,
} from '../src/spell_effect.js'

// A minimal free_cell trap-like level: range [1,4], no linear/LOS constraint, free_cell ON.
const trap_level = {
  range: [1, 4],
  modifiable_range: false,
  linear: false,
  line_of_sight: false,
  free_cell: true,
}
// The same geometry WITHOUT free_cell — a normal offensive spell.
const damage_level = { ...trap_level, free_cell: false }

const caster = { x: 5, y: 5 }

describe('can_target — free_cell (trap) placement gate', () => {
  it('rejects a cell occupied by any entity (a mob body) — never trap a fighter', () => {
    const target = { x: 6, y: 5 } // in range, clear terrain, but a fighter stands here
    const ctx = {
      blocks_los: () => false,
      is_occupied: c => c.x === 6 && c.y === 5,
    }
    expect(can_target(trap_level, caster, target, ctx)).toBe(false)
    // the SAME occupied cell IS a legal target for a normal (non-free_cell) spell — the gate is free_cell-only.
    expect(can_target(damage_level, caster, target, ctx)).toBe(true)
  })

  it('rejects a blocked / non-walkable cell (a wall) — traps land on non-blocked cells', () => {
    const target = { x: 5, y: 7 } // in range, empty of fighters, but the terrain is a wall (blocks LoS)
    const ctx = {
      blocks_los: c => c.x === 5 && c.y === 7,
      is_occupied: () => false,
    }
    expect(can_target(trap_level, caster, target, ctx)).toBe(false)
  })

  it('accepts a FREE, non-blocked, in-range cell — the legal trap cell', () => {
    const target = { x: 4, y: 5 }
    const ctx = { blocks_los: () => false, is_occupied: () => false }
    expect(can_target(trap_level, caster, target, ctx)).toBe(true)
  })

  it('still enforces range for a free_cell spell (a free cell out of range is not targetable)', () => {
    const far = { x: 5, y: 12 } // distance 7 > rmax 4
    const ctx = { blocks_los: () => false, is_occupied: () => false }
    expect(can_target(trap_level, caster, far, ctx)).toBe(false)
  })
})

describe('effect_hits — Move target-filter parity', () => {
  it('TF_NONE hits caster, ally, and enemy', () => {
    expect(effect_hits(TF_NONE, true, true)).toBe(true)
    expect(effect_hits(TF_NONE, false, true)).toBe(true)
    expect(effect_hits(TF_NONE, false, false)).toBe(true)
  })

  it('TF_NOT_TEAM hits enemies only', () => {
    expect(effect_hits(TF_NOT_TEAM, true, true)).toBe(false)
    expect(effect_hits(TF_NOT_TEAM, false, true)).toBe(false)
    expect(effect_hits(TF_NOT_TEAM, false, false)).toBe(true)
  })

  it('TF_NOT_ENEMY hits caster and allies only', () => {
    expect(effect_hits(TF_NOT_ENEMY, true, true)).toBe(true)
    expect(effect_hits(TF_NOT_ENEMY, false, true)).toBe(true)
    expect(effect_hits(TF_NOT_ENEMY, false, false)).toBe(false)
  })

  it('TF_NOT_ENEMY | TF_NOT_SELF hits allies but not caster or enemies', () => {
    const filter = TF_NOT_ENEMY | TF_NOT_SELF
    expect(effect_hits(filter, true, true)).toBe(false)
    expect(effect_hits(filter, false, true)).toBe(true)
    expect(effect_hits(filter, false, false)).toBe(false)
  })

  it('TF_ONLY_CASTER hits only the caster', () => {
    expect(effect_hits(TF_ONLY_CASTER, true, true)).toBe(true)
    expect(effect_hits(TF_ONLY_CASTER, false, true)).toBe(false)
    expect(effect_hits(TF_ONLY_CASTER, false, false)).toBe(false)
  })

  it('TF_ONLY_CASTER takes precedence over TF_NOT_TEAM', () => {
    const filter = TF_ONLY_CASTER | TF_NOT_TEAM
    expect(effect_hits(filter, true, true)).toBe(true)
    expect(effect_hits(filter, false, true)).toBe(false)
    expect(effect_hits(filter, false, false)).toBe(false)
  })
})

describe('numeric effect zones — Move combat_grid parity', () => {
  const encoded = cells => cells.map(cell => cell.y * 20 + cell.x)

  it('uses the dominant cardinal cast direction for line and perpendicular T-bar', () => {
    const caster_cell = { x: 4, y: 7 }
    const target_cell = { x: 5, y: 8 }
    expect(
      encoded(
        get_aoe_cells(
          { area_shape: SHAPE_LINE, area_size: 3 },
          target_cell,
          caster_cell,
        ),
      ),
    ).toEqual([165, 166, 167, 168])
    expect(
      encoded(
        get_aoe_cells({ area_shape: SHAPE_TBAR, area_size: 2 }, target_cell, {
          x: 4,
          y: 8,
        }),
      ),
    ).toEqual([165, 185, 205, 145, 125])
  })

  it('clips cross/ring/all-map/cone cells to the 20x19 Move grid', () => {
    const cross = get_aoe_cells(
      { area_shape: SHAPE_CROSS, area_size: 4 },
      { x: 18, y: 8 },
    )
    expect(cross.every(cell => cell.x >= 0 && cell.x < 20)).toBe(true)
    expect(encoded(cross)).toContain(179)

    const ring = get_aoe_cells(
      { area_shape: SHAPE_RING, area_size: 3 },
      { x: 5, y: 8 },
    )
    expect(ring).toHaveLength(12)
    expect(
      get_aoe_cells({ area_shape: SHAPE_ALLMAP, area_size: 0 }, { x: 5, y: 8 }),
    ).toHaveLength(380)
    expect(
      encoded(
        get_aoe_cells(
          { area_shape: SHAPE_CONE, area_size: 3 },
          { x: 5, y: 8 },
          { x: 4, y: 8 },
        ),
      ),
    ).toEqual([165, 166, 186, 146, 167, 187, 147])
  })
})
