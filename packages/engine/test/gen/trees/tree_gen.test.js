// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROCEDURAL TREE GENERATOR CORE — tests (ENGINE AAA PLAN §8 lane A2 proof bar). Covers:
//   (1) DETERMINISM (§3.2/§3.7) — byte-identical output for identical args, call-order independence
//       (pure, no module state ⇒ worker/main parity), and a FROZEN golden hash over 320 trees.
//   (2) ResolvedSchematic CONTRACT (loader.js:48-58) — exact shape, and size[1] == max(dy)+1 (the
//       decorator's vertical span early-out reads it; understating bald-tops upper chunks).
//   (3) BUDGETS (§3.3) — per-species voxel-count floor/cap + reach cap, and the global halo reach ≤ 14.
//   (4) ROSTER / scale identity (§3.4) — 10 species, pine_cathedral the 30-62 giant, age morph.
// Pure integer generation → no GPU, no three, no worker.

import { test, expect, describe } from 'bun:test'

import { get_block_by_id, AIR_BLOCK_ID } from '../../../src/config/block_registry.js'
import { for_each_voxel, voxel_count } from '../../../src/gen/schematics/loader.js'
import { generate_tree, build_tree } from '../../../src/gen/trees/tree_gen.js'
import { SPECIES, SPECIES_KEYS } from '../../../src/gen/trees/species.js'

/** @type {Array<'young'|'mature'|'ancient'>} */
const AGES = ['young', 'mature', 'ancient']
const VALID_MODES = new Set(['overwrite', 'air_only', 'replace_foliage'])

// ── Golden corpus (frozen byte-exact hash) ──────────────────────────────────────────────────────
const SEEDS = [1, 2, 7, 42, 1337, 0xbeef, 0x1a2b3c, 9001]
const COORDS = [
  [0, 0],
  [160, -160],
  [-2048, 4096],
  [123, -457],
]
/** Byte-exact hash of 320 canonically-serialized trees. If gen math moves, this MUST be re-blessed
 *  intentionally (a decorated-world fork, §3.5 GEN_VERSION bump) — never silently. Re-blessed 2026-07-13:
 *  palm fronds grow as LEAF (green frond blades) instead of 'twig' (dead_branch cross cards) — a palm has
 *  no branch skeleton so ~53% of frond twig-cards floated detached ("flying small branches"); only
 *  palm_curve output moves (its dead_branch id → palm_leaves id, same cells). Trees are NOT in the
 *  world-identity hash (surface_decorator.js: decoration ≠ GEN_VERSION), so no version bump. */
const GOLDEN = 3342579248

