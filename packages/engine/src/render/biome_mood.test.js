// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// B5 biome mood crossfader — pure-logic proof (no GPU). Pins the four invariants the wiring cannot:
//  (1) VALIDATE: every preset — and every crossfade midpoint between the extremes — resolves inside
//      validate_atmo_config's accepted ranges (no whiteout, no crushed grade). The proof-bar gate.
//  (2) PARITY: NEUTRAL / grassland resolve byte-identical to the shipped ATMO_CONFIG (delta-zero),
//      which — with the ?mood=1 creation gate in engine.js — is the flag-off frozen-MEDIUM guarantee.
//  (3) NO-POP: crossing a border crossfades every dial MONOTONICALLY, with no single-frame jump, from
//      the source biome's value to the target's over ~4 s (smoothstep ease); LOW tier snaps.
//  (4) NON-FIGHT: mood writes grade CONTRAST + VIBRANCE only — never saturation (tod's D173 home);
//      and the biome probe is throttled to ≤1/s (not per-frame).

import { test, expect, describe } from 'bun:test'

import { get_biome_by_name } from '../config/biome_registry.js'

import { ATMO_CONFIG, validate_atmo_config } from './atmosphere.js'
import {
  MOOD_PRESETS,
  NEUTRAL_MOOD,
  mood_for_biome,
  lerp_mood,
  resolve_dials,
  mood_to_atmo_config,
  create_mood_driver,
} from './biome_mood.js'
import { PARTICLE_KINDS } from './particles.js'

const id_of = (/** @type {string} */ name) => /** @type {{id:number}} */ (get_biome_by_name(name)).id

// ── (1) VALIDATE — presets + crossfade midpoints ────────────────────────────────────────────────
describe('B5 mood — presets validate inside the atmosphere caps', () => {
  test('every authored preset resolves to a valid atmosphere config', () => {
    for (const [name, preset] of Object.entries(MOOD_PRESETS)) {
      const problems = validate_atmo_config(mood_to_atmo_config(ATMO_CONFIG, preset))
      expect(problems, `${name}: ${problems.join(' | ')}`).toEqual([])
    }
    // the fallback mood itself must validate too.
    expect(validate_atmo_config(mood_to_atmo_config(ATMO_CONFIG, NEUTRAL_MOOD))).toEqual([])
  })

  test('crossfade midpoints between the mood extremes never transit an invalid state', () => {
    // the widest jumps a player can make: mist-max ↔ bone-dry, and flat-white ↔ harsh-dark.
    const extremes = [
      ['void_marsh', 'desert'],
      ['swamp', 'desert'],
      ['arctic', 'scorched_badlands'],
      ['void_marsh', 'grassland'],
    ]
    for (const [a, b] of extremes) {
      for (let t = 0; t <= 1; t += 0.1) {
        const mid = lerp_mood(MOOD_PRESETS[a], MOOD_PRESETS[b], t)
        const problems = validate_atmo_config(mood_to_atmo_config(ATMO_CONFIG, mid))
        expect(problems, `${a}->${b} @${t.toFixed(1)}: ${problems.join(' | ')}`).toEqual([])
      }
    }
  })

  test('near_haze stays strictly under the whiteout band and grade stays within ±20% (≥1)', () => {
    for (const [name, preset] of Object.entries(MOOD_PRESETS)) {
      const d = resolve_dials(ATMO_CONFIG, preset)
      expect(d.near_haze, `${name} near_haze whiteout`).toBeLessThan(0.004)
      expect(d.contrast, `${name} contrast floor`).toBeGreaterThanOrEqual(1)
      expect(d.contrast, `${name} contrast ceiling (±20%)`).toBeLessThanOrEqual(ATMO_CONFIG.grade.contrast * 1.2 + 1e-9)
      expect(d.cloud_coverage).toBeGreaterThan(0)
      expect(d.cloud_coverage).toBeLessThanOrEqual(1)
    }
  })
})

