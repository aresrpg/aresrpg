// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PER-BIOME TEXTURE IDENTITY gate (FIVE-WORLDS). Proves:
//   1. PARITY — an absent / all-identity `config.textures` bakes a BYTE-IDENTICAL atlas (the seed-
//      deterministic bake is unchanged by the config; the layer INDICES are a frozen material contract).
//   2. SENSITIVITY — a non-identity per-family transform MOVES the texel colours (a real palette) while
//      keeping the layer count + block→layer map identical (only colours move, never the atlas layout).
//   3. FAMILY MAPPING — every texture family maps to real recipes; the transform only touches its family.

import { createHash } from 'node:crypto'

import { test, expect, describe } from 'bun:test'

import { bake_block_textures } from '../../src/render/texture_baker.js'
import { RECIPES } from '../../src/render/texture_recipes.js'
import { apply_texture_config, TEXTURE_FAMILIES } from '../../src/render/texture_palette.js'

/** @param {ReturnType<typeof bake_block_textures>} bake */
const hash = (bake) => createHash('sha256').update(bake.albedo).digest('hex')
const recipe_names = new Set(RECIPES.map((r) => r.name))

describe('texture identity: PARITY (default bake byte-identical)', () => {
  const base = bake_block_textures({ size: 64, seed: 0 })

  test('absent textures ⇒ byte-identical atlas', () => {
    expect(hash(bake_block_textures({ size: 64, seed: 0, textures: undefined }))).toBe(hash(base))
  })

  test('all-identity families ⇒ byte-identical atlas (identity transform is skipped)', () => {
    const ident = bake_block_textures({
      size: 64,
      seed: 0,
      textures: { size: 64, families: { grass: { hue: 0, sat: 1, val: 1 }, wood: {}, sand: { val: 1 } } },
    })
    expect(hash(ident)).toBe(hash(base))
  })

  test('apply_texture_config returns the ORIGINAL recipes for absent / all-identity config', () => {
    expect(apply_texture_config(RECIPES, undefined)).toBe(RECIPES)
    expect(apply_texture_config(RECIPES, { families: { grass: { hue: 0 } } })).toBe(RECIPES)
  })

  test('the default bake is stable across calls (regression guard)', () => {
    expect(hash(bake_block_textures({ size: 64, seed: 0 }))).toBe(hash(base))
  })
})

describe('texture identity: SENSITIVITY (a palette moves colours, not layout)', () => {
  const base = bake_block_textures({ size: 64, seed: 0 })
  const jade = bake_block_textures({
    size: 64,
    seed: 0,
    textures: { families: { grass: { hue: 25, sat: 1.4 }, wood: { val: 0.65 }, water: { hue: -15 } } },
  })

  test('the atlas colours change', () => {
    expect(hash(jade)).not.toBe(hash(base))
  })

  test('the layer count + block→layer map are UNCHANGED (frozen material contract)', () => {
    expect(jade.layers).toBe(base.layers)
    expect(jade.size).toBe(base.size)
    expect([...jade.layer_of.entries()]).toEqual([...base.layer_of.entries()])
    expect([...jade.variants_of_name.entries()]).toEqual([...base.variants_of_name.entries()])
  })

  test('a family transform touches ONLY its own recipes (dirt untouched when only grass is tinted)', () => {
    const transformed = apply_texture_config(RECIPES, { families: { grass: { hue: 40 } } })
    const grass = new Set(TEXTURE_FAMILIES.grass)
    for (let i = 0; i < RECIPES.length; i += 1) {
      if (grass.has(RECIPES[i].name))
        expect(transformed[i]).not.toBe(RECIPES[i]) // cloned + transformed
      else expect(transformed[i]).toBe(RECIPES[i]) // untouched (same object)
    }
  })

  test('config.textures.size overrides the atlas edge', () => {
    const small = bake_block_textures({ seed: 0, textures: { size: 32, families: { grass: { hue: 10 } } } })
    expect(small.size).toBe(32)
  })
})

describe('texture identity: FAMILY MAPPING', () => {
  test('every family maps to real recipe names', () => {
    for (const [family, names] of Object.entries(TEXTURE_FAMILIES)) {
      for (const n of names) expect(recipe_names.has(n), `${family} → ${n} is a real recipe`).toBe(true)
    }
  })

  test('the families cover grass/foliage/wood/sand/dirt/stone/snow_ice/flower/water', () => {
    expect(Object.keys(TEXTURE_FAMILIES).sort()).toEqual([
      'dirt',
      'flower',
      'foliage',
      'grass',
      'sand',
      'snow_ice',
      'stone',
      'water',
      'wood',
    ])
  })
})
