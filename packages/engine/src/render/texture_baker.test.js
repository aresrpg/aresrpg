// Texture-baker tests: determinism (byte-identical across runs + seed sensitivity), atlas
// dimensions/mappings, alpha-clip vs opaque alpha invariants, the painterly grain bound, the three
// DataArrayTexture wiring, and a raw-RGBA preview dump (/tmp/baker_preview.rgba) for eyeball review.

import { writeFileSync } from 'node:fs'

import { test, expect, describe } from 'bun:test'
import * as THREE from 'three'

import { get_block_by_name } from '../config/block_registry.js'

import {
  bake_block_textures,
  build_data_array_texture,
  fit_layer_plan,
  GRAIN_MAX_AMPLITUDE,
  atlas_layer_count,
  MAX_ATLAS_LAYERS,
} from './texture_baker.js'
import { RECIPES } from './texture_recipes.js'

const SIZE = 64
const OPAQUE_NAMES = ['grass', 'dirt', 'stone', 'sand', 'log']
// D164: leaves are CUTOUT now (alpha lacework holes — sprite-cluster canopy), never opaque.
const CUTOUT_NAMES = ['leaves', 'leaves_conifer', 'leaves_dry']
const ALPHA_CLIP_NAMES = ['grass_tuft', 'flower_red', 'flower_yellow']

/**
 * @param {import('./texture_baker.js').BakeResult} res
 * @param {number} layer
 * @returns {Set<number>} distinct alpha byte values in that layer
 */
function alpha_values(res, layer) {
  const stride = res.size * res.size * 4
  const base = layer * stride
  const set = new Set()
  for (let p = 0; p < res.size * res.size; p += 1) set.add(res.albedo[base + p * 4 + 3])
  return set
}

/**
 * FNV-1a over the whole atlas — a compact stand-in for "byte-identical".
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function fnv1a(bytes) {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i += 1) {
    h = (h ^ bytes[i]) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

describe('determinism', () => {
  test('same seed ⇒ byte-identical atlas', () => {
    const a = bake_block_textures({ size: SIZE, seed: 1337 })
    const b = bake_block_textures({ size: SIZE, seed: 1337 })
    expect(a.albedo.length).toBe(b.albedo.length)
    expect(fnv1a(a.albedo)).toBe(fnv1a(b.albedo))
    // Full byte compare, not just the hash.
    let identical = true
    for (let i = 0; i < a.albedo.length; i += 1) {
      if (a.albedo[i] !== b.albedo[i]) {
        identical = false
        break
      }
    }
    expect(identical).toBe(true)
  })

  test('different seed ⇒ different atlas', () => {
    const a = bake_block_textures({ size: SIZE, seed: 1 })
    const b = bake_block_textures({ size: SIZE, seed: 2 })
    expect(fnv1a(a.albedo)).not.toBe(fnv1a(b.albedo))
  })

  test('variant layers of one recipe are byte-stable across runs AND decorrelated from each other', () => {
    // Same seed ⇒ every variant layer is byte-identical (fix #3 must not break determinism).
    const a = bake_block_textures({ size: SIZE, seed: 1337 })
    const b = bake_block_textures({ size: SIZE, seed: 1337 })
    const stride = SIZE * SIZE * 4
    const base = /** @type {number} */ (a.layer_of_name.get('grass'))
    const count = /** @type {number} */ (a.variants_of_name.get('grass'))
    expect(count).toBeGreaterThan(1)
    /** @param {import('./texture_baker.js').BakeResult} r @param {number} layer */
    const layer_hash = (r, layer) => fnv1a(r.albedo.subarray(layer * stride, (layer + 1) * stride))
    for (let v = 0; v < count; v += 1) expect(layer_hash(a, base + v)).toBe(layer_hash(b, base + v))
    // …and the variants genuinely differ (decorrelated grain), else the feature is a no-op quilt.
    const hashes = new Set()
    for (let v = 0; v < count; v += 1) hashes.add(layer_hash(a, base + v))
    expect(hashes.size).toBe(count)
  })
})

