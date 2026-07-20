// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NATURE-PLACEMENT GRAMMAR (GEN_VERSION 11) — the ecological tree/rock placement that replaces the
// uniform grove-cell sprinkle (uniform sprinkle placement reads as random, not natural —
// see Conquest Reforged and Massive Mountains for the target). Proves: the shared helpers behave
// (clusters/slope/treeline/scree/hero), enabling the grammar genuinely MOVES everest's decorated blocks,
// it's deterministic, grammar-off ≡ grammar-absent (legacy parity), and — the load-bearing one — the far
// impostor mirror AGREES with the near decorator column-for-column WITH the grammar ON (the ring seam I
// changed in both surface_decorator.js and render/far_trees_gen.js). The DEFAULT/other-recipe byte-parity
// is held by config_adoption.test.js (GOLDEN_DECORATED) + far_trees_gen.test.js (grammar-off seam).

import { test, expect, describe } from 'bun:test'

import { EVEREST_WORLD } from '../config/worlds/everest.js'
import {
  derive_section_trees,
  impostor_layer,
  impostor_stride,
  IMPOSTOR_FLOATS_PER_TREE,
} from '../render/far_trees_gen.js'

import {
  resolve_grammar,
  grammar_tree_at,
  grammar_rock_at,
  grammar_hero_species,
  grammar_biome_density,
  grammar_slope,
  GRAMMAR_DEFAULTS,
} from './deco_shared.js'
import { SPECIES } from './trees/species.js'
import { create_gen_context } from './column_gen.js'
import { resolve_placement_at } from './surface_decorator.js'

// A grammar with all defaults (only `enabled`), for the unit sweeps.
const G = /** @type {any} */ (resolve_grammar({ grammar: { enabled: true } }))
const FLAT = () => 60 // constant surface, well below a 155 treeline ⇒ slope 0, no thinning
const STEEP = (/** @type {number} */ x) => 2 * x // a 2:1 ramp ⇒ slope 2 everywhere (> tree_slope_max)
const BR = 0.25 // a dense-stand base_rate (the biome canopy_density fed to grammar_tree_at)

describe('grammar_biome_density — the per-region walkability knob', () => {
  test('per-biome override wins; else the canopy_density default', () => {
    const g = /** @type {any} */ (
      resolve_grammar({ grammar: { enabled: true, canopy_density: 0.05, biome_density: { dense_forest: 0.08 } } })
    )
    expect(grammar_biome_density(g, 'dense_forest')).toBe(0.08) // override
    expect(grammar_biome_density(g, 'taiga')).toBe(0.05) // fallback to canopy_density
  })
})

describe('grammar config resolution', () => {
  test('absent / disabled ⇒ null (⇒ caller runs the legacy grove scatter ⇒ parity)', () => {
    expect(resolve_grammar(undefined)).toBeNull()
    expect(resolve_grammar({})).toBeNull()
    expect(resolve_grammar({ grammar: { enabled: false } })).toBeNull()
  })
  test('enabled ⇒ defaults merged; config overrides win', () => {
    const g = /** @type {any} */ (
      resolve_grammar({ grammar: { enabled: true, tree_slope_max: 0.9, hero_species: 'pine_cathedral' } })
    )
    expect(g.enabled).toBe(true)
    expect(g.tree_slope_max).toBe(0.9) // override
    expect(g.cluster_period).toBe(GRAMMAR_DEFAULTS.cluster_period) // default filled
    expect(g.hero_species).toBe('pine_cathedral')
  })
})

describe('grammar_slope (central difference)', () => {
  test('flat ⇒ 0; a 2:1 ramp ⇒ 2', () => {
    expect(grammar_slope(FLAT, 10, 20, 3)).toBe(0)
    expect(grammar_slope(STEEP, 10, 20, 3)).toBeCloseTo(2, 6)
  })
})

