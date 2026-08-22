// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DISCOVERY PREDICATE. The prompt's pixels and the key's door read this one function, so a
// card can never offer a press the transaction would refuse — and the press can never fire on a
// zone that is already searched. A zone is unsearched exactly when the graph holds no row for
// it: absence IS the answer, because a searched zone is written the moment its seed is drawn.

import { afterEach, describe, expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'
import { world_center } from '@aresrpg/immutable'

import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { searchable_zone, zone_key } from '../../src/modules/world.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'
import type { GameSettings } from '../../src/game/core/settings.ts'

const settings: GameSettings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
})

const character = (world: string | undefined): CharacterRow =>
  ({ id: '0xc1', name: 'Aiden', world, jobs: {}, spells: {} }) as unknown as CharacterRow

/** The pose feed throttles to one publish per 50ms — a null clears the gate, so a test that
 *  moves the character twice in one tick must step through it rather than fight it. */
const at = (client_x: number, client_z: number) => {
  publish_pose(null)
  publish_pose({ x: client_x, y: 64, z: client_z, yaw: 0, time_of_day: 0.5 } as never)
}

/** A state standing somewhere, optionally with zones already known. */
const standing = (world: string | undefined, zones: AppState['world']['zones'] = {}): AppState => {
  const base = initial_app_state(settings)
  return Object.freeze({
    ...base,
    session: Object.freeze({ ...base.session, characters: [character(world)], selected_character_id: '0xc1' }),
    world: Object.freeze({ ...base.world, zones }),
  })
}

const row = (world: string, zx: number, zz: number) => ({
  world,
  zx,
  zz,
  seed: '7',
  searched_at_ms: 1,
  mob_taken: '0',
  res_taken: [],
})

afterEach(() => publish_pose(null))

describe('a zone is searchable exactly while it has no row', () => {
  test('standing in an unknown zone offers the search, with the CHARACTER own position', () => {
    at(0, 0) // client 0;0 is the world centre — the chain proves the walk against this
    expect(searchable_zone(standing('01_first_shore'))).toEqual({
      world: '01_first_shore',
      x: world_center,
      z: world_center,
    })
  })

  test('a zone that already has a row is not offered again', () => {
    at(0, 0)
    const { zx, zz } = { zx: Math.floor(world_center / 512), zz: Math.floor(world_center / 512) }
    const known = { [zone_key('01_first_shore', zx, zz)]: row('01_first_shore', zx, zz) }

    expect(searchable_zone(standing('01_first_shore', known))).toBeNull()
  })

  test('a NEIGHBOUR zone being searched does not satisfy the one under our feet', () => {
    at(0, 0)
    const { zx, zz } = { zx: Math.floor(world_center / 512), zz: Math.floor(world_center / 512) }
    const known = { [zone_key('01_first_shore', zx + 1, zz)]: row('01_first_shore', zx + 1, zz) }

    expect(searchable_zone(standing('01_first_shore', known))).not.toBeNull()
  })

  test('no pose, no world, and out-of-bounds ground all refuse rather than guess', () => {
    at(0, 0)
    // a character that never joined a world has no zone to search
    expect(searchable_zone(standing(undefined))).toBeNull()

    // past the world's low edge the chain has no zone at all — coordinates are unsigned
    at(-world_center - 10, 0)
    expect(searchable_zone(standing('01_first_shore'))).toBeNull()

    // before the walker's first frame there is no proven position to search from
    publish_pose(null)
    expect(searchable_zone(standing('01_first_shore'))).toBeNull()
  })
})