describe('dimensions & mappings', () => {
  const res = bake_block_textures({ size: SIZE, seed: 7 })

  test('atlas length matches layers × size² × 4', () => {
    expect(res.size).toBe(SIZE)
    // With per-recipe variants (fix #3), total layers = Σ variant counts ≥ recipe count. layer_of_name
    // holds ONE base-layer entry per recipe, so it's the recipe count, not the layer count.
    expect(res.layers).toBe(res.layer_of_name.size + [...res.variants_of_name.values()].reduce((a, c) => a + c - 1, 0))
    expect(res.layers).toBeGreaterThanOrEqual(res.layer_of_name.size)
    expect(res.albedo).toBeInstanceOf(Uint8Array)
    expect(res.albedo.length).toBe(res.layers * SIZE * SIZE * 4)
  })

  test('all v1 recipes present in layer_of_name (incl. grass_side); variant counts sane', () => {
    // D159/ENG-22: snow, cave_stone, mossy_stone are now baked families (were flat map_color fallbacks).
    for (const name of [
      ...OPAQUE_NAMES,
      ...CUTOUT_NAMES,
      'grass_side',
      'water',
      'snow',
      'cave_stone',
      'mossy_stone',
      ...ALPHA_CLIP_NAMES,
    ]) {
      expect(res.layer_of_name.has(name)).toBe(true)
    }
    // 19 recipes; variant-expanded to 108 layers. Base as before (grass_side ×4, dirt/sand/stone ×8 each,
    // log ×5, water ×1, flowers ×1) + leaves ×3 (D159: +1 for weathering variety) + grass_tuft ×6
    // + wave 15 (tall_grass ×6, reed ×2, fern ×5, flower_white/purple ×1) + D159 REALISM new families
    // snow/cave_stone/mossy_stone each ×8 (2 phase × 4 rot) = +24. [2026-07-12] connected ground
    // gradients: grass ×6 → ×24 (6 phase × 4 rot, +18): terrain_material.js now picks the phase via a
    // coherent world-XZ patch + the rotation via an independent per-block hash (terrain_texture_variant.js)
    // so patches read connected while tiles within one patch still decorrelate. Both asserted so drift
    // fails loudly.
    expect(res.layer_of_name.size).toBe(147) // +14 A1 tree recipes, +76 A3 gatherable recipes (33 base + 43 rare) — append-only
    expect(res.layers).toBe(357) // was 339; +18 grass rotation layers (6 phase × 4 rot, was 6 phase × 1)
    // Base layers are the FIRST of each variant block, so every recipe's variants occupy a contiguous
    // run [base, base+count) — assert no two recipes' runs collide.
    const spans = [...res.layer_of_name.entries()].map(([name, base]) => [
      base,
      base + (res.variants_of_name.get(name) ?? 1),
    ])
    spans.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i += 1) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1])
    // Per-family variant counts (phase × rotations). Grass-top now bakes 4 rotations too (2026-07-12 —
    // was phase-only: the old "isotropic ⇒ no rotation needed" reasoning held while variant pick was a
    // per-block uncorrelated hash, but a COHERENT per-patch phase pick needs the independent per-block
    // rotation to keep tiles within one patch from reading as one stamped repeat); dirt/sand/stone's 4
    // rotations still break tiled-floor ramp/clump alignment (the "stripe" front).
    expect(res.variants_of_name.get('grass')).toBe(24)
    expect(res.rotations_of_name.get('grass')).toBe(4)
    expect(res.variants_of_name.get('grass_side')).toBe(4)
    expect(res.variants_of_name.get('dirt')).toBe(8)
    expect(res.variants_of_name.get('sand')).toBe(8)
    expect(res.variants_of_name.get('stone')).toBe(8)
    expect(res.variants_of_name.get('log')).toBe(5)
  })

  test('every v1 recipe maps to its registry block id', () => {
    for (const name of [...OPAQUE_NAMES, 'water', ...ALPHA_CLIP_NAMES]) {
      const id = /** @type {number} */ (get_block_by_name(name)?.id)
      expect(typeof id).toBe('number')
      expect(res.layer_of.get(id)).toBe(/** @type {number} */ (res.layer_of_name.get(name)))
    }
    // Untextured registry blocks still fall back to flat map_color (no baked layer). D159 moved snow OUT
    // of this set (it now has a recipe); air/glowstone remain unbaked.
    for (const name of ['air', 'glowstone']) {
      const id = /** @type {number} */ (get_block_by_name(name)?.id)
      expect(res.layer_of.has(id)).toBe(false)
    }
    // D159/ENG-22: the new families map their registry block id → base layer (auto-wired via `blocks`).
    for (const name of ['snow', 'cave_stone', 'mossy_stone']) {
      const id = /** @type {number} */ (get_block_by_name(name)?.id)
      expect(res.layer_of.get(id)).toBe(/** @type {number} */ (res.layer_of_name.get(name)))
    }
  })
})

