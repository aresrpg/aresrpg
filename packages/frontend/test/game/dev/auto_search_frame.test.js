// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2180 — the live Testlands frame is bounds 500,000 (offset 250,000 per axis) with 32-block zones.
// The incident position is inside the minimum ring, so the pure picker must refuse its containing zone.

import { describe, expect, test } from 'bun:test'
import { world_offsets, zone_of_world } from '@aresrpg/sdk/coords'

import { blank_auto_search, pick_zone } from '../../../src/game/dev/auto_search.js'

const LIVE_WORLD_DOC = { bounds_x: 500_000, bounds_z: 500_000, zone_size: 32 }
const INCIDENT_POSITION = { x: 632, z: -242 }

const live_world = () => {
  const offset = world_offsets(LIVE_WORLD_DOC)
  return {
    player: INCIDENT_POSITION,
    zone_size: LIVE_WORLD_DOC.zone_size,
    offset_x: offset.x,
    offset_z: offset.z,
    fresh_keys: [],
  }
}

describe('#2180 — the picker consumes one signed world frame', () => {
  test('a reset frame cannot produce a target before the live World doc calibrates it', () => {
    expect(
      pick_zone(blank_auto_search(), {
        ...live_world(),
        world_frame_ready: false,
        zone_size: 512,
        offset_x: 0,
        offset_z: 0,
      })
    ).toBeNull()
  })

  test('the live zone containing (632, -242) is refused when from_m is 1000', () => {
    const world = live_world()
    const containing = zone_of_world(
      INCIDENT_POSITION.x,
      INCIDENT_POSITION.z,
      world.zone_size,
      world.offset_x,
      world.offset_z
    )
    expect(containing).toEqual({ zx: 7832, zy: 7804 })

    const unrestricted = pick_zone({ ...blank_auto_search(), from_m: 0 }, world)
    expect(unrestricted).toMatchObject(containing)

    const ranged = pick_zone({ ...blank_auto_search(), from_m: 1000 }, world)
    expect(ranged).not.toMatchObject(containing)
    expect(Math.hypot(unrestricted.x, unrestricted.z)).toBeLessThan(1000)
  })
})
