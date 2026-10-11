// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_character_controller } from '../../../src/game/core/character.ts'
import {
  CONTROLLER_CONSTANTS,
  create_controller_state,
  is_gliding,
  step_controller,
  type ControllerInput,
} from '../../../src/game/core/controller.ts'

const air = { solid_at: () => false, liquid_at: () => false }
const held: ControllerInput = { forward: 0, strafe: 0, yaw: 0, speed_scale: 1.5, jump: true, glide: true, walk: false }
const falling = () => {
  const state = create_controller_state([0, 100, 0])
  state.velocity[1] = -2
  state._jump_was_down = true
  return state
}
const advance = (state: ReturnType<typeof falling>, input = held, frames = 1, env = air) => {
  for (let index = 0; index < frames; index++) step_controller(state, input, env, 1 / 60)
}

test('the glide delay uses real airborne time rather than the consumed coyote sentinel', () => {
  const state = falling()
  expect(state._since_ground).toBe(999)
  advance(state, held, 14)
  expect(is_gliding(state, held)).toBe(false)
  advance(state, held, 3)
  expect(is_gliding(state, held)).toBe(true)
  expect(state.velocity[1]).toBeGreaterThanOrEqual(CONTROLLER_CONSTANTS.GLIDE_TERMINAL_FALL)
})

test('holding jump preserves ascent; a fresh airborne press still spends the double jump', () => {
  const state = falling()
  state._airborne_seconds = 1
  state._jump_was_down = false
  advance(state)
  expect(state._air_jump_fired).toBe(true)
  expect(state.velocity[1]).toBeGreaterThan(0)
  expect(is_gliding(state, held)).toBe(false)
})

test('release, landing and water all end gliding', () => {
  const state = falling()
  advance(state, held, 30)
  expect(is_gliding(state, held)).toBe(true)
  const released = { ...held, jump: false, glide: false }
  advance(state, released)
  expect(is_gliding(state, released)).toBe(false)
  expect(state.velocity[1]).toBeLessThan(CONTROLLER_CONSTANTS.GLIDE_TERMINAL_FALL)
  state.position[1] = 0.001
  state._jump_was_down = true
  advance(state, held, 2, { ...air, solid_at: (_x = 0, y = 0) => y < 0 })
  expect(state.on_ground).toBe(true)
  expect(is_gliding(state, held)).toBe(false)
  const wet = falling()
  wet._airborne_seconds = 1
  advance(wet, held, 1, { ...air, liquid_at: () => true })
  expect(is_gliding(wet, held)).toBe(false)
  expect(wet._airborne_seconds).toBe(0)
})

test('teleporting clears the glide delay instead of carrying flight into a new checkpoint', () => {
  const character = create_character_controller({ ...air, position: [0, 100, 0] })
  character.set_input({ glide: true })
  for (let index = 0; index < 30; index++) character.tick(1 / 60)
  expect(character.get_transform().gliding).toBe(true)
  character.teleport([10, 100, 0])
  character.tick(1 / 60)
  expect(character.get_transform().gliding).toBe(false)
  character.dispose()
})
