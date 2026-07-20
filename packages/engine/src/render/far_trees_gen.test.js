// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAR-TREE IMPOSTOR DERIVATION tests (ENGINE_AAA_PLAN §8 B3). Covers the PURE half: the species×age→layer
// bijection, the per-level stride, determinism, the level cap, and — the load-bearing one — SEAM
// AGREEMENT: every impostor the far shell derives is a REAL procedural tree the near ring's own
// resolve_placement_at grows at the same column, same species, same anchor (§3.6: the far shell and near
// chunks must AGREE at the seam, or trees pop/double). The render half (billboards) is proven on the GPU
// by bench/impostors_poses.spec.js.

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'
import { create_gen_context } from '../gen/column_gen.js'
import { resolve_placement_at } from '../gen/surface_decorator.js'
import { SPECIES, SPECIES_KEYS } from '../gen/trees/species.js'

import {
  canonical_impostor_schematic,
  derive_section_trees,
  impostor_layer,
  impostor_layer_spec,
  impostor_stride,
  IMPOSTOR_AGES,
  IMPOSTOR_BASE_STRIDE,
  IMPOSTOR_FLOATS_PER_TREE,
  IMPOSTOR_LAYER_COUNT,
  IMPOSTOR_MAX_LEVEL,
} from './far_trees_gen.js'

// The SHIPPING default (GEN_VERSION 9): procedural ON + baked_variants 32 — the parity sweep below gates
// the seam of the world we actually ship, including the baked variant-AGE mirror (tree_bake.SALT_BAKE_WZ).
const PROCTREES_ON = structuredClone(DEFAULT_WORLD_GEN_CONFIG)
// The ?baketrees=0 escape: live per-column synthesis (every tree unique) — the seam must hold there too.
const PROCTREES_LIVE = { ...structuredClone(DEFAULT_WORLD_GEN_CONFIG), trees: { procedural: true, baked_variants: 0 } }
// The ?proctrees=0 escape: procedural OFF. DEFAULT is procedural ON now (C4), so the OFF path needs this clone.
const PROCTREES_OFF = { ...structuredClone(DEFAULT_WORLD_GEN_CONFIG), trees: { procedural: false } }

describe('impostor atlas layer mapping', () => {
  test('IMPOSTOR_LAYER_COUNT = species × ages', () => {
    expect(IMPOSTOR_LAYER_COUNT).toBe(SPECIES_KEYS.length * IMPOSTOR_AGES.length)
  })

  test('layer ↔ (species, age) is a bijection over every layer', () => {
    const seen = new Set()
    for (let layer = 0; layer < IMPOSTOR_LAYER_COUNT; layer += 1) {
      const { species, age } = impostor_layer_spec(layer)
      expect(species in SPECIES).toBe(true)
      expect(IMPOSTOR_AGES.includes(/** @type {any} */ (age))).toBe(true)
      expect(impostor_layer(species, age)).toBe(layer) // round-trips
      seen.add(`${species}:${age}`)
    }
    expect(seen.size).toBe(IMPOSTOR_LAYER_COUNT) // no collisions
  })

  test('unknown species/age → -1', () => {
    expect(impostor_layer('not_a_species', 'mature')).toBe(-1)
    expect(impostor_layer(SPECIES_KEYS[0], 'ancienthood')).toBe(-1)
  })
})

describe('impostor stride (§3.6 world-anchored, doubling per level → coarse grids ⊂ finer)', () => {
  test('doubles per level from the base', () => {
    expect(impostor_stride(1)).toBe(IMPOSTOR_BASE_STRIDE)
    expect(impostor_stride(2)).toBe(IMPOSTOR_BASE_STRIDE * 2)
    expect(impostor_stride(3)).toBe(IMPOSTOR_BASE_STRIDE * 4)
  })
  test('a coarser level tests a strict SUBSET of a finer level’s columns', () => {
    // Every mult-of-stride(2) column is also a mult-of-stride(1) column ⇒ during L2→L1 refinement the
    // shared trees sit at identical positions (cross-fade in place, never a double-tree).
    const s1 = impostor_stride(1)
    const s2 = impostor_stride(2)
    expect(s2 % s1).toBe(0)
  })
})