/** @param {string} str @returns {number} FNV-1a uint32 */
function fnv(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i += 1) {
    h = (h ^ str.charCodeAt(i)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
/** Canonical string of a schematic (order-stable — voxels are pre-sorted by the generator). Serialized
 *  via for_each_voxel with the EXACT pre-compact field order/format, so the FROZEN golden hash is
 *  representation-independent: the P0 compact-carrier change (typed arrays) must not move it.
 *  @param {import('../../../src/gen/schematics/loader.js').ResolvedSchematic} t */
function schematic_str(t) {
  /** @type {string[]} */
  const parts = []
  for_each_voxel(t, (dx, dy, dz, e) => {
    parts.push(`${dx},${dy},${dz},${e.block_id},${e.solid ? 1 : 0},${e.mode}`)
  })
  return (
    t.name +
    '|' +
    t.size.join(',') +
    '|' +
    t.anchor.join(',') +
    '|' +
    t.reach +
    '|' +
    t.water_anchor +
    '|' +
    parts.join(';')
  )
}
function golden() {
  let g = 2166136261 >>> 0
  for (const key of SPECIES_KEYS)
    for (const seed of SEEDS)
      for (const [wx, wz] of COORDS) {
        g = (g ^ fnv(schematic_str(generate_tree(seed, wx, wz, key)))) >>> 0
        g = Math.imul(g, 16777619) >>> 0
      }
  return g >>> 0
}

describe('determinism (§3.2/§3.7 integer law)', () => {
  test('same (seed,wx,wz,species) ⇒ byte-identical schematic', () => {
    for (const key of SPECIES_KEYS) {
      const a = generate_tree(777, 40, -90, key)
      const b = generate_tree(777, 40, -90, key)
      expect(schematic_str(a)).toBe(schematic_str(b))
    }
  })

  test('call ORDER independent (pure — no module mutable state ⇒ worker/main parity)', () => {
    // forward pass
    const fwd = SPECIES_KEYS.map((k) => schematic_str(generate_tree(55, 12, 34, k)))
    // reverse pass (different interleaving of the shared codepath)
    const rev = [...SPECIES_KEYS].reverse().map((k) => schematic_str(generate_tree(55, 12, 34, k)))
    rev.reverse()
    expect(rev).toEqual(fwd)
  })

  test('golden byte-exact hash over 320 trees is FROZEN', () => {
    expect(golden()).toBe(GOLDEN)
  })

  test('golden is stable across recomputation (no hidden nondeterminism)', () => {
    expect(golden()).toBe(golden())
  })

  test('no transcendental drift — every coord is a finite integer', () => {
    for (const key of SPECIES_KEYS)
      for (const seed of [3, 88, 4096]) {
        const t = generate_tree(seed, seed * 7, -seed * 3, key)
        for_each_voxel(t, (dx, dy, dz) => {
          expect(Number.isInteger(dx) && Number.isInteger(dy) && Number.isInteger(dz)).toBe(true)
        })
      }
  })
})

describe('ResolvedSchematic contract (loader.js shape — placed by the existing stamper unchanged)', () => {
  test('shape: name/category/size[3]/anchor[3]/compact/reach/water_anchor (P0: flat typed-array carrier)', () => {
    const t = generate_tree(9, 100, 100, 'oak_broadleaf')
    expect(typeof t.name).toBe('string')
    expect(t.category).toBe('tree')
    expect(t.size).toHaveLength(3)
    expect(t.anchor).toHaveLength(3)
    // P0 balloon fix: synthesized trees carry the COMPACT carrier, never an object-voxel array (the
    // ~192 KB/tree object form was the gen-worker OOM driver); consumers go through for_each_voxel.
    expect(t.voxels).toBeUndefined()
    const { compact } = /** @type {{ compact: import('../../../src/gen/schematics/loader.js').CompactVoxels }} */ (t)
    expect(compact.pos).toBeInstanceOf(Int16Array)
    expect(compact.pal).toBeInstanceOf(Uint8Array)
    expect(compact.pos.length).toBe(compact.pal.length * 3)
    expect(Array.isArray(compact.palette)).toBe(true)
    expect(compact.palette.length).toBeGreaterThan(0)
    expect(compact.palette.length).toBeLessThanOrEqual(4) // bark/leaf/twig/cap
    for (const e of compact.palette) {
      expect(e).toHaveProperty('block_id')
      expect(e).toHaveProperty('solid')
      expect(e).toHaveProperty('mode')
    }
    expect(typeof t.reach).toBe('number')
    expect(t.water_anchor).toBe(false)
    /** @type {{dx:number, dy:number, dz:number, block_id:number, solid:boolean, mode:import('../../../src/gen/schematics/loader.js').PlacementMode}|null} */
    let first = null
    for_each_voxel(t, (dx, dy, dz, e) => {
      if (first === null) first = { dx, dy, dz, ...e }
    })
    expect(first).not.toBeNull()
  })

  test('size[1] === max(dy)+1 — the decorator vertical span early-out (bald-top guard)', () => {
    for (const key of SPECIES_KEYS)
      for (const seed of [11, 222, 3333]) {
        const t = generate_tree(seed, 5, 5, key)
        let maxdy = 0
        let maxAbs = 0
        for_each_voxel(t, (dx, dy, dz) => {
          if (dy > maxdy) maxdy = dy
          const r = Math.max(Math.abs(dx), Math.abs(dz))
          if (r > maxAbs) maxAbs = r
          expect(dy).toBeGreaterThanOrEqual(0) // base flush at surface_y; nothing below anchor
        })
        expect(t.size[1]).toBe(maxdy + 1)
        expect(t.reach).toBe(maxAbs) // reach == max horizontal |offset|
      }
  })

  test('voxel modes valid + block_ids resolve to a real non-air block', () => {
    for (const key of SPECIES_KEYS) {
      const t = generate_tree(4, 4, 4, key)
      for_each_voxel(t, (_dx, _dy, _dz, e) => {
        expect(VALID_MODES.has(e.mode)).toBe(true)
        expect(e.block_id).not.toBe(AIR_BLOCK_ID)
        const def = get_block_by_id(e.block_id)
        expect(def).toBeDefined()
        // solid flag mirrors the loader: shape 'cross' ⇒ non-occupying foliage (twig cards)
        expect(e.solid).toBe(def?.shape !== 'cross')
      })
    }
  })

  test('no duplicate cells (deduped) and canonical (dy,dz,dx) order', () => {
    for (const key of SPECIES_KEYS) {
      const t = generate_tree(202, -33, 77, key)
      const seen = new Set()
      /** @type {{dx:number, dy:number, dz:number}|null} */
      let prev = null
      for_each_voxel(t, (dx, dy, dz) => {
        const k = dx + ',' + dy + ',' + dz
        expect(seen.has(k)).toBe(false)
        seen.add(k)
        if (prev) {
          const ord = prev.dy - dy || prev.dz - dz || prev.dx - dx
          expect(ord).toBeLessThanOrEqual(0)
        }
        prev = { dx, dy, dz }
      })
    }
  })
})

describe('voxel-count + reach budgets (§3.3 per-species caps; halo governance §3.5)', () => {
  const N = 64
  let globalReach = 0
  for (const key of SPECIES_KEYS) {
    test(`${key}: voxels in [floor,cap] and reach ≤ reach_cap over ${N}×3 seeds`, () => {
      const p = SPECIES[key]
      for (const age of AGES)
        for (let s = 0; s < N; s += 1) {
          // build_tree forces the age so every band is exercised (production age is hash-derived)
          const t = build_tree(
            key,
            (() => {
              let x = (s * 2654435761 + 1013904223) >>> 0
              return () => {
                x = (x + 0x9e3779b9) >>> 0
                let z = x
                z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
                z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
                return (z ^ (z >>> 15)) >>> 0
              }
            })(),
            age
          )
          expect(voxel_count(t)).toBeGreaterThanOrEqual(p.voxel_floor)
          expect(voxel_count(t)).toBeLessThanOrEqual(p.voxel_cap)
          expect(t.reach).toBeLessThanOrEqual(p.reach_cap)
          if (t.reach > globalReach) globalReach = t.reach
        }
    })
  }

  test('global max reach ≤ 14 (giants stay narrow — no halo cost regression vs schematics ~21)', () => {
    let g = 0
    for (const key of SPECIES_KEYS)
      for (const age of AGES)
        for (let s = 0; s < 48; s += 1) {
          const t = generate_tree(s * 131 + 7, s * 17, -s * 29, key)
          void age
          if (t.reach > g) g = t.reach
        }
    expect(g).toBeLessThanOrEqual(14)
  })
})

describe('species roster + scale identity (§3.4)', () => {
  test('exactly the 10-species baseline roster', () => {
    expect(SPECIES_KEYS).toHaveLength(10)
    expect(SPECIES_KEYS).toContain('pine_cathedral')
  })

  test('pine_cathedral is the GIANT: mature H spans the 30-62 band, reach ≤ 12 (HARD requirement)', () => {
    let minH = Infinity
    let maxH = 0
    for (let s = 0; s < 96; s += 1) {
      let x = (s * 40503 + 1) >>> 0
      const rng = () => {
        x = (x + 0x9e3779b9) >>> 0
        let z = x
        z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
        z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
        return (z ^ (z >>> 15)) >>> 0
      }
      const t = build_tree('pine_cathedral', rng, 'mature')
      minH = Math.min(minH, t.size[1])
      maxH = Math.max(maxH, t.size[1])
      expect(t.reach).toBeLessThanOrEqual(12)
    }
    expect(minH).toBeGreaterThanOrEqual(30) // never a stubby "cathedral" pine
    expect(maxH).toBeGreaterThanOrEqual(58) // colossal 60-block pines DO occur (cathedral scale)
  })

  test('every species yields a substantial, crown-bearing tree (no bald output)', () => {
    for (const key of SPECIES_KEYS) {
      const t = generate_tree(2024, 8, -8, key)
      expect(voxel_count(t)).toBeGreaterThan(40)
      expect(t.size[1]).toBeGreaterThan(3)
    }
  })

  test('age morph shrinks silhouette: mean young height < mean mature height', () => {
    for (const key of SPECIES_KEYS) {
      let younT = 0
      let matT = 0
      for (let s = 0; s < 40; s += 1) {
        const mk = (/** @type {number} */ seed) => {
          let x = seed >>> 0
          return () => {
            x = (x + 0x9e3779b9) >>> 0
            let z = x
            z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
            z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
            return (z ^ (z >>> 15)) >>> 0
          }
        }
        younT += build_tree(key, mk((s * 2246822519 + 1) >>> 0), 'young').size[1]
        matT += build_tree(key, mk((s * 2246822519 + 1) >>> 0), 'mature').size[1]
      }
      expect(younT).toBeLessThan(matT)
    }
  })

  test('unknown species throws (typo fails loud, never places the wrong tree)', () => {
    expect(() => generate_tree(1, 1, 1, 'not_a_tree')).toThrow()
  })
})