describe('grammar tree placement — clusters, slope, treeline', () => {
  test('deterministic (pure fn of x,z,seed)', () => {
    for (const [x, z] of [
      [0, 0],
      [13, -7],
      [128, 64],
    ])
      expect(grammar_tree_at(G, FLAT, x, z, 1234, 60, 155, BR)).toBe(grammar_tree_at(G, FLAT, x, z, 1234, 60, 155, BR))
  })
  test('CLUSTERS: flat ground grows stands AND clearings (not uniform, not empty)', () => {
    let trees = 0
    let cols = 0
    for (let wz = 0; wz < 240; wz += 4)
      for (let wx = 0; wx < 240; wx += 4) {
        cols += 1
        if (grammar_tree_at(G, FLAT, wx, wz, 7, 60, 155, BR)) trees += 1
      }
    expect(trees).toBeGreaterThan(0) // stands place trees
    expect(trees).toBeLessThan(cols * 0.5) // clustered — clearings exist (not a uniform fill)
  })
  test('SLOPE GATE: steep faces grow NO trees (flat ground does)', () => {
    let flat_trees = 0
    let steep_trees = 0
    for (let wz = 0; wz < 200; wz += 4)
      for (let wx = 0; wx < 200; wx += 4) {
        if (grammar_tree_at(G, FLAT, wx, wz, 5, 60, 155, BR)) flat_trees += 1
        if (grammar_tree_at(G, STEEP, wx, wz, 5, 60, 155, BR)) steep_trees += 1
      }
    expect(steep_trees).toBe(0) // slope 2 > tree_slope_max 1.4 ⇒ bare steep faces
    expect(flat_trees).toBeGreaterThan(0)
  })
  test('TREELINE THINNING: density falls toward the treeline (krummholz)', () => {
    let low = 0
    let high = 0
    for (let wz = 0; wz < 260; wz += 3)
      for (let wx = 0; wx < 260; wx += 3) {
        if (grammar_tree_at(G, FLAT, wx, wz, 9, 60, 155, BR)) low += 1 // surface 60 ⇒ below the band ⇒ full
        if (grammar_tree_at(G, FLAT, wx, wz, 9, 150, 155, BR)) high += 1 // surface 150 ⇒ deep in the band ⇒ thinned
      }
    expect(high).toBeLessThan(low)
    expect(low).toBeGreaterThan(0)
  })
})

describe('grammar rock scree — boulders densify on the steep faces trees vacate', () => {
  test('steep slope grows MORE scree than the flat', () => {
    let flat_r = 0
    let steep_r = 0
    for (let wz = 0; wz < 260; wz += 3)
      for (let wx = 0; wx < 260; wx += 3) {
        if (grammar_rock_at(G, FLAT, wx, wz, 3, 16)) flat_r += 1
        if (grammar_rock_at(G, STEEP, wx, wz, 3, 16)) steep_r += 1
      }
    expect(steep_r).toBeGreaterThan(flat_r) // slope affinity concentrates scree on steeps
  })
})

describe('grammar hero channel — rare forced landmark species', () => {
  test('rare, forced to the configured species; absent when unset', () => {
    const hg = /** @type {any} */ (
      resolve_grammar({ grammar: { enabled: true, hero_species: 'pine_cathedral', hero_one_in: 20 } })
    )
    let heroes = 0
    let cols = 0
    for (let wz = 0; wz < 200; wz += 2)
      for (let wx = 0; wx < 200; wx += 2) {
        cols += 1
        const h = grammar_hero_species(hg, wx, wz, 11)
        if (h) {
          expect(h).toBe('pine_cathedral')
          heroes += 1
        }
      }
    expect(heroes).toBeGreaterThan(0)
    expect(heroes).toBeLessThan(cols / 6) // rare (~1/20)
    expect(grammar_hero_species(G, 0, 0, 11)).toBeNull() // default hero_species null ⇒ no hero channel
  })
})