describe('device texture-array limit (GPUValidationError guard)', () => {
  test('atlas layer count stays within MAX_ATLAS_LAYERS (the requested WebGPU device limit)', () => {
    // core/renderer.js requests maxTextureArrayLayers = min(adapter max, MAX_ATLAS_LAYERS) at device
    // acquisition. If RECIPES grow past MAX_ATLAS_LAYERS the DataArrayTexture exceeds the limit we request
    // → GPUValidationError(depthOrArrayLayers) → BLACK world (the 2026-07-10 incident: 210→263→339 layers
    // silently blew the 256 default). This is the BUILD-TIME tripwire: fail HERE (bump MAX_ATLAS_LAYERS +
    // re-confirm target adapters provide it) instead of shipping a black screen.
    const layers = atlas_layer_count()
    console.log(`atlas layers: ${layers} / ceiling ${MAX_ATLAS_LAYERS} (WebGPU default limit is 256)`)
    expect(layers).toBeLessThanOrEqual(MAX_ATLAS_LAYERS)
    // The pure helper MUST equal the real baked layer count — they size the same atlas, from one source.
    expect(bake_block_textures({ size: SIZE, seed: 1 }).layers).toBe(layers)
    // We MUST be over the WebGPU default, else the renderer's raised-limit request is dead code and this
    // whole guard is pointless — this documents WHY the device-limit request has to exist.
    expect(layers).toBeGreaterThan(256)
  })
})

describe('spec-minimum adapter fallback (256-layer budget — no black world on mobile)', () => {
  // The WebGPU/WebGL2 spec MINIMUM for maxTextureArrayLayers is 256; the natural atlas is 357. A
  // spec-minimum adapter (mobile) passes max_layers=256 to bake_block_textures ⇒ fit_layer_plan bakes a
  // REDUCED atlas that fits. This is the release-blocking guard: on those devices the world MUST still
  // render every block's correct recipe, never a truncated/black atlas.
  const SPEC_MIN = 256
  const reduced = bake_block_textures({ size: SIZE, seed: 1337, max_layers: SPEC_MIN })
  const full = bake_block_textures({ size: SIZE, seed: 1337 })

  test('reduced atlas fits the spec-minimum device limit', () => {
    expect(reduced.layers).toBeLessThanOrEqual(SPEC_MIN)
    expect(reduced.albedo.length).toBe(reduced.layers * SIZE * SIZE * 4)
    // The unconstrained bake is UNCHANGED (byte-identical to the golden path) — the budget only bites here.
    expect(full.layers).toBe(atlas_layer_count())
  })

  test('EVERY recipe still baked — no block loses its texture (the black-block failure mode)', () => {
    // Same recipe set as the full atlas: not one recipe dropped. Every block therefore still resolves to a
    // real, in-bounds base layer (the material samples layer_of[block.id]) — never the sentinel/black path.
    expect(reduced.layer_of_name.size).toBe(full.layer_of_name.size)
    for (const recipe of RECIPES) {
      const base = reduced.layer_of_name.get(recipe.name)
      expect(base, `${recipe.name} missing from reduced atlas`).toBeDefined()
      const count = /** @type {number} */ (reduced.variants_of_name.get(recipe.name))
      expect(count, `${recipe.name} count`).toBeGreaterThanOrEqual(1) // base always survives
      // Base + variant run stays inside the baked layer count (the material clamps its pick to count−1).
      expect(/** @type {number} */ (base) + count).toBeLessThanOrEqual(reduced.layers)
    }
    // Same block-id → layer coverage as the full atlas (no textured block silently unmapped).
    expect(reduced.layer_of.size).toBe(full.layer_of.size)
  })

  test('material invariants hold: variants = phase × rotations, rotations divide variants', () => {
    for (const [name, count] of reduced.variants_of_name) {
      const rots = /** @type {number} */ (reduced.rotations_of_name.get(name))
      expect(rots).toBeGreaterThanOrEqual(1)
      // resolve_material_atlas computes grass_phase_count = variants / rotations — MUST be an exact integer,
      // and the phase-major/rotation-minor layout means variants is always a multiple of rotations.
      expect(count % rots).toBe(0)
    }
  })

  test('no empty (all-transparent-black) layer in the reduced atlas', () => {
    // A truncation bug would leave zeroed tail layers; assert every baked layer has non-zero content.
    const stride = SIZE * SIZE * 4
    for (let layer = 0; layer < reduced.layers; layer += 1) {
      let nonzero = 0
      for (let i = layer * stride; i < (layer + 1) * stride; i += 4) {
        if (reduced.albedo[i] || reduced.albedo[i + 1] || reduced.albedo[i + 2] || reduced.albedo[i + 3]) {
          nonzero = 1
          break
        }
      }
      expect(nonzero, `layer ${layer} is empty`).toBe(1)
    }
  })

  test('fit_layer_plan: budget ≥ natural ⇒ the natural plan (desktop path is byte-identical)', () => {
    const plan = fit_layer_plan(RECIPES, Infinity)
    const natural = plan.reduce((sum, p) => sum + p.phase * p.rots, 0)
    expect(natural).toBe(atlas_layer_count())
    // A generous-but-finite budget above the natural total also leaves it untouched.
    expect(fit_layer_plan(RECIPES, 512).reduce((s, p) => s + p.phase * p.rots, 0)).toBe(natural)
  })
})

