// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { create_character_controller } from '../../src/game/core/character.ts'
import { eject_from_solid, resolve_movement, type SolidFn } from '../../src/game/core/collision.ts'
import { CONTROLLER_CONSTANTS, create_controller_state, step_controller } from '../../src/game/core/controller.ts'

// Synthetic worlds: a flat floor at y=0 (solid below), with optional walls/steps.
const flat: SolidFn = (_x, y) => y < 0
const no_liquid = () => false
const env = { solid_at: flat, liquid_at: no_liquid }

const run_steps = (state: ReturnType<typeof create_controller_state>, input: object, steps: number) => {
  const full = { forward: 0, strafe: 0, jump: false, glide: false, walk: false, speed_scale: 1, yaw: 0, ...input }
  let [, peak_y] = state.position
  for (let i = 0; i < steps; i += 1) {
    step_controller(state, full, env, 1 / 60)
    peak_y = Math.max(peak_y, state.position[1])
  }
  return peak_y
}

describe('collision solver (legacy port)', () => {
  test('auto-climbs a 1-block step, refuses a 2-block wall', () => {
    const stepped: SolidFn = (x, y) => y < 0 || (x >= 2 && y < 1)
    const walled: SolidFn = (x, y) => y < 0 || (x >= 2 && y < 2)
    const climb = resolve_movement(stepped, [1.5, 0, 0.5], [4, 0, 0], 0.2)
    expect(climb.stepped).toBeTrue()
    expect(climb.position[1]).toBeCloseTo(1, 1)
    const blocked = resolve_movement(walled, [1.5, 0, 0.5], [4, 0, 0], 0.2)
    expect(blocked.velocity[0]).toBe(0) // wall kills X…
    expect(blocked.position[1]).toBeCloseTo(0, 3) // …and no climb happened
  })

  test('slides along a wall instead of dead-stopping', () => {
    const wall: SolidFn = (x, y) => y < 0 || x >= 2
    const result = resolve_movement(wall, [1.5, 0, 0.5], [3, 0, 3], 0.1)
    expect(result.velocity[0]).toBe(0)
    expect(result.position[2]).toBeCloseTo(0.8, 3) // Z advanced the full 0.3
  })

  test('eject lifts a buried spawn to the surface', () => {
    const [, y] = eject_from_solid((_x, cy) => cy < 5, [0.5, 1, 0.5])
    expect(y).toBeGreaterThanOrEqual(5)
  })
})

describe('locomotion (legacy feel constants)', () => {
  test('reaches run speed and stops with a minimal glide', () => {
    const state = create_controller_state([0.5, 0, 0.5])
    run_steps(state, { forward: 1 }, 120)
    expect(state.speed).toBeCloseTo(CONTROLLER_CONSTANTS.RUN_SPEED, 0)
    const [, , release_z] = state.position // forward under yaw 0 = −Z (legacy basis)
    run_steps(state, {}, 60)
    expect(state.speed).toBe(0)
    const glide = Math.abs(state.position[2] - release_z)
    expect(glide).toBeGreaterThan(0.1) // a present, minimal slide…
    expect(glide).toBeLessThan(0.6) // …never ice (the S-73v2 band)
  })

  test('mounted movement scales the canonical run speed by 1.5', () => {
    const state = create_controller_state([0.5, 0, 0.5])
    run_steps(state, { forward: 1, speed_scale: 1.5 }, 120)
    expect(state.speed).toBeCloseTo(CONTROLLER_CONSTANTS.RUN_SPEED * 1.5, 0)
  })

  test('jump reaches the approved apex, double-jump bounces higher', () => {
    const state = create_controller_state([0.5, 0, 0.5])
    run_steps(state, {}, 5) // settle grounded
    const single_peak = run_steps(state, { jump: true }, 40)
    expect(single_peak).toBeCloseTo(CONTROLLER_CONSTANTS.JUMP_APEX_M, 0)
    // fresh body: jump, release mid-air, press again → the one air bounce
    const doubled = create_controller_state([0.5, 0, 0.5])
    run_steps(doubled, {}, 5)
    const rise = run_steps(doubled, { jump: true }, 12)
    run_steps(doubled, {}, 2)
    const bounce_peak = Math.max(rise, run_steps(doubled, { jump: true }, 60))
    expect(bounce_peak).toBeGreaterThan(single_peak + 1)
  })

  test('a flying mount glides while jump remains held during descent', () => {
    const falling = create_controller_state([0.5, 10, 0.5])
    const gliding = create_controller_state([0.5, 10, 0.5])
    falling.velocity[1] = -5
    gliding.velocity[1] = -5
    run_steps(falling, {}, 5)
    run_steps(gliding, { jump: true, glide: true }, 5)

    expect(gliding.velocity[1]).toBeGreaterThan(falling.velocity[1])
    expect(gliding.position[1]).toBeGreaterThan(falling.position[1])
  })

  test('swim mode floats in liquid', () => {
    const water_env = { solid_at: ((_x: number, y: number) => y < -10) as SolidFn, liquid_at: () => true }
    const state = create_controller_state([0.5, 0, 0.5])
    const full = { forward: 0, strafe: 0, jump: true, glide: false, walk: false, speed_scale: 1, yaw: 0 }
    for (let i = 0; i < 30; i += 1) step_controller(state, full, water_env, 1 / 60)
    expect(state.anim).toBe('SWIM')
    expect(state.velocity[1]).toBeGreaterThan(0) // holding jump = buoyant rise
  })
})

describe('character facade', () => {
  test('spawns ejected from solid and walks under fixed-step interpolation', () => {
    const character = create_character_controller({
      solid_at: flat,
      liquid_at: no_liquid,
      position: [0.5, -5, 0.5], // buried on purpose
    })
    expect(character.get_transform().position[1]).toBeGreaterThanOrEqual(0)
    character.set_input({ forward: 1, yaw: 0 })
    character.tick(0.5)
    const transform = character.get_transform()
    expect(transform.position[2]).toBeLessThan(0.5) // forward = −Z under yaw 0 (legacy basis)
    expect(transform.speed).toBeGreaterThan(0)
  })

  test('rides projected ground and is pushed above relief restored underneath it', () => {
    const character = create_character_controller({ solid_at: flat, liquid_at: no_liquid, position: [0.5, 0, 0.5] })

    character.reconcile_ground(0, -5)
    expect(character.get_transform().position[1]).toBe(-5)
    character.reconcile_ground(-5, 7)
    const raised = character.get_transform()
    expect(raised.position[1]).toBe(7)
    expect(raised.velocity[1]).toBe(0)
    expect(raised.on_ground).toBeTrue()
  })

  test('restored relief pushes an intersecting airborne body but never pulls one down', () => {
    const intersecting = create_character_controller({
      solid_at: flat,
      liquid_at: no_liquid,
      position: [0.5, 1, 0.5],
    })
    intersecting.reconcile_ground(0, 4)
    expect(intersecting.get_transform().position[1]).toBe(4)

    const clear = create_character_controller({ solid_at: flat, liquid_at: no_liquid, position: [0.5, 9, 0.5] })
    clear.reconcile_ground(0, 4)
    expect(clear.get_transform().position[1]).toBe(9)
  })
})
