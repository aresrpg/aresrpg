// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL PILOT — proves the browserful flight edge headlessly (every effect injected, like auto_run.test.js's
// harness): position integration was already covered indirectly via embed wiring, but FACING never was — v2
// (#370) is the RED-FIRST pin for that gap.
//
// THE BUG (owner live report, .46 screenshot: the dragon rendered sideways/backwards): embed_voxel_player.js
// poses the mount with `t.facing_yaw`, read off ctl.get_transform(). ctl.teleport() (what the pilot drives the
// body with, every frame) ZEROES the controller's velocity, and facing_yaw is only ever recomputed inside
// step_controller() — called from tick(), which fast-travel flight never calls (the exact same frozen-state
// class of bug #343 already fixed for t.speed via mount_is_moving). So facing_yaw sits frozen at whatever the
// player was facing on the ground the instant before takeoff, for the WHOLE flight. The fix: the pilot tracks
// its OWN heading from the flight path's segment direction and exposes it via `yaw()`; embed_voxel_player.js
// now reads THAT while flying instead of the frozen transform. This file pins the pilot's `yaw()` output
// directly — before this lane, `yaw` didn't exist on the returned handle at all (a TypeError, definitionally
// red) and nothing anywhere read `flight_step`'s already-correct segment yaw.
import { describe, expect, test } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): same guard as fast_travel_flight.test.js / mount_rig.test.js — this module chains
// into fast_travel_flight.js → @aresrpg/engine3/player, unreachable without the absent-by-design GLB.
const { create_fast_travel_pilot } = SENSHI_MALE_GLB_AVAILABLE ? await import('./fast_travel_pilot.js') : {}
const { steer_to } = SENSHI_MALE_GLB_AVAILABLE ? await import('./auto_run.js') : {}
const { initial_ft_state, reduce_fast_travel } = SENSHI_MALE_GLB_AVAILABLE
  ? await import('../world-shell/fast_travel_store.js')
  : {}

const begin = { type: 'begin', character_id: 'C_TARGET', name: 'Rider' }
const resolved = (x, z) => ({
  type: 'resolved',
  world_id: 'W_MINE',
  x,
  z,
  live: false,
  my_world_id: 'W_MINE',
  my_level: 30,
  required_level: 1,
  catalog_has_world: true,
  character_id: 'C_TARGET',
})

/** A driveable pilot with injected effects + a controllable launch position/ground — mirrors auto_run.test.js's
 *  harness() pattern. Reaches 'flying' via the REAL reducer (same-world begin→resolved) so the target shape is
 *  never hand-guessed. @param {{ start?: [number,number,number], target_x?: number, target_z?: number, ground?: () => number|null }} [opts] */
function harness({ start = [0, 8, 0], target_x = 1000, target_z = 0, ground = () => 8 } = {}) {
  let ft = reduce_fast_travel(reduce_fast_travel(initial_ft_state(), begin), resolved(target_x, target_z))
  const teleports = []
  const calls = { mounted: 0, unmounted: 0 }
  const pilot = create_fast_travel_pilot({
    get_ft: () => ft,
    dispatch: (input) => {
      ft = reduce_fast_travel(ft, input)
    },
    get_pos: () => start,
    sample_ground: ground,
    mount_dragon: () => {
      calls.mounted += 1
    },
    unmount_dragon: () => {
      calls.unmounted += 1
    },
    teleport: (p) => teleports.push(p),
  })
  return { pilot, teleports, calls, get_phase: () => ft.phase, retarget: (x, z) => (ft = reduce_fast_travel(ft, { type: 'retarget', x, z })) }
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('create_fast_travel_pilot — v2 (#370): own flight facing, not the frozen controller yaw', () => {
  test('after takeoff the pilot faces the segment direction toward the target', () => {
    const { pilot } = harness({ start: [0, 8, 0], target_x: 1000, target_z: 0 })
    pilot.update(1 / 60)
    const { yaw: expected } = steer_to(0, 0, 1000, 0) // px,pz = start[0],start[2]
    expect(pilot.yaw()).toBeCloseTo(expected, 6)
  })
  test('facing tracks a DIFFERENT segment direction for a different launch/target pair (derived from the vector, not a constant)', () => {
    const { pilot } = harness({ start: [10, 20, -10], target_x: 40, target_z: 50 })
    pilot.update(1 / 60)
    const { yaw: expected } = steer_to(10, -10, 40, 50)
    expect(pilot.yaw()).toBeCloseTo(expected, 6)
  })
  test('facing stays locked to the segment direction across many frames of straight cruise (no drift)', () => {
    const { pilot } = harness({ start: [0, 8, 0], target_x: 1000, target_z: 0 })
    const { yaw: expected } = steer_to(0, 0, 1000, 0)
    for (let i = 0; i < 120; i++) pilot.update(1 / 60) // 2s — position barely moves the segment vector
    expect(pilot.yaw()).toBeCloseTo(expected, 3)
  })
  test('a live retarget eases the facing toward the NEW segment direction rather than snapping instantly (smooth turns)', () => {
    const { pilot, retarget } = harness({ start: [0, 8, 0], target_x: 1000, target_z: 0 })
    pilot.update(1 / 60) // establish initial facing (+x-ish)
    const before = pilot.yaw()
    retarget(0, 1000) // the peer jumped to a perpendicular heading (+z-ish) — a sharp turn
    pilot.update(1 / 60) // one small frame
    const { yaw: new_target } = steer_to(0, 0, 0, 1000)
    // one small-dt frame must NOT already equal the new heading — it eases toward it (still between the two).
    expect(pilot.yaw()).not.toBeCloseTo(new_target, 2)
    const towards_new = Math.abs(pilot.yaw() - before) > 1e-6
    expect(towards_new).toBe(true)
    // ...but converges to it given enough frames.
    for (let i = 0; i < 300; i++) pilot.update(1 / 60)
    expect(pilot.yaw()).toBeCloseTo(new_target, 2)
  })
  test('yaw resets to snap-fresh (no stale ease) on a NEW flight after a drop', () => {
    const h1 = harness({ start: [0, 8, 0], target_x: 1000, target_z: 0 })
    h1.pilot.update(1 / 60)
    h1.pilot.dispose() // force-drop mid-flight
    expect(h1.pilot.yaw()).toBe(0) // no flight tracked — never a leftover heading from the torn-down flight

    const h2 = harness({ start: [0, 8, 0], target_x: 0, target_z: -500 }) // a totally different heading
    h2.pilot.update(1 / 60)
    const { yaw: expected } = steer_to(0, 0, 0, -500)
    expect(h2.pilot.yaw()).toBeCloseTo(expected, 6) // snaps straight to the new segment — no residual blend
  })
})