describe('A1 procedural-tree species art (append-only parity)', () => {
  // The 14 leaf/bark/twig recipes appended by Lane A1 (ENGINE_AAA_PLAN §3.4/§3.7). Consumed by nothing yet
  // (no block/placement/material) — so their ONLY contract is: ADD layers at the END without moving any
  // pre-existing index (the frozen-MEDIUM + append-only-atlas laws).
  const NEW_NAMES = [
    'tree_leaf_broadleaf',
    'tree_leaf_birch',
    'tree_needle_bunch',
    'tree_leaf_dry',
    'tree_moss_drape',
    'tree_palm_frond',
    'tree_mushroom_cap',
    'tree_bark_birch',
    'tree_bark_pine',
    'tree_bark_acacia',
    'tree_bark_swamp',
    'tree_bark_dead',
    'tree_twig_bare',
    'tree_twig_conifer',
  ]
  const ALPHA_CLIP_NEW = [
    'tree_leaf_broadleaf',
    'tree_leaf_birch',
    'tree_needle_bunch',
    'tree_leaf_dry',
    'tree_moss_drape',
    'tree_palm_frond',
    'tree_twig_bare',
    'tree_twig_conifer',
  ]
  const OPAQUE_NEW = [
    'tree_mushroom_cap',
    'tree_bark_birch',
    'tree_bark_pine',
    'tree_bark_acacia',
    'tree_bark_swamp',
    'tree_bark_dead',
  ]

  test('all 14 tree recipes present, appended AFTER the pre-A1 atlas', () => {
    const res = bake_block_textures({ size: SIZE, seed: 1337 })
    for (const n of NEW_NAMES) expect(res.layer_of_name.has(n)).toBe(true)
    // Every new base layer sits at/after the pre-A1 end (210) — pure append, never an insertion.
    for (const n of NEW_NAMES) expect(/** @type {number} */ (res.layer_of_name.get(n))).toBeGreaterThanOrEqual(210)
  })

  test('PARITY: the first 210 (pre-A1) layers are byte-identical', () => {
    // Pinned FNV-1a of the pre-A1 atlas over layers [0,210) at {size:64, seed:1337}. An append cannot move
    // existing texels; an INSERTION, or an op regression touching a base recipe, would flip this hash. This
    // IS the append-only / frozen-MEDIUM guard for the tree art wave.
    // [BUG-1 2026-07-11] Re-baselined 2741773989→2244158329: the `leaves_conifer` base recipe was
    // INTENTIONALLY changed (snow-dust top_white [236,242,250]→[176,190,196], top_frac 0.3→0.12) to fix the
    // "white translucent blocks below trees" defect. Only the leaves_conifer layer's texels moved; every
    // other pre-A1 layer is still byte-frozen against this new baseline.
    // [2026-07-12] Re-baselined 2244158329→3549474813: the `grass` top recipe was
    // INTENTIONALLY calmed (texture_recipes.js — clumps/fbm/cluster_speckle/speckle strength+amp+density+
    // darken all cut to ~45-60% of their prior value; threshold/soft/freq/bias untouched) so a tiled
    // meadow stops reading as "the same mottled tile repeated". Only the grass base
    // layer's texels moved; every other pre-A1 layer is still byte-frozen against this new baseline.
    // [2026-07-12] connected-ground-gradients: Re-baselined 3549474813→1200821950, boundary
    // 210→228: grass's recipe grew 4 BAKED ROTATIONS (texture_recipes.js `rotations: [0,90,180,270]`,
    // was phase-only) so terrain_material.js can pick an independent per-block rotation under a coherent
    // per-patch phase pick — 6 phase × 4 rot = 24 layers (+18 vs the old 6). This is a pure APPEND within
    // the grass recipe's own span (rotate_buffer_90 is an exact index remap, never touches other recipes'
    // texels) that shifts every LATER recipe's absolute layer index by +18 — the boundary and hash move
    // with it; every recipe's own texels (incl. grass's original phase-0/rotation-0 layer) are unchanged.
    // [2026-07-13 round-2 owner "that's your procedural leaves? crossed planes???"] Re-baselined
    // 1200821950→1486638945: op_leaf's silhouette INTENTIONALLY changed from one radial-eroded blob to the
    // MULTI-CLUMP layout (4 hash-placed lobes, deep notches, hard-transparent border ring — texture_baker.js
    // op_leaf). Only the op_leaf-baked layers' texels moved (leaves/leaves_conifer/leaves_dry — the tree
    // species tiles are post-A1); every other pre-A1 layer is still byte-frozen against this new baseline.
    const ORIGINAL_LAYERS = 228
    const PRE_A1_HASH = 1486638945
    const res = bake_block_textures({ size: SIZE, seed: 1337 })
    const stride = SIZE * SIZE * 4
    expect(res.layers).toBeGreaterThan(ORIGINAL_LAYERS)
    expect(fnv1a(res.albedo.subarray(0, ORIGINAL_LAYERS * stride))).toBe(PRE_A1_HASH)
    // lily_pad was the LAST pre-A1 recipe (base 208, now 226 — shifted +18 by grass's new rotations) —
    // pin it so an insertion above it fails loudly.
    expect(res.layer_of_name.get('lily_pad')).toBe(226)
  })

  test('leaf/twig cards are alpha-clip cutouts; barks + cap are opaque', () => {
    const res = bake_block_textures({ size: SIZE, seed: 42 })
    for (const n of ALPHA_CLIP_NEW) {
      const a = alpha_values(res, /** @type {number} */ (res.layer_of_name.get(n)))
      expect(a.has(0), `${n} must punch transparent holes`).toBe(true)
      expect(a.has(255), `${n} must have opaque texels`).toBe(true)
    }
    for (const n of OPAQUE_NEW) {
      expect([...alpha_values(res, /** @type {number} */ (res.layer_of_name.get(n)))]).toEqual([255])
    }
  })
})

