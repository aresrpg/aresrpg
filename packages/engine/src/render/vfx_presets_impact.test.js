// STATUS/WARD/VORTEX/IMPACT (e_status_impact) preset-table test. The 23 remaining e-class pack scenes each resolve
// to a preset: 14 shield-ward LOOP blooms (7 el × 2 tiers), 3 dark-vortex bursts, 6 air-impact bursts. Shield wards
// are LOOPs that stay under the halo ceiling (a sustained ward never blooms); vortex/impact are one-shot bursts;
// every preset uses REAL pack appearances. Pure data — the GPU render is proven by the WebGPU probe.

import { test, expect, describe } from 'bun:test'

import {
  IMPACT_PRESETS,
  SHIELD_ELEMENTS,
  VORTEX_TINTS,
  DARK_VORTEX_PRESETS,
  AIR_IMPACT_PRESETS,
  shield_ward_preset,
} from './vfx_presets_impact.js'
import { preset_peak_luma } from './vfx_preset_engine.js'

// Real pack ports only: shield = aura_shell/sphere_glow/arcane_mote; vortex = void_aura/streaks/void_particle/
// void_core; impact = sphere_impact/zap_burst/impact_core/zap. B2: the shield orbit Shards are arcane_mote and the
// air-impact sparks are zap (both were the generic FBM `spark` — constraint: cut EVERY non-Godot effect). No generic disc anywhere.
const ALLOWED = new Set([
  'aura_shell',
  'sphere_glow',
  'arcane_mote',
  'void_aura',
  'streaks',
  'void_particle',
  'void_core',
  'sphere_impact',
  'zap_burst',
  'impact_core',
  'zap',
])
const NO_HALO = 2.05

describe('SHIELD WARD (e_status_impact, LOOP)', () => {
  test('all 14 pack shield scenes resolve: 7 elements × 2 tiers', () => {
    for (const el of SHIELD_ELEMENTS) {
      expect(IMPACT_PRESETS[`shield_ward_${el}_a`], `shield_ward_${el}_a`).toBeTruthy()
      expect(IMPACT_PRESETS[`shield_ward_${el}_b`], `shield_ward_${el}_b`).toBeTruthy()
    }
    const wards = Object.keys(IMPACT_PRESETS).filter((n) => n.startsWith('shield_ward_'))
    expect(wards.length, '7 × 2 = 14 shield wards').toBe(14)
  })

  test('every ward is a LOOP that stays UNDER the halo ceiling (a sustained ward never blooms — clamp1 discipline)', () => {
    for (const el of SHIELD_ELEMENTS)
      for (const tier of ['a', 'b']) {
        const p = IMPACT_PRESETS[`shield_ward_${el}_${tier}`]
        expect(p.loop, `shield_ward_${el}_${tier} loops`).toBe(true)
        expect(preset_peak_luma(p), `shield_ward_${el}_${tier} under halo`).toBeLessThan(1.05)
        for (const em of p.emitters)
          for (const c of [em.color, em.color_end])
            if (c) for (const ch of c) expect(ch, `${p.name}/${em.name} channel ≤1`).toBeLessThanOrEqual(1)
      }
  })

  test('a ward mounts the dome (aura_shell) + fresnel rim (sphere_glow) + orbit motes', () => {
    const p = IMPACT_PRESETS.shield_ward_fire_b
    const kinds = new Set(p.emitters.map((e) => e.appearance))
    expect(kinds.has('aura_shell'), 'dome shell').toBe(true)
    expect(kinds.has('sphere_glow'), 'fresnel rim').toBe(true)
    expect(kinds.has('arcane_mote'), 'orbit motes (BattleFX Shards)').toBe(true)
  })

  test('tier b (big shield) is larger than tier a (small buff)', () => {
    const dome = (n) => IMPACT_PRESETS[n].emitters.find((e) => e.name === 'dome')
    expect(dome('shield_ward_fire_b').ellipsoid[0]).toBeGreaterThan(dome('shield_ward_fire_a').ellipsoid[0])
  })

  test('shield_ward_preset maps (element, tier) → the right preset', () => {
    expect(shield_ward_preset('fire')).toBe('shield_ward_fire_a')
    expect(shield_ward_preset('death', 2)).toBe('shield_ward_death_b')
    expect(shield_ward_preset('not-an-element')).toBe('shield_ward_neutral_a')
  })
})

describe('DARK VORTEX + AIR IMPACT (e_status_impact, bursts)', () => {
  test('all 3 vortex + 6 impact scenes resolve', () => {
    for (const t of VORTEX_TINTS) expect(IMPACT_PRESETS[`dark_vortex_${t}`], `dark_vortex_${t}`).toBeTruthy()
    for (const n of AIR_IMPACT_PRESETS) expect(IMPACT_PRESETS[n], n).toBeTruthy()
    expect(DARK_VORTEX_PRESETS.length, '3 vortex').toBe(3)
    expect(AIR_IMPACT_PRESETS.length, '6 impact').toBe(6)
  })

  test('every vortex + impact is a one-shot burst under the no-halo ceiling, using real pack appearances', () => {
    for (const n of [...DARK_VORTEX_PRESETS, ...AIR_IMPACT_PRESETS]) {
      const p = IMPACT_PRESETS[n]
      expect(p.loop, `${n} is a burst`).toBeFalsy()
      expect(preset_peak_luma(p), `${n} under halo`).toBeLessThan(NO_HALO)
      for (const em of p.emitters) expect(ALLOWED.has(em.appearance), `${n}/${em.name} = ${em.appearance}`).toBe(true)
    }
  })

  test('the vortex swirl vocabulary is present (void_aura ring + streaks + inward void motes)', () => {
    const p = IMPACT_PRESETS.dark_vortex_void
    const kinds = new Set(p.emitters.map((e) => e.appearance))
    expect(kinds.has('void_aura') && kinds.has('streaks') && kinds.has('void_particle'), 'vortex layers').toBe(true)
    expect(p.emitters.find((e) => e.name === 'motes').inward, 'motes implode inward').toBe(true)
  })

  test('air impacts bake distinct element secondaries (6 different colours)', () => {
    const secs = AIR_IMPACT_PRESETS.map((n) =>
      JSON.stringify(IMPACT_PRESETS[n].emitters.find((e) => e.name === 'ball').color_end)
    )
    expect(new Set(secs).size, '6 distinct impact colours').toBe(6)
  })

  test('the whole e-class table is 23 presets (14 + 3 + 6)', () => {
    expect(Object.keys(IMPACT_PRESETS).length, '14 ward + 3 vortex + 6 impact = 23').toBe(23)
  })
})