describe('derive_section_trees', () => {
  test('level > IMPOSTOR_MAX_LEVEL yields no impostors (horizon band is the hazed far shell)', () => {
    const ctx = create_gen_context(PROCTREES_ON)
    const out = derive_section_trees(ctx, { level: IMPOSTOR_MAX_LEVEL + 1, origin_x: 0, origin_z: 0, span: 512 })
    expect(out.count).toBe(0)
  })

  test('?proctrees OFF ⇒ zero impostors (procedural OFF ⇒ no proc trees ⇒ no far-tree impostors)', () => {
    const ctx = create_gen_context(PROCTREES_OFF) // procedural:false (the ?proctrees=0 escape)
    let total = 0
    for (let sz = -2; sz < 2; sz += 1)
      for (let sx = -2; sx < 2; sx += 1)
        total += derive_section_trees(ctx, { level: 2, origin_x: sx * 128, origin_z: sz * 128, span: 128 }).count
    expect(total).toBe(0)
  })

  test('deterministic: identical (ctx, footprint) ⇒ byte-identical instance buffer', () => {
    const ctx = create_gen_context(PROCTREES_ON)
    const fp = { level: 2, origin_x: -128, origin_z: -128, span: 128 }
    const a = derive_section_trees(ctx, fp)
    const b = derive_section_trees(create_gen_context(PROCTREES_ON), fp)
    expect(a.count).toBe(b.count)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })
})

