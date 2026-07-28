// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1433 REGRESSION — "character walk plateaus ~24m from target, cannot close distance to a searched mob".
//
// The reported reason, reproduced mechanically: `step_controller` drove `vel[1]` to a constant
// −GRAVITY_UNDERWATER whenever the head was submerged, so a body that entered water sank to the SEABED and
// swam along it. On the seabed every underwater step taller than AUTO_STEP_HEIGHT (1.05) is an impassable
// wall — a player holding forward toward a mob across water dead-stops at the shelf face, forever, with no
// signal. The live repro on edge stalled at [-299.60, 120.00, 412.60] with velocity [0,0,0], in_water, 28.28 m
// short of the target, against solid blocks at y = 120/121/122 while the sea surface sat ~7 blocks higher.
//
// Mobs are already seated ON the water surface (spawn_rigs.js `resolve_group_seat` 'float' mode), so a body
// that floats is also what makes the renderer and the physics agree about where a thing in water sits.
//
// Pure — a synthetic block world, no three, no renderer (controller.test.js's own idiom).

import { describe, it, expect } from 'bun:test'

import { create_controller_state, step_controller } from '../../src/player/controller.js'
import { CHARACTER_HEIGHT } from '../../src/config/world_config.js'

const DT = 1 / 60

/**
 * The live stall's geometry as a synthetic world: a seabed at y=0 on the near side, a SHELF_H-block
 * underwater step at `shelf_z` and beyond (decreasing z = forward), sea surface at y=SEA.
 */
const SEA = 8
const SHELF_H = 3
const SHELF_Z = -10

const ocean_env = {
  solid_at: (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ z) =>
    y < 0 || (z <= SHELF_Z && y < SHELF_H),
  liquid_at: (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ z) =>
    !(y < 0 || (z <= SHELF_Z && y < SHELF_H)) && y < SEA,
}

/** Hold `input` for `seconds` and return the state. @param {any} state @param {any} input @param {number} seconds */
const hold = (state, input, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i += 1) step_controller(state, input, ocean_env, DT)
  return state
}

const swim_forward = { forward: 1, strafe: 0, jump: false, walk: false, yaw: 0 } // yaw 0 → −Z

describe('#1433 — a swimmer crosses an underwater shelf instead of plateauing against it', () => {
  it('reaches the far side of a 3-block underwater step while only holding forward', () => {
    const state = create_controller_state([0.5, 0, 0.5]) // feet on the seabed, head submerged
    hold(state, swim_forward, 8)
    expect(state.in_water).toBe(true)
    // 8 s at SWIM_SPEED covers ~80 m; the shelf face is 10 m out. Anything short of it is the plateau.
    expect(state.position[2]).toBeLessThan(SHELF_Z - 5)
  })

  it('surfaces instead of sinking to the seabed: a submerged body rises to the water line and holds there', () => {
    const state = create_controller_state([0.5, 0, 0.5])
    hold(state, { forward: 0, strafe: 0, jump: false, walk: false, yaw: 0 }, 6)
    // The head comes to rest IN the topmost water cell — off the floor, still in the sea, not launched
    // out of it. `head_y = feet + CHARACTER_HEIGHT * 0.9` is the submersion probe the controller uses.
    const head_y = state.position[1] + CHARACTER_HEIGHT * 0.9
    expect(head_y).toBeGreaterThan(SEA - 1)
    expect(head_y).toBeLessThan(SEA)
  })

  it('still dives while the walk key is held — the surface is a resting state, not a ceiling', () => {
    const state = create_controller_state([0.5, SEA - 2, 0.5])
    hold(state, { forward: 0, strafe: 0, jump: false, walk: true, yaw: 0 }, 3)
    expect(state.position[1]).toBeCloseTo(0, 2) // back on the seabed (within the resolver's skin width)
  })
})
