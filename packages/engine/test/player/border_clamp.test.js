// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [D204] the fence is PHYSICAL for the controller body — jump arcs blocked, escapees rescued.
import { describe, expect, test, test as d215_test, expect as d215_expect } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../../src/test_helpers/glb_fixture.js'

const { create_character_controller, create_character_controller: d215_create } = SENSHI_MALE_GLB_AVAILABLE
  ? await import('../../src/player/character_controller.js')
  : {}

const flat_world = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => (y <= 100 ? 1 : 0)
const bounds = { min_x: -160, min_z: -160, max_x: 192, max_z: 192 }

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('D204 border clamp + OOB net', () => {
  test('a jump arc toward the fence stops AT the fence (slides, never crosses)', () => {
    const ctl = create_character_controller({
      sample_block: flat_world,
      position: [190.5, 101, 0],
      yaw: 0,
      get_bounds: () => bounds,
    })
    // sprint +x into the wall while jumping, many steps — position must never exceed the fence
    ctl.set_input({ forward: 1, jump: true, yaw: -Math.PI / 2 }) // camera-yaw convention: forward = +x
    for (let i = 0; i < 240; i++) ctl.tick(1 / 60)
    const t = ctl.get_transform()
    expect(t.position[0]).toBeLessThanOrEqual(bounds.max_x - 0.35 + 1e-6)
    expect(t.position[0]).toBeGreaterThan(189) // still AT the wall region, not bounced across the map
  })

  test('an escapee far outside snaps back inside on the first tick (rescue net)', () => {
    const ctl = create_character_controller({
      sample_block: flat_world,
      position: [230, 101, 250],
      yaw: 0,
      get_bounds: () => bounds,
    })
    ctl.tick(1 / 60)
    const t = ctl.get_transform()
    expect(t.position[0]).toBeLessThanOrEqual(bounds.max_x - 0.35 + 1e-6)
    expect(t.position[2]).toBeLessThanOrEqual(bounds.max_z - 0.35 + 1e-6)
  })

  test('no bounds = unchanged behavior (option is opt-in)', () => {
    const ctl = create_character_controller({ sample_block: flat_world, position: [500, 101, 500], yaw: 0 })
    ctl.tick(1 / 60)
    expect(ctl.get_transform().position[0]).toBeCloseTo(500, 0)
  })
})

// [D215] fixed-step render interpolation — the pose between physics steps is smooth, never a snap.
// (d215_test/d215_expect/d215_create aliases are imported with the top-of-file bun:test +
// character_controller.js imports — kept as a single import/order group.)
d215_test.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
  'get_transform interpolates between fixed steps (D215 anti-jitter)',
  () => {
    const flat = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => (y <= 100 ? 1 : 0)
    const ctl = d215_create({ sample_block: flat, position: [0.5, 101, 0.5], yaw: 0 })
    ctl.set_input({ forward: 1, yaw: 0 }) // run -z
    for (let i = 0; i < 120; i++) ctl.tick(1 / 60) // reach full run speed on whole steps
    const [, , at_step] = ctl.get_transform().position
    ctl.tick(1 / 120) // HALF a fixed step — accumulator holds 0.5
    const [, , mid] = ctl.get_transform().position
    ctl.tick(1 / 120) // completes the step
    const [, , next] = ctl.get_transform().position
    // mid must sit strictly BETWEEN the two step poses (the old code returned at_step for mid = snap)
    d215_expect(mid).toBeLessThan(at_step)
    d215_expect(mid).toBeGreaterThan(next)
    d215_expect(Math.abs(mid - (at_step + next) / 2)).toBeLessThan(0.02) // ~midpoint
  }
)
