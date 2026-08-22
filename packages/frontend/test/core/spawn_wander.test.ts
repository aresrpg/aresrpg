// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LEASH. A wandering mob that drifts is not a cosmetic bug: the engage door proves the walk
// against the GROUP's chain coordinates, so a pack that ambled away would offer an attack the
// transaction refuses. The leash holds by construction (waypoints orbit the spawn anchor, never
// the live position), and this seals it against the obvious future "improvement" of walking from
// wherever the member happens to be.

import { describe, expect, test } from 'bun:test'
import { mulberry } from '@aresrpg/engine'

import {
  group_ring,
  group_label_anchor,
  seated_group_ring,
  start_wander,
  step_wander,
  wander_seed,
  WANDER_SPEED,
} from '../../src/game/core/spawn_wander.ts'

const anchor = { x: 100, z: 200, yaw: 0 }
const drift = (state: { x: number; z: number }) => Math.hypot(state.x - anchor.x, state.z - anchor.z)

/** Ten simulated minutes at 60fps — far past any decision cycle. */
const run = (seed: number, seconds = 600) => {
  const random = mulberry(seed)
  let state = start_wander(anchor, random)
  let furthest = 0
  for (let tick = 0; tick < seconds * 60; tick += 1) {
    state = step_wander(state, 1 / 60, random)
    furthest = Math.max(furthest, drift(state))
  }
  return { state, furthest }
}

describe('a member ambles around its spawn point and never leaves it', () => {
  test('ten minutes of wandering stays inside the leash, for every seed', () => {
    for (const seed of [1, 7, 42, 1_337, 99_999]) expect(run(seed).furthest).toBeLessThanOrEqual(3.5)
  })

  test('it actually MOVES — a leash that never lets go is just a still mob', () => {
    const { furthest } = run(7, 120)

    expect(furthest).toBeGreaterThan(0.5)
  })

  test('the pace is a graze, never a slide', () => {
    const random = mulberry(3)
    let state = start_wander(anchor, random)
    let fastest = 0
    for (let tick = 0; tick < 60 * 60; tick += 1) {
      const next = step_wander(state, 1 / 60, random)
      fastest = Math.max(fastest, Math.hypot(next.x - state.x, next.z - state.z) * 60)
      state = next
    }
    // a constant-speed step clamped to the remaining distance can never exceed the pace
    expect(fastest).toBeLessThanOrEqual(WANDER_SPEED + 1e-9)
  })

  test('a long frame hitch does not teleport anyone past the waypoint', () => {
    const random = mulberry(11)
    let state = start_wander(anchor, random)
    // walk it into a decision, then hand it a 2-second frame
    for (let tick = 0; tick < 300; tick += 1) state = step_wander(state, 1 / 60, random)
    const hitched = step_wander(state, 2, random)

    expect(drift(hitched)).toBeLessThanOrEqual(3.5)
  })

  test('members of one group are out of phase, and identical across reloads', () => {
    const seeds = [0, 1, 2, 3].map((member) => wander_seed(12, member))
    expect(new Set(seeds).size).toBe(4)

    // the same group and ordinal always seeds the same amble — a reload never teleports a pack
    expect(wander_seed(12, 2)).toBe(seeds[2]!)

    const positions = seeds.map((seed) => {
      const random = mulberry(seed)
      let state = start_wander(anchor, random)
      for (let tick = 0; tick < 600; tick += 1) state = step_wander(state, 1 / 60, random)
      return `${state.x.toFixed(3)}:${state.z.toFixed(3)}`
    })
    expect(new Set(positions).size).toBeGreaterThan(1)
  })
})

describe('a group stands as a pack', () => {
  test('the pack label rides the live centroid above its tallest member', () => {
    expect(
      group_label_anchor([
        { x: 0, y: 1, z: 0 },
        { x: 3, y: 2, z: 6 },
        { x: 6, y: 4, z: 3 },
      ])
    ).toEqual({ x: 3, y: 6, z: 3 })
  })

  test('a lone mob stands on the chain point; a pack rings it snugly', () => {
    expect(group_ring(1)).toEqual([{ dx: 0, dz: 0, yaw: 0.7 + Math.PI }])

    for (const size of [2, 3, 4, 5, 6]) {
      const ring = group_ring(size)
      expect(ring).toHaveLength(size)
      for (const seat of ring) expect(Math.hypot(seat.dx, seat.dz)).toBeLessThanOrEqual(2.6)
    }
  })

  test('the whole pack — ring plus leash — stays within engage range of the chain point', () => {
    // ring radius 2.6 + leash 3.5: a member is never further from the group point than this, so
    // a player standing at a rendered mob is standing at the coordinates the chain will check
    const random = mulberry(5)
    const seat = group_ring(6)[3]!
    let state = start_wander({ x: anchor.x + seat.dx, z: anchor.z + seat.dz, yaw: seat.yaw }, random)
    let furthest = 0
    for (let tick = 0; tick < 600 * 60; tick += 1) {
      state = step_wander(state, 1 / 60, random)
      furthest = Math.max(furthest, drift(state))
    }
    expect(furthest).toBeLessThanOrEqual(2.6 + 3.5)
  })

  test('a pack rotates around its chain point to keep every initial body on one terrace', () => {
    const ground_height = (x: number, _z: number): number => Math.floor(x) * 4
    const ring = seated_group_ring(2, 0, 0, ground_height)
    const heights = ring.map(({ dx, dz }) => ground_height(dx, dz))

    expect(new Set(heights).size).toBe(1)
    expect(Math.hypot(ring[0]!.dx - ring[1]!.dx, ring[0]!.dz - ring[1]!.dz)).toBeGreaterThan(3)
  })
})
