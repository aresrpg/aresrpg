// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AOE + GLYPH HOVER FOOTPRINT (a "cross 1" must show its full 5-cell plus, not a single-cell blob, and the
// entire glyph zone must show when hovering the target cell, like for AoE). The hover telegraph must paint the FULL zone
// shape. These prove the fold that derives it: the UNION / DEDUPE / caster→target ORIENTATION layered on top of
// the sim's OWN get_aoe_cells (the one shape home — its per-shape math is covered in sim/test/spell_targeting.test.js,
// so here we only assert the fold never re-implements a shape and never lies about the zone). Pure — no scene/GPU.
import { describe, expect, it } from 'bun:test'

import { footprint_of_effects, is_glyph_spell } from './voxel_fight_folds.js'
import { SPELLS_SEED_AVAILABLE } from '../test_helpers/spells_fixture.js'

// SHAPE_* enum (packages/sim/src/spell_effect.js) — the on-chain shape ids a normalized effect carries. Inlined
// because @aresrpg/sim only re-exports the shape MATH (get_aoe_cells), not the raw shape constants.
const SHAPE_POINT = 0
const SHAPE_CIRCLE = 1
const SHAPE_CROSS = 2
const SHAPE_LINE = 3
const cell_set = (cells) => new Set(cells.map((c) => `${c.x},${c.y}`))

describe('footprint_of_effects — the full hover zone (one shape home = get_aoe_cells)', () => {
  const T = { x: 10, y: 9 } // central on the 20×19 combat grid — every zone below stays in-bounds

  it('a cross-1 effect paints the 5-cell plus, not a single cell (regression coverage)', () => {
    const foot = footprint_of_effects([{ area_shape: SHAPE_CROSS, area_size: 1 }], T, T)
    expect(foot.length).toBe(5)
    expect(cell_set(foot)).toEqual(cell_set([T, { x: 9, y: 9 }, { x: 11, y: 9 }, { x: 10, y: 8 }, { x: 10, y: 10 }]))
  })

  it('a glyph circle-2 effect paints its whole manhattan disc (13 cells)', () => {
    const foot = footprint_of_effects([{ area_shape: SHAPE_CIRCLE, area_size: 2 }], T, T)
    expect(foot.length).toBe(13) // 1 + 4 + 8 (manhattan radius 0/1/2)
    const s = cell_set(foot)
    expect(s.has('11,10')).toBe(true) // a manhattan-2 diagonal is inside the disc
    expect(s.has('13,9')).toBe(false) // manhattan-3 is outside
  })

  it('a LINE effect orients along caster→target and never bleeds back toward the caster', () => {
    const line = footprint_of_effects([{ area_shape: SHAPE_LINE, area_size: 3 }], { x: 12, y: 9 }, { x: 10, y: 9 })
    expect(cell_set(line)).toEqual(
      cell_set([
        { x: 12, y: 9 },
        { x: 13, y: 9 },
        { x: 14, y: 9 },
        { x: 15, y: 9 },
      ])
    )
    // flip the caster to the OTHER side → the line flips with it (orientation is real, not hard-coded).
    const flipped = footprint_of_effects([{ area_shape: SHAPE_LINE, area_size: 3 }], { x: 12, y: 9 }, { x: 14, y: 9 })
    expect(cell_set(flipped)).toEqual(
      cell_set([
        { x: 12, y: 9 },
        { x: 11, y: 9 },
        { x: 10, y: 9 },
        { x: 9, y: 9 },
      ])
    )
  })

  it('unions every effect and dedupes overlaps', () => {
    const foot = footprint_of_effects(
      [
        { area_shape: SHAPE_CROSS, area_size: 1 },
        { area_shape: SHAPE_POINT, area_size: 0 },
        { area_shape: SHAPE_CROSS, area_size: 1 },
      ],
      T,
      T
    )
    expect(foot.length).toBe(5) // the point adds only the (already-present) target; the duplicate cross dedupes
  })

  it('falls back to the single target cell for a POINT-only or effectless spell (the melee/weapon case)', () => {
    expect(footprint_of_effects([{ area_shape: SHAPE_POINT, area_size: 0 }], T, T)).toEqual([T])
    expect(footprint_of_effects([], T, T)).toEqual([T])
    expect(footprint_of_effects(undefined, T, T)).toEqual([T])
  })
})

describe('is_glyph_spell — glyph placements take the orange tint on hover, everything else the red strike', () => {
  it('is false for the weapon sentinel / unknown / null id', () => {
    expect(is_glyph_spell(null)).toBe(false)
    expect(is_glyph_spell(undefined)).toBe(false)
    expect(is_glyph_spell('__no_such_spell__')).toBe(false)
  })

  // MISSING-ARTIFACT (#117): is_glyph_spell resolves through fight-spells.js's runtime spell corpus, empty
  // in this environment — see test_helpers/spells_fixture.js.
  it.skipIf(!SPELLS_SEED_AVAILABLE)('is true for a real seeded glyph-role spell', () => {
    // 'Rooting Glyph' (mori) — a seeded role:'glyph' spell; its name_key is the armed id the hover reads.
    expect(is_glyph_spell('rooting_glyph')).toBe(true)
  })
})
