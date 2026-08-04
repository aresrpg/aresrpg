// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BAKE-THEN-STAMP — tests. The bake module reuses tree_gen's frozen output (generate_tree), so this file
// guards the BAKE contract, not the generator math (that's tree_gen.test.js's golden hash):
//   (1) n<=0 is BYTE-IDENTICAL to the live per-column generate_tree (the `?baketrees=0` escape contract).
//   (2) the per-column pick is DETERMINISTIC (same world seed ⇒ same variant at the same column) and a
//       different world seed shifts the picks.
//   (3) the baked set has real VARIETY (not one tree N times) and every variant is a substantial tree.

import { test, expect, describe } from 'bun:test'

import { for_each_voxel, voxel_count } from '../../../src/gen/schematics/loader.js'
import { generate_tree } from '../../../src/gen/trees/tree_gen.js'
import { SPECIES_KEYS } from '../../../src/gen/trees/species.js'
import { bake_species_variants, pick_baked_tree, reset_tree_bake_cache } from '../../../src/gen/trees/tree_bake.js'

const SEED = 0x1234abcd
const N = 12

/** Canonical byte string of a schematic (order-stable — for_each_voxel yields the generator's sort).
 *  @param {import('../../../src/gen/schematics/loader.js').ResolvedSchematic} t */
function schematic_str(t) {
  /** @type {string[]} */
  const parts = []
  for_each_voxel(t, (dx, dy, dz, e) => parts.push(`${dx},${dy},${dz},${e.block_id},${e.solid ? 1 : 0},${e.mode}`))
  return `${t.name}|${t.size.join(',')}|${t.reach}|${parts.join(';')}`
}

describe('bake-then-stamp contract', () => {
  test('n<=0 ⇒ BYTE-IDENTICAL to the live per-column generate_tree (the ?baketrees=0 escape)', () => {
    reset_tree_bake_cache()
    for (const key of SPECIES_KEYS) {
      const live = pick_baked_tree(SEED, 40, -90, key, 0)
      const direct = generate_tree(SEED, 40, -90, key)
      expect(schematic_str(live)).toBe(schematic_str(direct))
    }
  })

  test('the per-column pick is DETERMINISTIC across cache resets (same seed ⇒ same variant/place)', () => {
    reset_tree_bake_cache()
    const first = SPECIES_KEYS.map((k) => schematic_str(pick_baked_tree(SEED, 314, -159, k, N)))
    reset_tree_bake_cache() // re-bake from scratch
    const second = SPECIES_KEYS.map((k) => schematic_str(pick_baked_tree(SEED, 314, -159, k, N)))
    expect(second).toEqual(first)
  })

  test('a different world seed shifts the picks (per-world variety)', () => {
    reset_tree_bake_cache()
    let differ = 0
    for (const key of SPECIES_KEYS) {
      const a = schematic_str(pick_baked_tree(SEED, 8, 8, key, N))
      const b = schematic_str(pick_baked_tree((SEED ^ 0x55555555) >>> 0, 8, 8, key, N))
      if (a !== b) differ += 1
    }
    expect(differ).toBeGreaterThan(0) // at least some species pick a different variant under a new seed
  })

  test('the baked set has VARIETY (not one tree N times) and every variant is substantial', () => {
    reset_tree_bake_cache()
    for (const key of SPECIES_KEYS) {
      const set = bake_species_variants(SEED, key, N)
      expect(set.length).toBe(N)
      const distinct = new Set(set.map(schematic_str))
      expect(distinct.size).toBeGreaterThan(1) // genuine variety, not a repeated single tree
      for (const t of set) expect(voxel_count(t)).toBeGreaterThan(40) // a real crown-bearing tree
    }
  })

  test('param_overrides HOOK changes the baked geometry (quality-tier lever, unwired)', () => {
    reset_tree_bake_cache()
    const stock = bake_species_variants(SEED, 'oak_broadleaf', N)
    // a lighter-canopy "medium" tier: more sky gaps (higher leaf_hole) ⇒ fewer leaf voxels on average.
    const lighter = bake_species_variants(SEED, 'oak_broadleaf', N, { leaf_hole: 180 })
    const sum = (/** @type {import('../../../src/gen/schematics/loader.js').ResolvedSchematic[]} */ s) =>
      s.reduce((n, t) => n + voxel_count(t), 0)
    expect(sum(lighter)).not.toBe(sum(stock)) // the hook actually reaches the generator
  })
})