describe('SEAM AGREEMENT — far impostor == near placement (§3.6, AMENDED heap-OOM fix 2026-07-11)', () => {
  // The far shell no longer calls resolve_placement_at (that synthesizes every tree → the far-worker OOM);
  // it MIRRORS the procedural-tree decision WITHOUT synthesizing, and takes size + base_y from the canonical
  // (species,age) tree. THE AMENDED CONTRACT: POSITION (wx,wz) + SPECIES×AGE (layer) are EXACT; SIZE + BASE_Y
  // are canonical-approximate (sub-pixel at the 224 m+ impostor band). These tests ARE that contract — and
  // BIDIRECTIONAL PARITY below is the mechanical gate that FAILS if the mirror drifts from the decorator.
  const ctx = create_gen_context(PROCTREES_ON)
  const seed = /** @type {*} */ (ctx).seeds.decorators
  /** @type {{ wx:number, base_y:number, wz:number, w:number, h:number, layer:number, level:number }[]} */
  const far = []
  for (const level of [1, 2]) {
    const span = 32 * (1 << level)
    for (let sz = -3; sz < 3; sz += 1)
      for (let sx = -3; sx < 3; sx += 1) {
        const out = derive_section_trees(ctx, { level, origin_x: sx * span, origin_z: sz * span, span })
        for (let i = 0; i < out.count; i += 1) {
          const o = i * IMPOSTOR_FLOATS_PER_TREE
          far.push({
            wx: out.data[o],
            base_y: out.data[o + 1],
            wz: out.data[o + 2],
            w: out.data[o + 3],
            h: out.data[o + 4],
            layer: out.data[o + 5],
            level,
          })
        }
      }
  }

  test('the forested band actually yields impostors (the pipeline finds trees)', () => {
    expect(far.length).toBeGreaterThan(0)
  })

  test('POSITION + SPECIES×AGE are EXACT — every far impostor is the SAME procedural tree the near ring grows', () => {
    for (const t of far) {
      // (a) on the level’s world-anchored stride grid
      const stride = impostor_stride(t.level)
      expect(((t.wx % stride) + stride) % stride).toBe(0)
      expect(((t.wz % stride) + stride) % stride).toBe(0)
      // (b) the near ring’s OWN placement fn grows a procedural tree at this exact column…
      const near = resolve_placement_at(ctx, t.wx, t.wz, seed)
      expect(near).not.toBeNull()
      const colon = /** @type {*} */ (near).schematic.name.indexOf(':')
      expect(colon).toBeGreaterThanOrEqual(0) // procedural (species:age), not a legacy schematic
      // (c) …of the SAME species×age ⇒ the SAME atlas layer (EXACT — the load-bearing seam parity)
      const nm = /** @type {*} */ (near).schematic.name
      expect(impostor_layer(nm.slice(0, colon), nm.slice(colon + 1))).toBe(t.layer)
    }
  })

  test('SIZE is the CANONICAL (species,age) card size (the same tree the atlas card bakes from)', () => {
    for (const t of far) {
      const s = canonical_impostor_schematic(t.layer)
      expect(t.w).toBe(Math.max(s.size[0], s.size[2]))
      expect(t.h).toBe(s.size[1])
    }
  })

  test('BASE_Y approximates the near grounded anchor within a few blocks (canonical-footprint grounding)', () => {
    // base_y reproduces grounded_placement (min surface over the base footprint − 1) with the CANONICAL
    // footprint — exact wherever the instance's base spread matches it, else off by a per-instance shape
    // jitter. EXACT base_y needs the per-instance schematic = the synthesis this fix removes; a few blocks
    // is sub-pixel at 224 m+. BASE_Y_TOL bounds that jitter (observed max 7 in this region).
    const BASE_Y_TOL = 16
    let exact = 0
    for (const t of far) {
      const near = resolve_placement_at(ctx, t.wx, t.wz, seed)
      const d = Math.abs(t.base_y - /** @type {*} */ (near).surface_y)
      expect(d).toBeLessThanOrEqual(BASE_Y_TOL)
      if (d === 0) exact += 1
    }
    expect(exact / far.length).toBeGreaterThan(0.8) // the approximation is TIGHT (most exact), not loose
  })

  test('BIDIRECTIONAL PARITY — the mirror agrees with resolve_placement_at column-for-column (0 mismatches)', () => {
    // THE MECHANICAL GATE for the copied decision (far_trees_gen mirrors resolve_placement_at's proc-tree
    // branch instead of calling it). Sweep every L1 stride column in a region: the far derivation grows a
    // tree of layer L there IFF the decorator grows a procedural tree of the same layer. Any drift in the
    // copied salts/gates/roster/age here fails this — catching it before it pops/doubles a tree at the seam.
    const stride = impostor_stride(1)
    const span = 32 * 2 // L1 span (64 m)
    /** @type {Map<string, number>} far column → layer */
    const far_map = new Map()
    for (let sz = -2; sz < 2; sz += 1)
      for (let sx = -2; sx < 2; sx += 1) {
        const out = derive_section_trees(ctx, { level: 1, origin_x: sx * span, origin_z: sz * span, span })
        for (let i = 0; i < out.count; i += 1) {
          const o = i * IMPOSTOR_FLOATS_PER_TREE
          far_map.set(`${out.data[o]},${out.data[o + 2]}`, out.data[o + 5])
        }
      }
    let checked = 0
    let mismatches = 0
    for (let wz = -2 * span; wz < 2 * span; wz += stride)
      for (let wx = -2 * span; wx < 2 * span; wx += stride) {
        checked += 1
        const near = resolve_placement_at(ctx, wx, wz, seed)
        let near_layer = -1
        if (near) {
          const nm = /** @type {*} */ (near).schematic.name
          const c = nm.indexOf(':')
          if (c >= 0) near_layer = impostor_layer(nm.slice(0, c), nm.slice(c + 1)) // -1 if not a roster species
        }
        const far_layer = far_map.has(`${wx},${wz}`) ? /** @type {number} */ (far_map.get(`${wx},${wz}`)) : -1
        if (near_layer !== far_layer) mismatches += 1
      }
    expect(checked).toBeGreaterThan(1000) // the sweep actually ran over the region
    expect(mismatches).toBe(0)
  })

  test('LIVE-PATH PARITY — the ?baketrees=0 escape (per-column synthesis) still agrees at the seam', () => {
    // The baked default routes far ages through the variant mirror; the LIVE escape must keep using the
    // per-column age stream. One L1 region suffices — the gates upstream of age are shared with the sweep.
    const live_ctx = create_gen_context(PROCTREES_LIVE)
    const live_seed = /** @type {*} */ (live_ctx).seeds.decorators
    const span = 32 * 2
    const out = derive_section_trees(live_ctx, { level: 1, origin_x: 0, origin_z: -span, span })
    expect(out.count).toBeGreaterThan(0) // the region is forested (same grove band as the sweep)
    for (let i = 0; i < out.count; i += 1) {
      const o = i * IMPOSTOR_FLOATS_PER_TREE
      const near = resolve_placement_at(live_ctx, out.data[o], out.data[o + 2], live_seed)
      const nm = /** @type {*} */ (near).schematic.name
      const c = nm.indexOf(':')
      expect(impostor_layer(nm.slice(0, c), nm.slice(c + 1))).toBe(out.data[o + 5])
    }
  })
})
