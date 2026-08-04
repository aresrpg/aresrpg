// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD-PROPS (d_world) preset-table test — mirrors the StatusFX aura-lane's preset assertions for the FlameFX
// bonfire/candle LOOP fixtures: the 18 scenes each resolve to a preset, every one is a LOOP, none breaches the
// halo ceiling while it SUSTAINS (a persistent world fire must never bloom — colours are clamp1'd), and the
// name-resolver maps (kind, tint, variant) to the right preset. Pure data — the GPU draw is proven by the
// in-context cave/overworld screenshots.

import { test, expect, describe } from 'bun:test'

import { WORLD_PRESETS, world_fixture_preset, FLAME_TINTS } from '../../src/render/vfx_presets_world.js'
import { preset_peak_luma } from '../../src/render/vfx_preset_engine.js'
import { PRESETS } from '../../src/render/vfx_presets_data.js'

const BONFIRE_TINTS = ['basic', 'cold', 'green', 'light', 'purple', 'void']
const CANDLE_KEYS = [
  'basic_a',
  'basic_b',
  'cold_a',
  'cold_b',
  'green_a',
  'green_b',
  'light_a',
  'light_b',
  'purple_a',
  'purple_b',
  'void_a',
  'void_b',
]

describe('WORLD-PROPS FlameFX fixtures (d_world)', () => {
  test('all 18 pack scenes resolve: 6 bonfire + 12 candle presets exist', () => {
    for (const t of BONFIRE_TINTS) expect(WORLD_PRESETS[`world_bonfire_${t}`], `world_bonfire_${t}`).toBeTruthy()
    for (const k of CANDLE_KEYS) expect(WORLD_PRESETS[`world_candle_${k}`], `world_candle_${k}`).toBeTruthy()
    expect(Object.keys(WORLD_PRESETS).length, '18 world fixtures').toBe(18)
  })

  test('every fixture is a LOOP and stays UNDER the halo ceiling while it sustains (a persistent world fire never blooms)', () => {
    for (const [name, p] of Object.entries(WORLD_PRESETS)) {
      expect(p.loop, `${name} loops`).toBe(true)
      // clamp1'd colours ⇒ peak luma ≤ 1.0 — well under the 2.05 no-halo threshold the engine test enforces.
      expect(preset_peak_luma(p), `${name} under the halo ceiling`).toBeLessThan(1.05)
    }
  })

  test("every emitter colour is clamp1'd ≤1 per channel (the no-bloom discipline) and uses the ported `fire` appearance", () => {
    for (const [name, p] of Object.entries(WORLD_PRESETS)) {
      expect(p.emitters.length, `${name} has emitters`).toBeGreaterThan(0)
      for (const em of p.emitters) {
        expect(em.appearance, `${name}/${em.name} reuses fire`).toBe('fire')
        for (const c of [em.color, em.color_end]) {
          if (!c) continue
          for (const ch of c) expect(ch, `${name}/${em.name} channel ≤1`).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  test('the fixtures merge into the master PRESETS (one lookup surface, like SPELL_PRESETS)', () => {
    expect(PRESETS.world_bonfire_void, 'world_bonfire_void in PRESETS').toBeTruthy()
    expect(PRESETS.world_candle_basic_a, 'world_candle_basic_a in PRESETS').toBeTruthy()
  })

  test('world_fixture_preset maps (kind, tint, variant) → the right preset (and falls back on an unknown tint)', () => {
    expect(world_fixture_preset('bonfire', 'void')).toBe('world_bonfire_void')
    expect(world_fixture_preset('candle', 'green', 2)).toBe('world_candle_green_b')
    expect(world_fixture_preset('candle', 'cold', 1)).toBe('world_candle_cold_a')
    expect(world_fixture_preset('bonfire', 'not-a-tint')).toBe('world_bonfire_basic') // graceful fallback
    for (const t of FLAME_TINTS) expect(WORLD_PRESETS[world_fixture_preset('bonfire', t)], `bonfire ${t}`).toBeTruthy()
  })
})