describe('alpha invariants', () => {
  const res = bake_block_textures({ size: SIZE, seed: 42 })

  test('alpha-clip layers contain both alpha=0 and alpha=255', () => {
    for (const name of ALPHA_CLIP_NAMES) {
      const layer = /** @type {number} */ (res.layer_of_name.get(name))
      const alphas = alpha_values(res, layer)
      expect(alphas.has(0)).toBe(true)
      expect(alphas.has(255)).toBe(true)
    }
  })

  test('opaque layers are fully alpha=255', () => {
    for (const name of OPAQUE_NAMES) {
      const layer = /** @type {number} */ (res.layer_of_name.get(name))
      expect([...alpha_values(res, layer)]).toEqual([255])
    }
  })

  test('water is uniformly alpha=200', () => {
    const layer = /** @type {number} */ (res.layer_of_name.get('water'))
    expect([...alpha_values(res, layer)]).toEqual([200])
  })
})

describe('painterly grain bound', () => {
  test('GRAIN_MAX_AMPLITUDE ≤ 15%', () => {
    expect(GRAIN_MAX_AMPLITUDE).toBeLessThanOrEqual(0.15)
  })

  test('grass top is ISOTROPIC — no directional (stripe) banding (2026-07-03 rework regression)', () => {
    // THE banding regression guard. The old grass used a VERTICAL RAMP whose per-tile
    // Z-gradient tiled into horizontal stripes across a lawn. The rework replaced it with isotropic
    // fBm+clumps (no axis bias). Encode "no stripes" structurally: the variance of the ROW means must
    // be comparable to the variance of the COLUMN means — a directional ramp would blow one up while
    // the other stayed ~0. We assert their ratio is within a modest band (neither axis dominates).
    const res = bake_block_textures({ size: SIZE, seed: 99 })
    const stride = SIZE * SIZE * 4
    const base = /** @type {number} */ (res.layer_of_name.get('grass')) * stride
    /** @type {(x: number, y: number) => number} */
    const luma = (x, y) => {
      const i = base + (y * SIZE + x) * 4
      return (res.albedo[i] + res.albedo[i + 1] + res.albedo[i + 2]) / 3
    }
    const row_means = []
    const col_means = []
    for (let y = 0; y < SIZE; y += 1) {
      let s = 0
      for (let x = 0; x < SIZE; x += 1) s += luma(x, y)
      row_means.push(s / SIZE)
    }
    for (let x = 0; x < SIZE; x += 1) {
      let s = 0
      for (let y = 0; y < SIZE; y += 1) s += luma(x, y)
      col_means.push(s / SIZE)
    }
    /** @type {(arr: number[]) => number} */
    const variance = (arr) => {
      const m = arr.reduce((a, c) => a + c, 0) / arr.length
      return arr.reduce((a, c) => a + (c - m) * (c - m), 0) / arr.length
    }
    const rv = variance(row_means)
    const cv = variance(col_means)
    const ratio = Math.max(rv, cv) / (Math.min(rv, cv) || 1e-9)
    console.log(
      `grass row-mean var=${rv.toFixed(2)} col-mean var=${cv.toFixed(2)} anisotropy ratio=${ratio.toFixed(2)}`
    )
    // The old vertical-ramp grass had a ratio in the hundreds (rows uniform, columns ramped). Isotropic
    // noise keeps it low. 8× headroom guards against a directional op regressing in without over-fitting
    // to one seed's exact figure.
    expect(ratio).toBeLessThan(8)
  })

  test('grass-top albedo is DESATURATED (composition law — ENG-1 tint owns biome hue)', () => {
    // THE composition-law guard (brief §COMPOSITION WITH ENG-1). The baked grass-top must stay a muted
    // olive-GREY: ENG-1's macro tint (climate K + TURF_RGB in terrain_tint.js) multiplies the biome GREEN
    // on top, so a saturated-green baked base would double-colour into oversaturated mud. We measure mean
    // chroma (max−min of RGB, 0..255) over the base grass layer. [D177 revision — owner, three blend
    // complaints: "sprite super green, floor yellowish, can't blend"] the abstract-desaturation law LOST
    // to the blade-family anchor: the ground now bakes in the BLADE-BODY green family (mean chroma ≈0.17)
    // so tufts root in same-coloured sward; the ENG-1 tint multiplies both identically so they cannot
    // drift apart. Guard at 0.24: blocks a full re-saturation regression while allowing the blade anchor.
    const res = bake_block_textures({ size: SIZE, seed: 99 })
    const stride = SIZE * SIZE * 4
    const base = /** @type {number} */ (res.layer_of_name.get('grass')) * stride
    let sum_chroma = 0
    for (let p = 0; p < SIZE * SIZE; p += 1) {
      const i = base + p * 4
      const r = res.albedo[i],
        g = res.albedo[i + 1],
        b = res.albedo[i + 2]
      sum_chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255
    }
    const mean_chroma = sum_chroma / (SIZE * SIZE)
    console.log(
      `grass-top mean chroma: ${mean_chroma.toFixed(3)} (must stay ≤0.24 — desaturated so the tint greens it)`
    )
    expect(mean_chroma).toBeLessThanOrEqual(0.24)
  })

  test('grass op_fbm grain swing stays within the painterly bound', () => {
    // The multiplicative fBm grain on grass is source-clamped to GRAIN_MAX_AMPLITUDE (op_fbm). Clumps /
    // cluster-speckle are deliberate COLOUR PATCHES (a different, stronger feature) so we isolate the
    // grain envelope by measuring luma deviation within small local neighbourhoods (a 4px window is
    // below the clump scale ≈ size/3, so window spread ≈ grain, not patch). Stays within the bound.
    const res = bake_block_textures({ size: SIZE, seed: 99 })
    const stride = SIZE * SIZE * 4
    const base = /** @type {number} */ (res.layer_of_name.get('grass')) * stride
    /** @type {(x: number, y: number) => number} */
    const luma = (x, y) => {
      const i = base + (y * SIZE + x) * 4
      return (res.albedo[i] + res.albedo[i + 1] + res.albedo[i + 2]) / 3
    }
    let max_dev = 0
    const win = 2
    for (let y = win; y < SIZE - win; y += 1) {
      for (let x = win; x < SIZE - win; x += 1) {
        let sum = 0
        let n = 0
        for (let dy = -win; dy <= win; dy += 1)
          for (let dx = -win; dx <= win; dx += 1) {
            sum += luma(x + dx, y + dy)
            n += 1
          }
        const local_mean = sum / n
        max_dev = Math.max(max_dev, Math.abs(luma(x, y) - local_mean) / local_mean)
      }
    }
    console.log(`grass local (4px-window) grain deviation: ${(max_dev * 100).toFixed(2)}%`)
    // Local window can straddle a clump edge, so allow a small margin over the pure-grain bound.
    expect(max_dev).toBeLessThanOrEqual(GRAIN_MAX_AMPLITUDE * 1.6)
  })
})

