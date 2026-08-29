// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { MATERIAL_PRESETS } from '@aresrpg/engine'

import {
  FOOTSTEP_VOICES,
  RECORDED_FOOTSTEP_TREATMENT,
  advance_footstep_cadence,
  create_footstep_cadence,
  footstep_dynamics,
  footstep_friction_samples,
  footstep_preset,
  footstep_samples,
} from '../../../src/game/audio/footsteps.ts'
import {
  FOOTSTEP_AUDIO_ASSETS,
  pick_footstep_recording,
  recorded_footstep_preset,
} from '../../../src/game/audio/footstep_recordings.ts'

describe('procedural footsteps', () => {
  test('uses six non-repeating recordings for both stone and sand', () => {
    expect(Object.keys(FOOTSTEP_AUDIO_ASSETS)).toHaveLength(12)
    expect(recorded_footstep_preset('stone')).toBe(true)
    expect(recorded_footstep_preset('sand')).toBe(true)
    expect(recorded_footstep_preset('grass')).toBe(false)
    const first = pick_footstep_recording('stone', undefined, () => 0)
    const second = pick_footstep_recording('stone', first.variant, () => 0)
    expect(first.key).not.toBe(second.key)
  })

  test('gives every material preset one distinct physically bounded voice', () => {
    expect(Object.keys(FOOTSTEP_VOICES).sort()).toEqual([...MATERIAL_PRESETS].sort())
    expect(
      new Set(
        Object.values(FOOTSTEP_VOICES).map(
          ({ duration, filter_type, cutoff, response, particle_density }) =>
            `${duration}:${filter_type}:${cutoff}:${response}:${particle_density}`
        )
      ).size
    ).toBe(MATERIAL_PRESETS.length)
    Object.values(FOOTSTEP_VOICES).forEach(({ duration, gain, cutoff, particle_density }) => {
      expect(duration).toBeGreaterThanOrEqual(0.05)
      expect(duration).toBeLessThanOrEqual(0.25)
      expect(gain).toBeGreaterThan(0)
      expect(gain).toBeLessThan(0.1)
      expect(cutoff).toBeGreaterThanOrEqual(300)
      expect(cutoff).toBeLessThanOrEqual(5000)
      expect(particle_density).toBeGreaterThanOrEqual(0)
      expect(particle_density).toBeLessThan(0.12)
    })
  })

  test('uses physical response families instead of granular noise on every surface', () => {
    const RESPONSES = {
      stone: 'solid',
      wood: 'solid',
      sand: 'aggregate',
      snow: 'aggregate',
      frozen_grass: 'aggregate',
      water: 'liquid',
    } as const
    Object.entries(RESPONSES).forEach(([preset, response]) => {
      expect(FOOTSTEP_VOICES[preset as keyof typeof RESPONSES].response, preset).toBe(response)
    })

    // Solid surfaces carry their body in resonances, never in particles.
    expect(FOOTSTEP_VOICES.stone.particle_density).toBe(0)
    expect(FOOTSTEP_VOICES.grass.particle_density).toBe(0)
    expect(FOOTSTEP_VOICES.stone.resonances.length).toBeGreaterThanOrEqual(2)
    expect(FOOTSTEP_VOICES.wood.resonances.length).toBeGreaterThanOrEqual(2)
    expect(FOOTSTEP_VOICES.stone.resonances[0]!.gain).toBeGreaterThan(0.3)
    expect(FOOTSTEP_VOICES.stone.cutoff).toBeLessThan(1_600)
    expect(FOOTSTEP_VOICES.grass.q).toBeLessThan(0.5)
    expect(FOOTSTEP_VOICES.grass.friction_gain).toBeGreaterThan(FOOTSTEP_VOICES.stone.friction_gain)

    // Aggregate surfaces are friction-led, not particle-led — and the recorded
    // treatment stays under the solid one.
    const { sand } = FOOTSTEP_VOICES
    expect(sand.filter_type).toBe('lowpass')
    expect(sand.cutoff).toBeLessThanOrEqual(1_600)
    expect(sand.q).toBeLessThan(0.6)
    expect(sand.particle_gain).toBeLessThanOrEqual(0.22)
    expect(sand.friction_gain).toBeGreaterThan(sand.particle_gain * 3)
    expect(RECORDED_FOOTSTEP_TREATMENT.sand.cutoff).toBe(1_450)
    expect(RECORDED_FOOTSTEP_TREATMENT.sand.pitch).toBeLessThan(1)
    expect(RECORDED_FOOTSTEP_TREATMENT.sand.gain).toBeLessThan(RECORDED_FOOTSTEP_TREATMENT.stone.gain)
  })

  test('running increases impact energy and pitch without changing the preset', () => {
    const walking = footstep_dynamics(4.8)
    const running = footstep_dynamics(10.5)
    expect(running.impact).toBeGreaterThan(walking.impact)
    expect(running.pitch).toBeGreaterThan(walking.pitch)
    expect(running.friction).toBeGreaterThan(walking.friction)
  })

  test('fires by grounded travel distance and carries the stride remainder', () => {
    const first = advance_footstep_cadence(create_footstep_cadence(), { x: 0, z: 0, on_ground: true }, () => 0.5)
    expect(first.fired).toBe(false)
    const second = advance_footstep_cadence(first.cadence, { x: 1, z: 0, on_ground: true }, () => 0.5)
    expect(second.fired).toBe(false)
    const third = advance_footstep_cadence(second.cadence, { x: 1.9, z: 0, on_ground: true }, () => 0.5)
    expect(third.fired).toBe(true)
    expect(third.cadence.distance).toBeCloseTo(0.1)

    const airborne = advance_footstep_cadence(third.cadence, { x: 2.5, z: 0, on_ground: false }, () => 0.5)
    expect(airborne.fired).toBe(false)
    expect(airborne.cadence.distance).toBe(0)
  })

  test('prefers liquid, then a structure, then the terrain surface', () => {
    expect(footstep_preset({ surface: 'grass', structure: 'wood', liquid: 'water', in_water: false })).toBe('wood')
    expect(footstep_preset({ surface: 'grass', structure: 'wood', liquid: 'water', in_water: true })).toBe('water')
    expect(footstep_preset({ surface: 'snow', liquid: 'water', in_water: false })).toBe('snow')
  })

  test('generates finite decaying waveforms without an audio context', () => {
    const signatures = MATERIAL_PRESETS.map((preset) => {
      let random_index = 0
      const random = (): number => ((random_index++ * 73 + 29) % 101) / 101
      const samples = footstep_samples(preset, 8_000, random)
      const friction = footstep_friction_samples(preset, 8_000, random)
      const peak = Math.max(...samples.map(Math.abs))
      const energy = samples.reduce((sum, sample) => sum + sample * sample, 0)
      expect(samples.length).toBeGreaterThan(300)
      expect(samples.every(Number.isFinite)).toBe(true)
      expect(peak).toBeLessThanOrEqual(1)
      expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.02)
      expect(friction.every(Number.isFinite)).toBe(true)
      expect(Math.abs(friction.at(-1)!)).toBeLessThan(0.02)
      return Math.round(energy * 1000)
    })
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(5)
  })
})
