// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION — the mob FEET-Y convention (world mobs spawned 1 block BELOW the
// terrain surface; instrumented capture on real gen: controller feet 129, terrain top face 129, mounted rig
// 128). The law this locks: a feet-origin rig's mounted y is NEVER below the ground's top face, and equals
// the exact y `find_open_spawn` gives the local controller for the same column (one convention across
// player / remotes / chain mobs). Runs the REAL functions (engine spawn scan + the app's feet_of) over a
// synthetic streamed world. (The roam-resample variant of this test died with TR-3 ambient mobs 2026-07-10 —
// design decision: no ambient mobs, only on-chain ones; feet_of itself is chain-mob/remote-player
// shared infra and stays live.)

import { describe, expect, it } from 'bun:test'

import { feet_of } from './ambient_placement.js'
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): @aresrpg/engine3/player (character_controller.js) unconditionally re-exports
// create_character_avatar, which static-imports the absent-by-design senshi_male.glb — see
// test_helpers/glb_fixture.js.
const { find_open_spawn, ground_surface_y } = SENSHI_MALE_GLB_AVAILABLE ? await import('@aresrpg/engine3/player') : {}

// Synthetic flat world: grass (id 1) up to y=63, air above — ground block 63, TOP FACE (feet) 64.
const GROUND_Y = 63
const flat = (x, y, z) => (y <= GROUND_Y ? 1 : 0)

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('mob grounding — the feet-y convention', () => {
  it('mounted feet y == find_open_spawn feet y == ground top face (never inside the ground)', () => {
    const spot = find_open_spawn(flat, 10, 10, 4)
    expect(spot).not.toBeNull()
    const [, controller_feet_y] = /** @type {[number, number, number]} */ (spot)

    // the feet-origin mount path: feet_of over the raw scan — must equal the controller's feet EXACTLY
    const mounted_y = feet_of(ground_surface_y(flat, 10, 10))
    expect(mounted_y).toBe(controller_feet_y)
    expect(mounted_y).toBe(GROUND_Y + 1) // the top face — standing ON it, not IN the block below
    // the pre-fix bug: mounting at the raw scan y put the rig one block under
    expect(ground_surface_y(flat, 10, 10)).toBe(mounted_y - 1)
  })

  it('feet_of propagates null (unstreamed / fluid columns place nothing)', () => {
    expect(feet_of(null)).toBeNull()
    const water_column = (x, y, z) => (y <= 60 ? 2 : y <= 64 ? 5 : 0) // dirt below, WATER 61..64
    expect(ground_surface_y(water_column, 0, 0)).toBeNull() // fluid-topped column → no mount
    expect(feet_of(ground_surface_y(water_column, 0, 0))).toBeNull()
  })
})
