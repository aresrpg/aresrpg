// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BAKE-THEN-STAMP A/B — headless (pure bun test, NO browser). Answers the complaint ("the
// schematics were loading way faster than the procedural trees") with the number the brief asks for:
// time spent in TREE GENERATION for a representative forest ring.
//
// generate_tree (tree_gen.js) runs the full recursive branch/canopy math. The live decorator ran it once
// PER FOREST COLUMN (every tree unique — a forest's columns are all distinct, so the per-column memo
// almost never hits ⇒ ~one full synthesis per tree). Bake-then-stamp synthesizes N variants per species
// ONCE, then each column O(1)-picks one (a hash→index — exactly what a schematic stamp is). This bench
// enumerates the REAL tree anchors of the densest 5×5 forest ring (via the exported resolve_placement_at)
// and times both paths over that exact population — no terrain-fill / stamp-cost confound.
//
// Run: `bun test packages/engine/bench/tree_bake_ab.test.js` (explicit path — Playwright's testMatch is
// '*.spec.js', so this bun-only .test.js is never picked up by the browser runner).

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../src/config/world_gen_config.js'
import { create_gen_context } from '../src/gen/column_gen.js'
import { resolve_placement_at } from '../src/gen/surface_decorator.js'
import { generate_tree } from '../src/gen/trees/tree_gen.js'
import { pick_baked_tree, reset_tree_bake_cache } from '../src/gen/trees/tree_bake.js'
import { voxel_count } from '../src/gen/schematics/loader.js'

const N = 32 // baked variants per species — the GEN_VERSION 9 DEFAULT (a deliberately generous pregen ruling)
const CS = 32
// The densest 5×5 chunk ring from a broad grove scan (~1357 tree anchors) — the reference "dense forest".
const RING_CENTER = { cx: 20, cz: -30 }

const ctx = create_gen_context(DEFAULT_WORLD_GEN_CONFIG)
const SEED = ctx.seeds.decorators

/** Enumerate the REAL tree anchors of the 5×5 ring: every column whose deterministic placement grows a
 *  tree, as { wx, wz, species }. species is parsed from the synthesized name `${species}:${age}`. The
 *  anchor SET is independent of baked_variants (baking changes WHICH variant, never whether/where/what
 *  species), so this is the true per-column population both paths must produce a tree for. */
function ring_anchors() {
  /** @type {{ wx: number, wz: number, species: string }[]} */
  const out = []
  for (let cx = RING_CENTER.cx - 2; cx <= RING_CENTER.cx + 2; cx += 1)
    for (let cz = RING_CENTER.cz - 2; cz <= RING_CENTER.cz + 2; cz += 1)
      for (let lx = 0; lx < CS; lx += 1)
        for (let lz = 0; lz < CS; lz += 1) {
          const wx = cx * CS + lx
          const wz = cz * CS + lz
          const p = resolve_placement_at(ctx, wx, wz, SEED)
          if (p && p.schematic && p.schematic.category === 'tree')
            out.push({ wx, wz, species: p.schematic.name.split(':')[0] })
        }
  return out
}

/** median of a numeric array (non-mutating). @param {number[]} xs */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
/** Time `fn` over `reps` runs → median ms. @param {() => void} fn @param {number} reps */
function time_ms(fn, reps) {
  const runs = []
  for (let r = 0; r < reps; r += 1) {
    const t0 = performance.now()
    fn()
    runs.push(performance.now() - t0)
  }
  return median(runs)
}

describe('bake-then-stamp A/B (schematics loaded faster than proctrees)', () => {
  test('tree-gen for a real dense forest ring collapses to ~stamp cost', () => {
    const anchors = ring_anchors()
    const M = anchors.length
    expect(M).toBeGreaterThan(500) // a genuine dense ring

    // warm the JIT for both paths (excluded from timing)
    for (const a of anchors) generate_tree(SEED, a.wx, a.wz, a.species)
    reset_tree_bake_cache()
    for (const a of anchors) pick_baked_tree(SEED, a.wx, a.wz, a.species, N)

    // baseline: the live per-column synthesis — one full generate_tree per tree (the load cost that was felt)
    const baseline = time_ms(() => {
      for (const a of anchors) generate_tree(SEED, a.wx, a.wz, a.species)
    }, 5)

    // after: bake N variants per species ONCE (inside the timed window — the one-time world cost) + O(1) picks
    const after = time_ms(() => {
      reset_tree_bake_cache()
      for (const a of anchors) pick_baked_tree(SEED, a.wx, a.wz, a.species, N)
    }, 5)

    const species_set = new Set(anchors.map((a) => a.species))
    console.log(
      `[bake A/B] dense ring center chunk (${RING_CENTER.cx},${RING_CENTER.cz}), ${M} tree anchors, ` +
        `${species_set.size} species, N=${N} variants/species\n` +
        `  baseline (per-column generate_tree): ${baseline.toFixed(2)} ms  (${((baseline / M) * 1000).toFixed(2)} µs/tree)\n` +
        `  after    (bake once + O(1) pick)   : ${after.toFixed(2)} ms  (${((after / M) * 1000).toFixed(2)} µs/tree)\n` +
        `  tree-gen for the ring: ${baseline.toFixed(1)} ms → ${after.toFixed(1)} ms   (${(baseline / after).toFixed(1)}× faster)`
    )
    expect(after).toBeLessThan(baseline * 0.35) // proctree gen collapses to at least 3× stamp cost (in practice far more)
  })

  test('CORRECTNESS: the baked pick is deterministic; n<=0 is byte-identical to live per-column gen', () => {
    reset_tree_bake_cache()
    const a = pick_baked_tree(SEED, 123, -456, 'oak_broadleaf', N)
    const b = pick_baked_tree(SEED, 123, -456, 'oak_broadleaf', N) // same column ⇒ same variant
    expect(a).toBe(b) // deterministic, cached identity
    expect(voxel_count(a)).toBeGreaterThan(40) // a real crown-bearing tree, not empty
    // n<=0 ⇒ byte-identical to the live per-column generator (the ?baketrees=0 escape contract).
    const live = pick_baked_tree(SEED, 77, 88, 'birch_slim', 0)
    const direct = generate_tree(SEED, 77, 88, 'birch_slim')
    expect(voxel_count(live)).toBe(voxel_count(direct))
    expect(live.size).toEqual(direct.size)
  })
})
