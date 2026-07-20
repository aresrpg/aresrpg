// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHERABLE sprite tests (ENGINE_AAA_PLAN §5 lane A3). The core deliverable is the ΔE PERCEPTUAL-SPACING
// guard: each family's 11-step level ramp must keep every sibling tellable apart at gather distance (64px
// sprite AND 32px icon). Plus: the no-white-halo emission ceiling, the 33+43 count/append-only structure,
// and a bake-time legibility check (every sprite renders + carries its identity colour). ΔE uses full
// sRGB→Lab + CIE76 (test-only ⇒ the §3.7 no-trig gen law does not apply here).

import { test, expect, describe } from 'bun:test'

import { get_block_by_name } from '../config/block_registry.js'

import { bake_block_textures } from './texture_baker.js'
import {
  GATHER_RAMPS,
  GATHER_RECIPES,
  GATHER_BASE_IDS,
  GATHER_RARE_EMISSION,
  GATHER_EMISSION_LUMA_CEILING,
  luma01,
} from './texture_recipes_gather.js'

// ── sRGB (0-255) → CIE-Lab (D65) → CIE76 ΔE ─────────────────────────────────────────────────────────────
/** @param {number} c 0-255 @returns {number} linear 0-1 */
const srgb_lin = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
/** @param {number[]} rgb 0-255 @returns {[number,number,number]} Lab */
function to_lab([r, g, b]) {
  const rl = srgb_lin(r),
    gl = srgb_lin(g),
    bl = srgb_lin(b)
  const X = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047
  const Y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722
  const Z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883
  const f = (/** @type {number} */ t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X),
    fy = f(Y),
    fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
/** CIE76 ΔE between two 0-255 rgb. @param {number[]} a @param {number[]} b @returns {number} */
function delta_e(a, b) {
  const la = to_lab(a),
    lb = to_lab(b)
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

// PASS bar: siblings distinguishable at gather distance. ΔE≈12 already reads as "clearly a different
// colour"; we hold the ramps to ≥14 so the read survives the 32px icon + biome re-tint (FIVE-WORLDS) with
// margin. (Tuned once from the printed min-ΔE below; a regression that collapses two siblings fails loudly.)
const MIN_DELTA_E = 14

describe('ΔE perceptual spacing — 11-step ramps stay tellable', () => {
  for (const [family, ramp] of Object.entries(GATHER_RAMPS)) {
    test(`${family}: all 11 siblings ≥ ${MIN_DELTA_E} ΔE apart`, () => {
      expect(ramp.length).toBe(11)
      let min = Infinity
      let closest = ''
      for (let i = 0; i < ramp.length; i += 1) {
        for (let j = i + 1; j < ramp.length; j += 1) {
          const d = delta_e(ramp[i].rgb, ramp[j].rgb)
          if (d < min) {
            min = d
            closest = `${ramp[i].id}↔${ramp[j].id}`
          }
        }
      }
      console.log(`${family.padEnd(6)} min ΔE = ${min.toFixed(1)} (closest ${closest})`)
      expect(min).toBeGreaterThanOrEqual(MIN_DELTA_E)
    })
  }

  test('ramps are ordered by level 1→100 (the level→colour contract)', () => {
    for (const ramp of Object.values(GATHER_RAMPS)) {
      const levels = ramp.map((e) => e.level)
      expect(levels).toEqual([...levels].sort((a, b) => a - b))
      expect(levels).toEqual([1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    }
  })
})

describe('no-white-halo emission ceiling (§5.1)', () => {
  test('every rare self-glow emission luma ≤ ceiling (below the 2.05 bloom threshold at MEDIUM)', () => {
    let max = 0
    let brightest = ''
    for (const [id, emis] of Object.entries(GATHER_RARE_EMISSION)) {
      const l = luma01(emis)
      if (l > max) {
        max = l
        brightest = id
      }
      expect(l).toBeLessThanOrEqual(GATHER_EMISSION_LUMA_CEILING + 1e-6)
    }
    console.log(
      `brightest rare emission: ${brightest} luma=${max.toFixed(3)} (ceiling ${GATHER_EMISSION_LUMA_CEILING})`
    )
    // The golden rare-gather is the plan's named ceiling reference — it must actually reach it (a real glow,
    // not a black no-op), so the ceiling is a live cap and not dead code.
    expect(luma01(GATHER_RARE_EMISSION.golden_wheat)).toBeGreaterThan(GATHER_EMISSION_LUMA_CEILING - 0.02)
    expect(max).toBeLessThanOrEqual(GATHER_EMISSION_LUMA_CEILING + 1e-6)
  })

  test('all 43 rares carry a non-zero emission (rare tiers glow — P8)', () => {
    expect(Object.keys(GATHER_RARE_EMISSION).length).toBe(43)
    for (const emis of Object.values(GATHER_RARE_EMISSION)) expect(emis[0] + emis[1] + emis[2]).toBeGreaterThan(0)
  })
})

describe('structure — 33 base + 43 rare, names join the seed ids', () => {
  test('76 recipes; 33 base register cross blocks, 43 rare are block-less atlas layers', () => {
    expect(GATHER_RECIPES.length).toBe(76)
    expect(GATHER_BASE_IDS.length).toBe(33)
    const base = GATHER_RECIPES.filter((r) => r.blocks === undefined)
    const rare = GATHER_RECIPES.filter((r) => Array.isArray(r.blocks) && r.blocks.length === 0)
    expect(base.length).toBe(33)
    expect(rare.length).toBe(43)
    // Every base name resolves to a registered foliage cross block (the auto-wire join).
    for (const id of GATHER_BASE_IDS) {
      const blk = get_block_by_name(id)
      expect(blk?.class).toBe('foliage')
      expect(blk?.shape).toBe('cross')
    }
    // Rare names never collide with a block (they are node-state glow, not voxels).
    for (const r of rare) expect(get_block_by_name(r.name)).toBeUndefined()
  })

  test('base cross-block ids are the contiguous append 62-94 (fence, never renumbered)', () => {
    const ids = GATHER_BASE_IDS.map((id) => /** @type {number} */ (get_block_by_name(id)?.id)).sort((a, b) => a - b)
    expect(ids[0]).toBe(62)
    expect(ids[ids.length - 1]).toBe(94)
    expect(new Set(ids).size).toBe(33)
  })
})

describe('bake legibility — every sprite renders and carries its identity colour', () => {
  const SIZE = 64
  const res = bake_block_textures({ size: SIZE, seed: 4242 })
  const stride = SIZE * SIZE * 4

  /** opaque-texel stats for a named layer: coverage + min ΔE of any opaque texel to a target colour. */
  const layer_stats = (/** @type {string} */ name, /** @type {number[]} */ target) => {
    const base = /** @type {number} */ (res.layer_of_name.get(name)) * stride
    let opaque = 0,
      min_de = Infinity
    for (let p = 0; p < SIZE * SIZE; p += 1) {
      const i = base + p * 4
      if (res.albedo[i + 3] !== 255) continue
      opaque += 1
      const d = delta_e([res.albedo[i], res.albedo[i + 1], res.albedo[i + 2]], target)
      if (d < min_de) min_de = d
    }
    return { coverage: opaque / (SIZE * SIZE), min_de }
  }

  test('all 76 gather recipes appended AFTER the A1 atlas (pure append, no insertion)', () => {
    for (const r of GATHER_RECIPES) {
      const layer = res.layer_of_name.get(r.name)
      expect(typeof layer).toBe('number')
      expect(/** @type {number} */ (layer)).toBeGreaterThanOrEqual(263) // pre-A3 end (210 pre-A1 + 53 A1)
    }
  })

  test('each base sprite renders (sane alpha coverage) and contains its ramp identity colour', () => {
    const rows = []
    for (const [family, ramp] of Object.entries(GATHER_RAMPS)) {
      for (const e of ramp) {
        const { coverage, min_de } = layer_stats(e.id, e.rgb)
        rows.push({ id: `${family}/${e.id}`, coverage, min_de })
        // renders SOMETHING but is not a full opaque block (it's a sprite): 2%..75% opaque.
        expect(coverage).toBeGreaterThan(0.02)
        expect(coverage).toBeLessThan(0.75)
      }
    }
    // The identity colour is PRESENT under shading/tint (op paints the ramp hue, not a stand-in). Bound 18
    // tolerates the per-blade tint (0.86-1.14) + dark→light lerps while still catching a wrong-colour sprite
    // (a mislabeled recipe reads ΔE ≳ 30). Print the worst offenders so a regression is diagnosable.
    rows.sort((a, b) => b.min_de - a.min_de)
    console.log(
      'worst identity-ΔE: ' +
        rows
          .slice(0, 6)
          .map((r) => `${r.id}=${r.min_de.toFixed(1)}`)
          .join(' ')
    )
    for (const r of rows) expect(r.min_de).toBeLessThan(18)
  })

  test('legible at 32px icon res too (every gather sprite still renders opaque texels)', () => {
    const ico = bake_block_textures({ size: 32, seed: 4242 })
    const istride = 32 * 32 * 4
    for (const r of GATHER_RECIPES) {
      const b = /** @type {number} */ (ico.layer_of_name.get(r.name)) * istride
      let opaque = 0
      for (let p = 0; p < 32 * 32; p += 1) if (ico.albedo[b + p * 4 + 3] === 255) opaque += 1
      expect(opaque).toBeGreaterThan(6) // not an empty icon
    }
  })
})