// ── EVEREST INTEGRATION: the grammar ships on everest (decoration.grammar.enabled). Tested at the pure
// resolve_placement_at DECISION (what the grammar rearranges) — generate_column is terrain-only (the
// decorator runs in generate_world_chunk), so a column diff would miss decoration. Sweep the ice_forest
// valley (world 1280..1536 × -2560..-2304, surface_y ≈17, below the treeline) where the grammar fires.
const everest_off = {
  ...structuredClone(EVEREST_WORLD),
  decoration: {
    ...structuredClone(EVEREST_WORLD.decoration),
    grammar: { ...EVEREST_WORLD.decoration.grammar, enabled: false },
  },
}

/** Map of column "wx,wz" → placement signature (`name@surface_y`, or '' for none) over the valley. */
function scan_placements(cfg) {
  const ctx = create_gen_context(cfg)
  const seed = /** @type {*} */ (ctx).seeds.decorators
  const m = new Map()
  for (let wx = 1280; wx < 1536; wx += 4)
    for (let wz = -2560; wz < -2304; wz += 4) {
      const p = resolve_placement_at(ctx, wx, wz, seed)
      m.set(`${wx},${wz}`, p ? `${/** @type {*} */ (p).schematic.name}@${p.surface_y}` : '')
    }
  return m
}

describe('everest integration — the grammar is REAL, deterministic, and parity-clean', () => {
  test('SENSITIVITY — enabling the grammar genuinely rearranges placements', () => {
    const on = scan_placements(EVEREST_WORLD)
    const off = scan_placements(everest_off)
    let diff = 0
    for (const [k, v] of on) if (off.get(k) !== v) diff += 1
    expect(diff).toBeGreaterThan(0) // the cluster/slope/treeline grammar moves trees/rocks vs the grove scatter
  })

  test('DETERMINISM — same recipe twice ⇒ byte-identical placement set', () => {
    const a = scan_placements(EVEREST_WORLD)
    const b = scan_placements(EVEREST_WORLD)
    expect(a.size).toBe(b.size)
    for (const [k, v] of a) expect(b.get(k)).toBe(v)
  })

  test('PARITY — grammar.enabled:false ≡ grammar block ABSENT (both take the legacy scatter path)', () => {
    const absent = structuredClone(EVEREST_WORLD)
    delete absent.decoration.grammar
    const off = scan_placements(everest_off)
    const abs = scan_placements(absent)
    expect(off.size).toBe(abs.size)
    for (const [k, v] of off) expect(abs.get(k)).toBe(v)
  })
})

describe('WALKABILITY (forests must stay walkable, not ultra dense)', () => {
  test('the DENSEST ice_forest stand stays traversable — open ground + long straight clear lanes', () => {
    const ctx = create_gen_context(EVEREST_WORLD)
    const seed = /** @type {*} */ (ctx).seeds.decorators
    // Mark each placed tree's TRUNK footprint (anchor ± species.trunk_r) as blocked over the stand, then
    // measure how much ground stays open + the longest straight (W→E) trunk-free run per row. A walkable
    // forest keeps most ground open AND offers long straight lanes (walk through, no zigzag gap-hunting).
    const X0 = 1360
    const X1 = 1520
    const Z0 = -2500
    const Z1 = -2340
    const W = X1 - X0
    const H = Z1 - Z0
    const blocked = new Uint8Array(W * H)
    for (let wx = X0 - 12; wx < X1 + 12; wx += 1)
      for (let wz = Z0 - 12; wz < Z1 + 12; wz += 1) {
        const p = resolve_placement_at(ctx, wx, wz, seed)
        const nm = p && /** @type {*} */ (p).schematic?.name
        if (!nm || !nm.includes(':')) continue
        const sp = /** @type {*} */ (SPECIES)[nm.split(':')[0]]
        const r = sp ? sp.trunk_r : 2
        for (let dx = -r; dx <= r; dx += 1)
          for (let dz = -r; dz <= r; dz += 1) {
            if (dx * dx + dz * dz > r * r) continue
            const x = wx + dx - X0
            const z = wz + dz - Z0
            if (x >= 0 && x < W && z >= 0 && z < H) blocked[z * W + x] = 1
          }
      }
    let nblk = 0
    for (const b of blocked) nblk += b
    let run_sum = 0
    for (let z = 0; z < H; z += 1) {
      let run = 0
      let best = 0
      for (let x = 0; x < W; x += 1) {
        if (blocked[z * W + x]) run = 0
        else {
          run += 1
          if (run > best) best = run
        }
      }
      run_sum += best
    }
    expect(nblk).toBeGreaterThan(0) // it IS a forest (trees present)
    expect(nblk / (W * H)).toBeLessThan(0.4) // most ground stays OPEN — not a wall (measured ~0.27)
    expect(run_sum / H).toBeGreaterThan(12) // long straight trunk-free lanes exist (measured ~92 blocks)
  })
})

