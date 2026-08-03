// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #387 — THE WEAPON STRIKE ZONE MATRIX, the SIM twin's half: every ruled category × every facing, the exact
// cell set its strike touches AND NOTHING OUTSIDE.
//
// WHY IT LIVES HERE and not beside the category table: a weapon zone is drawn by the SAME zone engine every
// spell AoE already uses — `spell_targeting::get_aoe_cells`, whose chain twin is `combat_grid::zone_cells`.
// There is no weapon-specific geometry on either side of the twin (#387's own reuse rule): the category table
// only names WHICH `(area_shape, area_size)` descriptor a strike carries, and that descriptor goes straight into
// the spell zone engine. So the zone half of the matrix is a SIM property and is asserted against the sim's own
// engine here, while the fixture's `categories` rows pin the assignment both twins must agree on.
//
// THE ROTATION DIMENSION is what this file adds over the single-facing coverage that already existed: a TBAR or
// PODIUM is drawn around the attacker→target axis, so proving a staff sweeps three cells when the attacker faces
// EAST proves nothing about the other three facings, about a diagonal aim (where |dx| ties |dy| and the tie must
// break to the x axis on both twins), or about a target on the board's last column (where the forward step falls
// off the grid and must be DROPPED, never wrapped). All six conditions are in `FACINGS.facings`.
//
// TWO FIXTURES, one fact each. `weapon_shapes.json` is settled evidence about a single facing and stays
// untouched — it owns the zone-kind DESCRIPTORS and the category → zone ASSIGNMENTS. `weapon_shape_facings.json`
// is new evidence about a dimension that file never covered, and owns only the per-facing cell sets. Their one
// overlap (the `east` row) is asserted equal below, so the split can never become a silent fork. Both were
// derived from the ruled geometry, NOT read out of the implementation, so agreement is evidence.
// `weapon_shape_tests.move` asserts the identical vectors through the chain's zone engine; a divergence between
// the twins breaks one of these two files by construction.

import { describe, expect, test } from 'bun:test'

import { get_aoe_cells } from '../src/spell_targeting.js'

import FACINGS from './fixtures/weapon_shape_facings.json' with { type: 'json' }
import FIXTURE from './fixtures/weapon_shapes.json' with { type: 'json' }

const GRID_W = 20
const decode = cell => ({ x: cell % GRID_W, y: Math.floor(cell / GRID_W) })
const encode = ({ x, y }) => y * GRID_W + x
const sorted = cells => [...cells].sort((a, b) => a - b)
const sorted_names = names => [...names].sort()

/** The `(area_shape, area_size)` descriptor of a named zone kind, off the fixture's engine-truth block. */
const descriptor_of = zone => {
  const row = FIXTURE.zones.find(candidate => candidate.zone === zone)
  if (!row) throw new Error(`fixture carries no zone kind named "${zone}"`)
  return { area_shape: row.area_shape, area_size: row.area_size }
}

/** The cell set the SIM's zone engine resolves for a descriptor aimed at `anchor` from `caster`. */
const resolve = (descriptor, caster, anchor) =>
  sorted(get_aoe_cells(descriptor, decode(anchor), decode(caster)).map(encode))

const ZONE_KINDS = FIXTURE.zones.map(row => row.zone)

describe('#387 zone kinds — the exact cell set in every facing', () => {
  for (const facing of FACINGS.facings)
    for (const zone of ZONE_KINDS)
      test(`${zone} facing ${facing.facing} touches exactly its ruled cells`, () => {
        const expected = facing.zones[zone]
        expect(expected).toBeDefined()
        // toEqual on the full sorted set IS the "and nothing outside" half: an extra cell fails just as loudly
        // as a missing one.
        expect(
          resolve(descriptor_of(zone), facing.caster, facing.anchor),
        ).toEqual(sorted(expected))
      })
})

describe('#387 weapon categories — every ruled category, every facing', () => {
  for (const facing of FACINGS.facings)
    for (const row of FIXTURE.categories)
      test(`${row.category} facing ${facing.facing} strikes its ${row.zone} zone and nothing else`, () => {
        expect(
          resolve(descriptor_of(row.zone), facing.caster, facing.anchor),
        ).toEqual(sorted(facing.zones[row.zone]))
      })
})