describe('three DataArrayTexture', () => {
  test('builds with correct dims, filters, colorspace, mips', () => {
    const res = bake_block_textures({ size: SIZE, seed: 5 })
    const tex = build_data_array_texture(THREE, res)
    expect(tex.image.width).toBe(SIZE)
    expect(tex.image.height).toBe(SIZE)
    expect(tex.image.depth).toBe(res.layers)
    expect(tex.magFilter).toBe(THREE.NearestFilter)
    expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter)
    expect(tex.generateMipmaps).toBe(true)
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(tex.image.data).toBe(res.albedo)
    // Fix #2: HARDWARE Repeat wrap (drives GPUAddressMode.Repeat in the WebGPU sampler) so the
    // material can drop fract() and lose the ClampToEdge mip-derivative seam sparkle.
    expect(tex.wrapS).toBe(THREE.RepeatWrapping)
    expect(tex.wrapT).toBe(THREE.RepeatWrapping)
    // The name→layer + name→variant maps ride on userData so the material resolves the grass face
    // family + per-cell variants without a renderer plumbing change.
    expect(tex.userData.layer_of_name).toBe(res.layer_of_name)
    expect(tex.userData.variants_of_name).toBe(res.variants_of_name)
  })
})

describe('preview dump', () => {
  test('writes /tmp/baker_preview.rgba (named base layers side by side)', () => {
    const res = bake_block_textures({ size: SIZE, seed: 2024 })
    // Named base layers so the new grass_side rim is eyeball-verifiable next to grass/dirt/stone.
    const names = ['grass', 'grass_side', 'dirt', 'stone']
    const width = names.length * SIZE
    const height = SIZE
    const out = new Uint8Array(width * height * 4)
    const stride = SIZE * SIZE * 4
    names.forEach((name, col) => {
      const base = /** @type {number} */ (res.layer_of_name.get(name)) * stride
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const src = base + (y * SIZE + x) * 4
          const dst = (y * width + col * SIZE + x) * 4
          out[dst] = res.albedo[src]
          out[dst + 1] = res.albedo[src + 1]
          out[dst + 2] = res.albedo[src + 2]
          out[dst + 3] = res.albedo[src + 3]
        }
      }
    })
    writeFileSync('/tmp/baker_preview.rgba', out)
    console.log(`baker_preview.rgba: ${width}x${height} RGBA (layers: ${names.join(', ')})`)
    expect(out.length).toBe(width * height * 4)
  })
})

