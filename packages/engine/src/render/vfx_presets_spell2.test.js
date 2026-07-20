// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// b_spell coverage-lane preset-table test — mirrors the StatusFX aura-lane / WORLD-PROPS pattern for the four
// DarkMagic / ElectricFX / ElementalMagic / FlameFX spell-variant families ported in vfx_presets_{dark,air,
// elemental,flame}.js. Proves: every one of the 35 presets exists (so every b_spell pack scene has a LIVE
// consumer), every emitter reuses a REAL registered pack appearance (never a generic-disc fallback — the
// "0 pack scenes left unused" guarantee), every SUSTAINED loop stays under the no-halo ceiling, and the counts
// match the manifest's scene tally. Pure data — the GPU draw is proven by the side-by-side stills.

import { describe, expect, test } from 'bun:test'

import { PACK_BILLBOARD, PACK_SPHERE } from './vfx_pack_shaders.js'
import { preset_peak_luma } from './vfx_preset_engine.js'
import { DARK_PRESETS } from './vfx_presets_dark.js'
import { AIR_PRESETS } from './vfx_presets_air.js'
import { ELEM_VARIANT_PRESETS } from './vfx_presets_elemental.js'
import { FLAME_VARIANT_PRESETS } from './vfx_presets_flame.js'

// the generic engine looks (flame_field / appearance_alpha) — valid, non-pack fallbacks
const GENERIC = new Set(['flame', 'spark', 'ring', 'glow', 'star', 'smoke'])
const VALID_APPEARANCE = new Set([...PACK_BILLBOARD, ...PACK_SPHERE, ...GENERIC])

const ALL = { ...DARK_PRESETS, ...AIR_PRESETS, ...ELEM_VARIANT_PRESETS, ...FLAME_VARIANT_PRESETS }

describe('b_spell variant presets (DarkMagic / ElectricFX / ElementalMagic / FlameFX)', () => {
  test('every manifest token resolves to presets (dark_orb/bolt/zone · air_bolt_orb/zap_strike · elem_variant · flame_variant)', () => {
    for (const tint of ['black', 'evil', 'void']) {
      expect(DARK_PRESETS[`dark_orb_${tint}`], `dark_orb_${tint}`).toBeTruthy()
      expect(DARK_PRESETS[`dark_bolt_${tint}`], `dark_bolt_${tint}`).toBeTruthy()
      expect(DARK_PRESETS[`dark_zone_${tint}`], `dark_zone_${tint}`).toBeTruthy()
    }
    for (let i = 1; i <= 6; i += 1) {
      const n = String(i).padStart(2, '0')
      expect(AIR_PRESETS[`air_bolt_orb_${n}`], `air_bolt_orb_${n}`).toBeTruthy()
      expect(AIR_PRESETS[`air_zap_strike_${n}`], `air_zap_strike_${n}`).toBeTruthy()
    }
    for (const el of ['fire', 'nature', 'electric'])
      for (const stage of ['cast', 'bolt', 'area'])
        expect(ELEM_VARIANT_PRESETS[`elem_variant_${el}_${stage}`], `elem_variant_${el}_${stage}`).toBeTruthy()
    for (const tint of ['cold', 'green', 'light', 'purple', 'void'])
      expect(FLAME_VARIANT_PRESETS[`flame_variant_${tint}`], `flame_variant_${tint}`).toBeTruthy()
  })

  test('the family counts match the manifest scene tally (9 dark · 12 air · 9 elem · 5 flame = 35)', () => {
    expect(Object.keys(DARK_PRESETS).length, 'dark').toBe(9)
    expect(Object.keys(AIR_PRESETS).length, 'air').toBe(12)
    expect(Object.keys(ELEM_VARIANT_PRESETS).length, 'elem').toBe(9)
    expect(Object.keys(FLAME_VARIANT_PRESETS).length, 'flame').toBe(5)
    expect(Object.keys(ALL).length, 'total').toBe(35)
  })

  test('every emitter reuses a REAL registered pack appearance (never a generic-disc fallback)', () => {
    for (const [name, p] of Object.entries(ALL)) {
      expect(p.emitters.length, `${name} has emitters`).toBeGreaterThan(0)
      for (const em of p.emitters) {
        expect(em.appearance, `${name}/${em.name} names an appearance`).toBeTruthy()
        expect(
          VALID_APPEARANCE.has(em.appearance ?? ''),
          `${name}/${em.name} appearance '${em.appearance}' is registered`
        ).toBe(true)
      }
    }
  })

  test('every b_spell appearance is a REAL pack .gdshader port (not a generic engine look — the "use the paid packs" mandate)', () => {
    for (const p of Object.values(ALL))
      for (const em of p.emitters)
        expect(PACK_BILLBOARD.has(em.appearance ?? ''), `${em.appearance} is a pack port`).toBe(true)
  })

  test('every SUSTAINED loop stays under the no-halo ceiling (a lingering zone/flame never blooms)', () => {
    for (const [name, p] of Object.entries(ALL)) {
      if (!p.loop) continue
      expect(preset_peak_luma(p), `${name} under the 2.05 halo ceiling`).toBeLessThan(2.05)
    }
  })

  test('travelling projectiles loop (head/trail shed continuously); the cast windup is a one-shot', () => {
    for (const tint of ['black', 'evil', 'void']) {
      expect(DARK_PRESETS[`dark_orb_${tint}`].loop, `dark_orb_${tint} loops`).toBe(true)
      expect(DARK_PRESETS[`dark_bolt_${tint}`].loop, `dark_bolt_${tint} loops`).toBe(true)
      expect(DARK_PRESETS[`dark_zone_${tint}`].loop, `dark_zone_${tint} loops`).toBe(true)
    }
    for (let i = 1; i <= 6; i += 1) {
      const n = String(i).padStart(2, '0')
      expect(AIR_PRESETS[`air_bolt_orb_${n}`].loop).toBe(true)
      expect(AIR_PRESETS[`air_zap_strike_${n}`].loop).toBe(true)
    }
    for (const el of ['fire', 'nature', 'electric']) {
      expect(ELEM_VARIANT_PRESETS[`elem_variant_${el}_bolt`].loop, `${el} bolt loops`).toBe(true)
      expect(ELEM_VARIANT_PRESETS[`elem_variant_${el}_area`].loop, `${el} area loops`).toBe(true)
      expect(ELEM_VARIANT_PRESETS[`elem_variant_${el}_cast`].loop, `${el} cast one-shot`).toBeFalsy()
    }
    for (const tint of ['cold', 'green', 'light', 'purple', 'void'])
      expect(FLAME_VARIANT_PRESETS[`flame_variant_${tint}`].loop, `flame_variant_${tint} loops`).toBe(true)
  })

  test('every emitter colour is within the ≤1-ish transcribed pack range (no accidental HDR blow-out)', () => {
    for (const [name, p] of Object.entries(ALL))
      for (const em of p.emitters)
        for (const c of [em.color, em.color_end]) {
          if (!c) continue
          for (const ch of c) expect(ch, `${name}/${em.name} channel sane`).toBeLessThanOrEqual(1.001)
        }
  })
})