describe('#387 the two fixtures agree where they overlap', () => {
  // The split is only safe while it cannot fork. `weapon_shapes.json` pins one facing; the `east` row here is
  // that same facing. If either file is ever edited alone, this fails — the split stays a split, never a fork.
  test('the east facing matches the single-facing fixture, zone for zone', () => {
    const east = FACINGS.facings.find(row => row.facing === 'east')
    expect([east.caster, east.anchor]).toEqual([FIXTURE.caster, FIXTURE.anchor])
    for (const row of FIXTURE.zones)
      expect(sorted(east.zones[row.zone])).toEqual(sorted(row.cells))
  })

  test('both fixtures name the same five zone kinds', () => {
    const east = FACINGS.facings.find(row => row.facing === 'east')
    expect(sorted_names(Object.keys(east.zones))).toEqual(
      sorted_names(ZONE_KINDS),
    )
  })
})

describe('#387 the rotation dimension has teeth', () => {
  // Without these, the matrix above could pass on a zone engine that ignored the axis entirely.
  const directional = ['line_inline_2', 'line_perp_3', 'podium_4']
  const cardinal = ['east', 'west', 'south', 'north'].map(name =>
    FACINGS.facings.find(row => row.facing === name),
  )

  for (const zone of directional)
    test(`${zone} draws a DIFFERENT cell set in each of the four cardinal facings`, () => {
      const drawn = cardinal.map(facing =>
        resolve(descriptor_of(zone), facing.caster, facing.anchor).join(),
      )
      expect(new Set(drawn).size).toBe(4)
    })

  test('the aimed cell is in every zone, in every facing', () => {
    for (const facing of FACINGS.facings)
      for (const zone of ZONE_KINDS)
        expect(
          resolve(descriptor_of(zone), facing.caster, facing.anchor),
        ).toContain(facing.anchor)
  })

  test('a diagonal aim breaks the tie to the X axis on the sim twin', () => {
    const tie = FACINGS.facings.find(
      row => row.facing === 'diagonal_tie_x_wins',
    )
    // caster 105 (5,5) aiming 126 (6,6): |dx| == |dy| == 1. X wins ⇒ the forward step is 127 (7,6), and the
    // perpendicular bar runs on y (106 / 146). A tie broken to Y would put 125/127 on the bar and 146 forward.
    expect(resolve(descriptor_of('podium_4'), tie.caster, tie.anchor)).toEqual(
      sorted([126, 146, 106, 127]),
    )
  })

  test('a zone CLIPS at the board edge — cells never wrap to the far side', () => {
    const wall = FACINGS.facings.find(row => row.facing === 'east_wall_clamped')
    // anchor 119 = (19,5), the last column. The inline second cell and the podium's forward step are both
    // off-grid: an implementation that wrapped would land on x=0 (cells 100 / 120), 19 columns away.
    const inline = resolve(
      descriptor_of('line_inline_2'),
      wall.caster,
      wall.anchor,
    )
    const podium = resolve(descriptor_of('podium_4'), wall.caster, wall.anchor)
    expect(inline).toEqual([119])
    expect(podium).toEqual(sorted([119, 139, 99]))
    for (const cells of [inline, podium])
      for (const cell of cells) expect(cell % GRID_W).toBeGreaterThan(0)
  })
})

describe('#387 the ruled table is TOTAL and its zone kinds stay distinct', () => {
  test('every enumerated category resolves a zone kind the engine knows', () => {
    for (const row of FIXTURE.categories) expect(ZONE_KINDS).toContain(row.zone)
  })

  test('the ruled shape classes have the ruled cell counts', () => {
    const count_of = zone => FACINGS.facings[0].zones[zone].length
    // 1-CELL · 2-INLINE · 3-FRONT-ARC · PODIUM-4 — the owner's total table, one assertion per class.
    expect(count_of('single')).toBe(1)
    expect(count_of('line_inline_2')).toBe(2)
    expect(count_of('line_perp_3')).toBe(3)
    expect(count_of('podium_4')).toBe(4)
    expect(count_of('cross_1')).toBe(5)
  })

  test('the three RANGED categories are single-cell — range is a band, never a wider zone', () => {
    for (const category of ['bow', 'wand', 'spellbook']) {
      const row = FIXTURE.categories.find(
        candidate => candidate.category === category,
      )
      expect(row.zone).toBe('single')
    }
  })

  test('only the bow is range-MODIFIABLE and only the spellbook is line-only', () => {
    const of = category =>
      FIXTURE.categories.find(row => row.category === category)
    expect(of('bow').range_modifiable).toBe(true)
    expect(of('wand').range_modifiable).toBe(false)
    expect(Boolean(of('spellbook').range_modifiable)).toBe(false)
    expect(of('spellbook').line_only).toBe(true)
    expect(Boolean(of('bow').line_only)).toBe(false)
    expect(Boolean(of('wand').line_only)).toBe(false)
  })
})
