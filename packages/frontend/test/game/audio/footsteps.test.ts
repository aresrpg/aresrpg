// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { MATERIAL_PRESETS } from '@aresrpg/engine'

import {
  advance_footstep_cadence,
  create_footsteps,
  create_footstep_cadence,
  footstep_dynamics,
  footstep_preset,
} from '../../../src/game/audio/footsteps.ts'
import {
  FOOTSTEP_AUDIO_ASSETS,
  FOOTSTEP_RECORDINGS,
  pick_footstep_recording,
} from '../../../src/game/audio/footstep_recordings.ts'

describe('recorded material footsteps', () => {
  test('disabling footsteps prevents cadence from opening an audio context', () => {
    let context_requests = 0
    const footsteps = create_footsteps(
      () => 0.5,
      () => {
        context_requests += 1
        return null
      }
    )
    footsteps.set_enabled(false)
    footsteps.tick({ position: [0, 0, 0], on_ground: true, preset: 'grass', speed: 5 })
    footsteps.tick({ position: [1, 0, 0], on_ground: true, preset: 'grass', speed: 5 })

    expect(context_requests).toBe(0)
  })

  test('running increases impact energy and pitch without changing the preset', () => {
    const walking = footstep_dynamics(4.8)
    const running = footstep_dynamics(10.5)
    expect(running.impact).toBeGreaterThan(walking.impact)
    expect(running.pitch).toBeGreaterThan(walking.pitch)
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

  test('every terrain material has recordings instead of synthesized noise', () => {
    expect(Object.keys(FOOTSTEP_RECORDINGS).sort()).toEqual([...MATERIAL_PRESETS].sort())
    MATERIAL_PRESETS.forEach((preset) => {
      const first = pick_footstep_recording(preset, undefined, () => 0)!
      const second = pick_footstep_recording(preset, first.variant, () => 0)!
      expect(first.key).not.toBe(second.key)
      expect(FOOTSTEP_AUDIO_ASSETS[first.key]).toBe(first.source)
      expect(FOOTSTEP_RECORDINGS[preset].gain).toBeGreaterThan(0)
      expect(FOOTSTEP_RECORDINGS[preset].gain).toBeLessThan(0.5)
    })
  })

  test('a failed variant cannot starve the other recordings for its material', () => {
    const remaining = 'step-grass-dry-2'
    expect(
      pick_footstep_recording(
        'grass',
        undefined,
        () => 0,
        (key) => key === remaining
      )?.key
    ).toBe(remaining)
    expect(
      pick_footstep_recording(
        'grass',
        2,
        () => 0,
        (key) => key === remaining
      )?.key
    ).toBe(remaining)
    expect(
      pick_footstep_recording(
        'grass',
        undefined,
        () => 0,
        () => false
      )
    ).toBeNull()
  })

  test('teleports and air travel never create a catch-up footstep', () => {
    const started = advance_footstep_cadence(create_footstep_cadence(), { x: 0, z: 0, on_ground: true })
    const teleported = advance_footstep_cadence(started.cadence, { x: 100, z: 0, on_ground: true })
    expect(teleported.fired).toBeFalse()
    expect(teleported.cadence.distance).toBe(0)
    expect(advance_footstep_cadence(teleported.cadence, { x: 101, z: 0, on_ground: true }).fired).toBeFalse()
  })
})