// ── (2) PARITY — NEUTRAL / grassland = shipped atmosphere, delta-zero ────────────────────────────
describe('B5 mood — flag-off / neutral parity (frozen-MEDIUM law)', () => {
  test('grassland is the neutral ATMOSPHERE anchor (delta-zero dials)', () => {
    // grassland carries the meadow's B7 pollen particle_kind (a discrete selector, NOT an atmosphere
    // dial), so it is no longer the NEUTRAL_MOOD object — but its DIALS resolve byte-identical to the
    // shipped ATMO_CONFIG, which IS the parity property (with the ?mood=1 gate = the flag-off guarantee).
    const g = resolve_dials(ATMO_CONFIG, mood_for_biome(id_of('grassland')))
    expect(g).toEqual(resolve_dials(ATMO_CONFIG, NEUTRAL_MOOD))
  })

  test('every preset carries a known B7 particle_kind + positive density', () => {
    const KINDS = new Set(['ambient', ...Object.keys(PARTICLE_KINDS)])
    for (const [name, preset] of Object.entries(MOOD_PRESETS)) {
      expect(KINDS.has(preset.particle_kind), `${name} kind "${preset.particle_kind}"`).toBe(true)
      expect(preset.particle_density, `${name} density`).toBeGreaterThan(0)
    }
    expect(NEUTRAL_MOOD.particle_kind).toBe('ambient')
  })

  test('NEUTRAL resolves byte-identical to the shipped ATMO_CONFIG dials', () => {
    const d = resolve_dials(ATMO_CONFIG, NEUTRAL_MOOD)
    expect(d.contrast).toBe(ATMO_CONFIG.grade.contrast)
    expect(d.vibrance).toBe(ATMO_CONFIG.grade.vibrance)
    expect(d.near_haze).toBe(ATMO_CONFIG.froxel.near_haze)
    expect(d.fog_sea).toBe(ATMO_CONFIG.froxel.fog_sea_density)
    expect(d.cloud_coverage).toBe(ATMO_CONFIG.cloud.coverage)
    expect(d.cloud_density).toBe(ATMO_CONFIG.cloud.density)
    expect(d.particle_opacity).toBe(ATMO_CONFIG.particles.opacity)
  })
})

// ── driver spy: capture every write the driver makes through the atmosphere handle ───────────────
const uni = (/** @type {number} */ v) => ({ value: v })
function make_spy_atmo(base = ATMO_CONFIG) {
  /** @type {Array<{contrast?:number,vibrance?:number,saturation?:number}>} */
  const grade_writes = []
  return {
    config: base,
    grade: { set: (/** @type {{contrast?:number,vibrance?:number}} */ c) => grade_writes.push({ ...c }) },
    near_haze: uni(base.froxel.near_haze),
    fog_sea: uni(base.froxel.fog_sea_density),
    clouds: { coverage: uni(base.cloud.coverage), density: uni(base.cloud.density) },
    particles: { opacity: uni(base.particles.opacity) },
    _grade_writes: grade_writes,
  }
}