describe('SEAM under grammar ON — far impostor mirror == near decorator (0 mismatches)', () => {
  // The mechanical gate for my far_trees_gen mirror WITH the grammar live: over the forested valley, the
  // far shell grows a tree of layer L at a column IFF the decorator grows a procedural tree of the same
  // layer there. Any drift in the shared cluster/slope/treeline/hero gates fails this before it can
  // pop/double a tree at the ring seam. (far_trees_gen.test.js proves the same for the grammar-OFF DEFAULT.)
  const ctx = create_gen_context(EVEREST_WORLD)
  const seed = /** @type {*} */ (ctx).seeds.decorators
  const BX = 1280 // ice_forest region core (forested, below the treeline) — a whole multiple of the L1 span
  const BZ = -2560
  const stride = impostor_stride(1)
  const span = 32 * 2 // L1 span (64 m)

  /** @type {Map<string, number>} far column "wx,wz" → atlas layer */
  const far_map = new Map()
  for (let sz = 0; sz < 4; sz += 1)
    for (let sx = 0; sx < 4; sx += 1) {
      const out = derive_section_trees(ctx, { level: 1, origin_x: BX + sx * span, origin_z: BZ + sz * span, span })
      for (let i = 0; i < out.count; i += 1) {
        const o = i * IMPOSTOR_FLOATS_PER_TREE
        far_map.set(`${out.data[o]},${out.data[o + 2]}`, out.data[o + 5])
      }
    }

  test('the swept region IS forested (the grammar grows trees below the treeline)', () => {
    expect(far_map.size).toBeGreaterThan(0)
  })

  test('BIDIRECTIONAL PARITY — near ⇔ far agree column-for-column under the grammar', () => {
    let checked = 0
    let near_trees = 0
    let mismatches = 0
    for (let wz = BZ; wz < BZ + 4 * span; wz += stride)
      for (let wx = BX; wx < BX + 4 * span; wx += stride) {
        checked += 1
        const near = resolve_placement_at(ctx, wx, wz, seed)
        let near_layer = -1
        if (near) {
          const nm = /** @type {*} */ (near).schematic.name
          const c = nm.indexOf(':')
          if (c >= 0) near_layer = impostor_layer(nm.slice(0, c), nm.slice(c + 1))
        }
        if (near_layer >= 0) near_trees += 1
        const far_layer = far_map.has(`${wx},${wz}`) ? /** @type {number} */ (far_map.get(`${wx},${wz}`)) : -1
        if (near_layer !== far_layer) mismatches += 1
      }
    expect(checked).toBeGreaterThan(1000) // the sweep actually ran
    expect(near_trees).toBeGreaterThan(0) // and it hit real trees (not a vacuous 0==0 pass)
    expect(mismatches).toBe(0) // near and far agree everywhere — the seam is exact under the grammar
  })
})
