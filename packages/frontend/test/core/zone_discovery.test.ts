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
import world, {
  searchable_zone,
  zone_discovery_arrived,
  zone_discovery_summary,
  zone_key,
  zone_search_arrived,
} from '../../src/modules/world.ts'
import { initial_app_state, type AppState } from '../../src/store.ts'
import type { GameSettings } from '../../src/game/core/settings.ts'

const settings: GameSettings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
  fight_access: 0,
})

const character = (world: string | undefined): CharacterRow =>
  ({
    id: '0xc1',
    name: 'Aiden',
    world,
    checkpoint_world: world,
    x: world_center,
    z: world_center,
    at_ms: 0,
    pet: false,
    equipment: [],
    jobs: {},
    spells: {},
  }) as unknown as CharacterRow

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

const row = (world: string, zx: number, zz: number, searched_at_ms = 1) => ({
  world,
  zx,
  zz,
  seed: '7',
  searched_at_ms,
  mob_taken: '0',
  res_taken: [],
})

afterEach(() => publish_pose(null))

describe('a zone is searchable before discovery and after the chain reroll TTL', () => {
  test('standing in an unknown zone offers the search, with the CHARACTER own position', () => {
    at(0, 0) // client 0;0 is the world centre — the chain proves the walk against this
    expect(searchable_zone(standing('01_first_shore'))).toEqual({
      key: zone_key('01_first_shore', Math.floor(world_center / 512), Math.floor(world_center / 512)),
      world: '01_first_shore',
      x: world_center,
      z: world_center,
      kind: 'discover',
      previous_searched_at_ms: null,
    })
  })

  test('a zone search is offered only when the chain checkpoint can prove the current walk', () => {
    at(100, 0)

    expect(searchable_zone(standing('01_first_shore'), 1_000)).toBeNull()
    expect(searchable_zone(standing('01_first_shore'), 9_000)).toMatchObject({
      x: world_center + 100,
      z: world_center,
    })
  })

  test('an accepted search hides its prompt immediately and a failed transaction re-arms it', () => {
    at(0, 0)
    const before = standing('01_first_shore')
    const target = searchable_zone(before)!
    const pending = world.reduce!(before, { type: 'world/search_zone', target })

    expect(searchable_zone(pending)).toBeNull()

    const failed = world.reduce!(pending, { type: 'world/search_zone_failed', key: target.key })
    expect(searchable_zone(failed)).toMatchObject({ key: target.key, kind: 'discover' })
  })

  test('a fresh zone row is not offered again', () => {
    at(0, 0)
    const { zx, zz } = { zx: Math.floor(world_center / 512), zz: Math.floor(world_center / 512) }
    const known = { [zone_key('01_first_shore', zx, zz)]: row('01_first_shore', zx, zz, 10_000) }

    expect(searchable_zone(standing('01_first_shore', known), 10_000 + 7_200_000 - 1)).toBeNull()
  })

  test('an expired zone row offers a reroll', () => {
    at(0, 0)
    const { zx, zz } = { zx: Math.floor(world_center / 512), zz: Math.floor(world_center / 512) }
    const known = { [zone_key('01_first_shore', zx, zz)]: row('01_first_shore', zx, zz, 10_000) }

    expect(searchable_zone(standing('01_first_shore', known), 10_000 + 7_200_000)).toMatchObject({ kind: 'reroll' })
  })

  test('reroll completion waits for a newer projected row', () => {
    const previous = row('01_first_shore', 1, 1, 10_000)

    expect(zone_search_arrived(previous, 10_000)).toBeFalse()
    expect(zone_search_arrived({ ...previous, searched_at_ms: 10_001 }, 10_000)).toBeTrue()
    expect(zone_search_arrived(previous, null)).toBeTrue()
  })

  test('discovery waits for population and reports mobs, resource nodes, and a dungeon', () => {
    const zone = row('01_first_shore', 1, 1, 10_001)
    const population = {
      mobs: [
        { index: 0, x: 1, z: 1, members: [{ mob_type: 'ant', level_scalar: 0 }] },
        {
          index: 1,
          x: 2,
          z: 2,
          members: [
            { mob_type: 'fuwa', level_scalar: 0 },
            { mob_type: 'fuwa', level_scalar: 0 },
          ],
        },
      ],
      resources: [
        { index: 0, x: 1, z: 1, item_type: 'wheat', nodes: 4 },
        { index: 1, x: 2, z: 2, item_type: 'aloe', nodes: 5 },
      ],
      portal: { x: 3, z: 3 },
    }

    expect(zone_discovery_arrived(zone, undefined, 10_000)).toBeFalse()
    expect(zone_discovery_arrived(zone, population, 10_000)).toBeTrue()
    expect(zone_discovery_summary(population)).toEqual({ mobs: 3, resources: 9, dungeon: true })
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

    at(world_center + 10, 0)
    expect(searchable_zone(standing('01_first_shore'))).toBeNull()

    // before the walker's first frame there is no proven position to search from
    publish_pose(null)
    expect(searchable_zone(standing('01_first_shore'))).toBeNull()
  })
})