// MULTI-CLUMP LEAF SILHOUETTE (fixes the "crossed planes" leaf-silhouette defect) —
// the sprite plane must never read as one card: alpha survives only near 4 hash-placed lobes with deep
// concave notches between them, and the literal 1-texel border is ALWAYS transparent (the hardware-Repeat
// bilinear bleed then blends transparent with transparent — no straight quad edge can survive). Covers the
// base species AND every proc-tree species tile (all route through op_leaf — one home).
describe('leaf sprite silhouette (round-2: multi-clump, no card read)', () => {
  const res = bake_block_textures({ size: SIZE, seed: 0 })
  const LEAF_TILE_NAMES = [
    'leaves',
    'leaves_conifer',
    'leaves_dry',
    'tree_leaf_broadleaf',
    'tree_leaf_birch',
    'tree_leaf_dry',
  ]

  /** @param {number} layer @returns {Uint8Array} 0/1 opacity grid for one layer */
  function opacity_grid(layer) {
    const stride = SIZE * SIZE * 4
    const grid = new Uint8Array(SIZE * SIZE)
    for (let p = 0; p < SIZE * SIZE; p += 1) grid[p] = res.albedo[layer * stride + p * 4 + 3] > 127 ? 1 : 0
    return grid
  }

  /** 4-connected flood-fill component count over opaque texels. @param {Uint8Array} grid @returns {number} */
  function opaque_components(grid) {
    const seen = new Uint8Array(SIZE * SIZE)
    let components = 0
    for (let start = 0; start < SIZE * SIZE; start += 1) {
      if (!grid[start] || seen[start]) continue
      components += 1
      const stack = [start]
      seen[start] = 1
      while (stack.length) {
        const p = /** @type {number} */ (stack.pop())
        const x = p % SIZE
        const y = (p / SIZE) | 0
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
          const np = ny * SIZE + nx
          if (grid[np] && !seen[np]) {
            seen[np] = 1
            stack.push(np)
          }
        }
      }
    }
    return components
  }

  test('every leaf tile: the 1-texel border ring is FULLY transparent (wrap-bleed + quad-edge guarantee)', () => {
    for (const name of LEAF_TILE_NAMES) {
      const base = res.layer_of_name.get(name)
      expect(base).toBeDefined()
      const count = res.variants_of_name.get(name) ?? 1
      for (let v = 0; v < count; v += 1) {
        const grid = opacity_grid(/** @type {number} */ (base) + v)
        for (let i = 0; i < SIZE; i += 1) {
          expect(grid[i]).toBe(0) // top row
          expect(grid[(SIZE - 1) * SIZE + i]).toBe(0) // bottom row
          expect(grid[i * SIZE]).toBe(0) // left col
          expect(grid[i * SIZE + SIZE - 1]).toBe(0) // right col
        }
      }
    }
  })

  test('every leaf tile reads as MULTIPLE separated clumps (≥2 opaque components ≥8 texels), never one card', () => {
    for (const name of LEAF_TILE_NAMES) {
      const base = /** @type {number} */ (res.layer_of_name.get(name))
      const count = res.variants_of_name.get(name) ?? 1
      for (let v = 0; v < count; v += 1) {
        const grid = opacity_grid(base + v)
        // Count only substantial clumps (≥8 texels) so a stray fringe speckle can't satisfy the bar.
        const seen = new Uint8Array(SIZE * SIZE)
        let big = 0
        for (let start = 0; start < SIZE * SIZE; start += 1) {
          if (!grid[start] || seen[start]) continue
          let size_c = 0
          const stack = [start]
          seen[start] = 1
          while (stack.length) {
            const p = /** @type {number} */ (stack.pop())
            size_c += 1
            const x = p % SIZE
            const y = (p / SIZE) | 0
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue
              const np = ny * SIZE + nx
              if (grid[np] && !seen[np]) {
                seen[np] = 1
                stack.push(np)
              }
            }
          }
          if (size_c >= 8) big += 1
        }
        expect(big).toBeGreaterThanOrEqual(2)
        expect(opaque_components(grid)).toBeGreaterThanOrEqual(2)
      }
    }
  })

  test('opaque coverage stays in the readable band (not skeletal, not a slab) per species', () => {
    for (const name of LEAF_TILE_NAMES) {
      const base = /** @type {number} */ (res.layer_of_name.get(name))
      const count = res.variants_of_name.get(name) ?? 1
      for (let v = 0; v < count; v += 1) {
        const grid = opacity_grid(base + v)
        let opaque = 0
        for (let p = 0; p < SIZE * SIZE; p += 1) opaque += grid[p]
        const frac = opaque / (SIZE * SIZE)
        expect(frac).toBeGreaterThan(0.12) // never a skeletal speckle (the dry-species failure mode)
        expect(frac).toBeLessThan(0.72) // never a near-full slab (the card failure mode)
      }
    }
  })
})
