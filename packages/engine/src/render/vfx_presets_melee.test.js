// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MELEE BURST (c_melee) preset-table test — mirrors the world/status lane assertions. The 20 BattleFX claw/swing/
// element-slash scenes each resolve to a burst preset; every one uses a REAL pack appearance (slash_arc crescent +
// spark, never a generic disc); every burst stays under the engine's no-halo luma ceiling; the resolver maps
// (kind, element) → the right preset. Pure data — the GPU render is proven by the WebGPU probe (bench/vfx_wavea).

import { test, expect, describe } from 'bun:test'

import { MELEE_PRESETS, MELEE_ELEMENTS, SLASH_ELEMENTS, melee_burst_preset } from './vfx_presets_melee.js'
import { preset_peak_luma } from './vfx_preset_engine.js'

// The appearances a melee burst is allowed to use — all REAL pack ports (slash_arc = slash.gdshader, arcane_mote =
// attack_particles.gdshader, impact_core = impact_core.gdshader). B2: the fan/bits/trail/spray sprays are arcane_mote
// (were the generic FBM `spark` — constraint: cut EVERY non-Godot effect). If a preset ever reaches for a generic disc/FBM, this trips.
const ALLOWED = new Set(['slash_arc', 'arcane_mote', 'impact_core'])
const NO_HALO = 2.05 // the engine's bloom threshold (preset_peak_luma unit-tested against it)

describe('MELEE BURSTS (c_melee)', () => {
  test('all 20 pack scenes resolve: 7 claw + 7 swing + 6 slash_elem presets exist', () => {
    for (const el of MELEE_ELEMENTS) {
      expect(MELEE_PRESETS[`melee_claw_${el}`], `melee_claw_${el}`).toBeTruthy()
      expect(MELEE_PRESETS[`melee_swing_${el}`], `melee_swing_${el}`).toBeTruthy()
    }
    for (const el of SLASH_ELEMENTS) expect(MELEE_PRESETS[`slash_elem_${el}`], `slash_elem_${el}`).toBeTruthy()
    expect(Object.keys(MELEE_PRESETS).length, '7 + 7 + 6 = 20 melee presets').toBe(20)
  })

  test('every burst uses a REAL pack appearance (slash_arc/arcane_mote/impact_core), never a generic disc/FBM', () => {
    for (const [name, p] of Object.entries(MELEE_PRESETS)) {
      expect(p.emitters.length, `${name} has emitters`).toBeGreaterThan(0)
      // at least one slash_arc crescent (the pack slash.gdshader port is the hero of every melee burst)
      expect(
        p.emitters.some((e) => e.appearance === 'slash_arc'),
        `${name} has a slash_arc crescent`
      ).toBe(true)
      for (const em of p.emitters)
        expect(ALLOWED.has(/** @type {string} */ (em.appearance)), `${name}/${em.name} = ${em.appearance}`).toBe(true)
    }
  })

  test('every melee burst is a one-shot (no loop) under the no-halo luma ceiling', () => {
    for (const [name, p] of Object.entries(MELEE_PRESETS)) {
      expect(p.loop, `${name} is a one-shot burst`).toBeFalsy()
      expect(preset_peak_luma(p), `${name} under the halo ceiling`).toBeLessThan(NO_HALO)
      expect(p.duration, `${name} is a short burst`).toBeLessThanOrEqual(1.2)
    }
  })

  test('claw is a 3-mark rake (three slash_arc crescents)', () => {
    for (const el of MELEE_ELEMENTS) {
      const arcs = MELEE_PRESETS[`melee_claw_${el}`].emitters.filter((e) => e.appearance === 'slash_arc')
      expect(arcs.length, `melee_claw_${el} rake = 3 marks`).toBe(3)
    }
  })

  test('the element palette is baked distinctly per element (fire ≠ water ≠ death)', () => {
    const arc = (/** @type {string} */ n) =>
      /** @type {any} */ (MELEE_PRESETS[n].emitters.find((e) => e.name === 'arc'))
    expect(arc('melee_swing_fire').color_end).not.toEqual(arc('melee_swing_water').color_end)
    expect(arc('melee_swing_death').color_end).not.toEqual(arc('melee_swing_earth').color_end)
  })

  test('melee_burst_preset maps (kind, element) → the right preset; neutral slash falls back to the LIVE slash_weapon', () => {
    expect(melee_burst_preset('claw', 'fire')).toBe('melee_claw_fire')
    expect(melee_burst_preset('swing', 'death')).toBe('melee_swing_death')
    expect(melee_burst_preset('slash', 'water')).toBe('slash_elem_water')
    expect(melee_burst_preset('slash', 'neutral')).toBe('slash_weapon') // no neutral slash scene
    expect(melee_burst_preset('claw', 'not-an-element')).toBe('melee_claw_neutral') // graceful fallback
    for (const el of MELEE_ELEMENTS) expect(MELEE_PRESETS[melee_burst_preset('swing', el)], `swing ${el}`).toBeTruthy()
  })
})