// ── (3) NO-POP crossfade ─────────────────────────────────────────────────────────────────────────
describe('B5 mood — crossfade is smooth, monotone, bounded (no pop)', () => {
  const DT = 1 / 60

  test('boot snaps to the spawn biome (no crossfade up from neutral)', () => {
    const atmo = make_spy_atmo()
    const d = create_mood_driver({ atmo, sample_biome: () => id_of('swamp'), tier: 'high' })
    d.tick(DT, 0, 0)
    expect(d.current().blend).toBe(1)
    const want = resolve_dials(ATMO_CONFIG, MOOD_PRESETS.swamp)
    expect(atmo.near_haze.value).toBeCloseTo(want.near_haze, 10)
    expect(atmo.clouds.coverage.value).toBeCloseTo(want.cloud_coverage, 10)
  })

  test('crossing grassland→desert crossfades every dial monotonically with no single-frame pop', () => {
    let biome = id_of('grassland')
    const atmo = make_spy_atmo()
    const d = create_mood_driver({ atmo, sample_biome: () => biome, tier: 'high', crossfade_seconds: 4 })
    // settle > 1 s in grassland (neutral): dials sit at the shipped values.
    for (let t = 0; t < 1.1; t += DT) d.tick(DT, 0, 0)
    expect(atmo.near_haze.value).toBeCloseTo(ATMO_CONFIG.froxel.near_haze, 10)

    // step across the border.
    biome = id_of('desert')
    /** @type {number[]} */ const haze = []
    /** @type {number[]} */ const contrast = []
    for (let t = 0; t < 6; t += DT) {
      d.tick(DT, 0, 0)
      haze.push(atmo.near_haze.value)
      contrast.push(/** @type {number} */ (atmo._grade_writes.at(-1)?.contrast))
    }

    const desert = resolve_dials(ATMO_CONFIG, MOOD_PRESETS.desert)
    // endpoints: starts at the source (grassland) value, ends at the target (desert) value.
    expect(haze[0]).toBeCloseTo(ATMO_CONFIG.froxel.near_haze, 6)
    expect(haze.at(-1)).toBeCloseTo(desert.near_haze, 8)
    expect(contrast.at(-1)).toBeCloseTo(desert.contrast, 6)

    // desert is drier + punchier: haze decreases, contrast increases — each MONOTONE (a pop = reversal).
    const monotone = (/** @type {number[]} */ s, /** @type {number} */ dir) => {
      let worst = 0
      for (let i = 1; i < s.length; i++) worst = Math.min(worst, dir * (s[i] - s[i - 1]))
      return worst // ≥ -eps ⇒ never moved against `dir`
    }
    expect(monotone(haze, -1), 'haze must not reverse (pop)').toBeGreaterThan(-1e-9)
    expect(monotone(contrast, +1), 'contrast must not reverse (pop)').toBeGreaterThan(-1e-9)

    // NO POP: the biggest single-frame step is a small fraction of the whole transition (a pop ≈ full range).
    const step_ratio = (/** @type {number[]} */ s) => {
      const range = Math.abs((s.at(-1) ?? 0) - s[0]) || 1
      let mx = 0
      for (let i = 1; i < s.length; i++) mx = Math.max(mx, Math.abs(s[i] - s[i - 1]))
      return mx / range
    }
    expect(step_ratio(haze), 'no per-frame haze pop').toBeLessThan(0.05)
    expect(step_ratio(contrast), 'no per-frame contrast pop').toBeLessThan(0.05)

    // DURATION ≈ 4 s: still clearly mid-transition 0.5 s in, fully settled by 5 s after the retarget.
    const mid_i = Math.round(0.5 / DT)
    expect(Math.abs(haze[mid_i] - (haze.at(-1) ?? 0))).toBeGreaterThan(1e-6) // not already done at 0.5 s
  })

  test('LOW tier snaps the crossfade (degrade order §7.3)', () => {
    let biome = id_of('grassland')
    const atmo = make_spy_atmo()
    const d = create_mood_driver({ atmo, sample_biome: () => biome, tier: 'low' })
    d.tick(1, 0, 0) // settle grassland (forces the first probe)
    biome = id_of('swamp')
    d.tick(1, 0, 0) // next probe → snap, not lerp
    const want = resolve_dials(ATMO_CONFIG, MOOD_PRESETS.swamp)
    expect(d.current().blend).toBe(1)
    expect(atmo.near_haze.value).toBeCloseTo(want.near_haze, 10) // reached target in ONE tick
  })
})

// ── (4) NON-FIGHT — no saturation writes, throttled probe ────────────────────────────────────────
describe('B5 mood — leaves saturation to tod, throttles the biome probe', () => {
  test('the driver never writes grade saturation', () => {
    let biome = id_of('grassland')
    const atmo = make_spy_atmo()
    const d = create_mood_driver({ atmo, sample_biome: () => biome, tier: 'high' })
    for (let t = 0; t < 2; t += 1 / 60) d.tick(1 / 60, 0, 0)
    biome = id_of('swamp')
    for (let t = 0; t < 4; t += 1 / 60) d.tick(1 / 60, 0, 0)
    expect(atmo._grade_writes.length).toBeGreaterThan(0)
    for (const w of atmo._grade_writes) {
      expect(Object.prototype.hasOwnProperty.call(w, 'saturation')).toBe(false)
    }
  })

  test('the biome probe runs at most ~1/s, not per rendered frame', () => {
    let calls = 0
    const atmo = make_spy_atmo()
    const d = create_mood_driver({
      atmo,
      sample_biome: () => {
        calls++
        return id_of('grassland')
      },
      tier: 'high',
    })
    for (let t = 0; t < 5; t += 1 / 60) d.tick(1 / 60, 0, 0) // 300 frames ≈ 5 s
    expect(calls).toBeLessThanOrEqual(7) // ~1 initial + 5 throttled, never 300
  })
})
