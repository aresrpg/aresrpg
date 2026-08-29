// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { chain_to_client_coordinate, world_center } from '@aresrpg/immutable'

import {
  chain_anchor_changed,
  create_owned_position_cache,
  create_position_writer,
  resolve_world_boot_position,
  resume_position,
  type SavedPosition,
} from '../../../src/game/core/position_store.ts'
import {
  owned_character_position,
  reset_owned_character_positions_for_testing,
} from '../../../src/game/core/owned_character_feed.ts'
import { reset_party_follow_for_testing, update_party_follow } from '../../../src/game/core/party_follow_feed.ts'

const anchor = Object.freeze({ x: 100, z: 200, at_ms: 1_000 })
const saved: SavedPosition = Object.freeze({ x: 12, y: 64, z: 34, saved_at: 50_000, anchor })

test('the saved pose resumes only while it explains itself against the chain anchor', () => {
  expect(resume_position(saved, anchor, 60_000)).toEqual({ x: 12, y: 64, z: 34 })
  // chain truth moved — the checkpoint wins
  expect(resume_position(saved, { ...anchor, at_ms: 2_000 }, 60_000)).toBeNull()
  expect(resume_position(saved, { ...anchor, x: 101 }, 60_000)).toBeNull()
  // too old — the checkpoint wins
  expect(resume_position(saved, anchor, 50_000 + 31 * 60 * 1000)).toBeNull()
  expect(resume_position(null, anchor, 60_000)).toBeNull()
  expect(resume_position(saved, null, 60_000)).toBeNull()

  const rooted_anchor = Object.freeze({ x: 100, z: 200, at_ms: 70_000 })
  expect(resume_position({ ...saved, x: 103.68, z: 200, anchor: rooted_anchor }, rooted_anchor, 60_000)).toBeNull()
  expect(resume_position({ ...saved, x: 100, z: 200, anchor: rooted_anchor }, rooted_anchor, 60_000)).toEqual({
    x: 100,
    y: 64,
    z: 200,
  })
})

test('a gather or ambush checkpoint change invalidates the live visual target immediately', () => {
  expect(chain_anchor_changed(anchor, anchor)).toBeFalse()
  expect(chain_anchor_changed(anchor, { ...anchor, at_ms: 13_000 })).toBeTrue()
  expect(chain_anchor_changed(anchor, { ...anchor, x: 103 })).toBeTrue()
  expect(chain_anchor_changed(null, anchor)).toBeTrue()
})

test('world boot resolves its real target before chunk scheduling starts', async () => {
  let loaded = false
  const resolved = await resolve_world_boot_position({
    checkpoint: { x: 100, z: 200 },
    chain_anchor: anchor,
    load: async () => {
      loaded = true
      return { ...saved, saved_at: Date.now() }
    },
  })
  expect(loaded).toBeTrue()
  expect(resolved).toEqual({ x: 12, z: 34 })
})

test('a live owned position wins without reading an older IndexedDB row', async () => {
  let loaded = false
  const resolved = await resolve_world_boot_position({
    live: { x: 77, z: 88 },
    checkpoint: { x: 100, z: 200 },
    chain_anchor: anchor,
    load: async () => {
      loaded = true
      return saved
    },
  })
  expect(loaded).toBeFalse()
  expect(resolved).toEqual({ x: 77, z: 88 })
})

test('the writer coalesces movement into interval writes plus a trailing settle write', async () => {
  const writes: { character_id: string; row: SavedPosition }[] = []
  let clock = 0
  const writer = create_position_writer({
    save: (identity, row) => void writes.push({ character_id: identity.character_id, row }),
    interval_ms: 1_000,
    settle_ms: 10,
    now: () => clock,
  })

  clock = 1_000
  writer.note({ x: 1, y: 0, z: 1 }, anchor, { character_id: '0xa', world: 'overworld' })
  clock = 1_100
  writer.note({ x: 2, y: 0, z: 2 }, anchor, { character_id: '0xa', world: 'overworld' })
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ character_id: '0xa', row: { x: 1, z: 1 } })

  await new Promise((resolve) => setTimeout(resolve, 25)) // the settle timer flushes the held pose
  expect(writes).toHaveLength(2)
  expect(writes[1]).toMatchObject({ character_id: '0xa', row: { x: 2, z: 2, anchor } })

  writer.flush() // nothing pending — no duplicate write
  expect(writes).toHaveLength(2)
})

test('a trailing write keeps the identity captured with its pose', async () => {
  const writes: string[] = []
  const writer = create_position_writer({
    save: (identity) => void writes.push(identity.character_id),
    interval_ms: 10_000,
    settle_ms: 10,
    now: () => 1,
  })
  writer.note({ x: 1, y: 0, z: 1 }, anchor, { character_id: '0xa', world: 'overworld' })
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(writes).toEqual(['0xa'])
})

test('discard cancels a pending local position instead of persisting it after disconnect', async () => {
  const writes: string[] = []
  const writer = create_position_writer({
    save: (identity) => void writes.push(identity.character_id),
    interval_ms: 10_000,
    settle_ms: 10,
    now: () => 1,
  })
  writer.note({ x: 1, y: 0, z: 1 }, anchor, { character_id: '0xa', world: 'overworld' })
  writer.discard()
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(writes).toEqual([])
})

test('the owned cache persists each follower and invalidates its resume on disconnect', async () => {
  const saved_rows: { character_id: string; row: SavedPosition }[] = []
  const removed: string[] = []
  const storage = {
    load: async () => null,
    save: async (character_id: string, _world: string, row: SavedPosition) => {
      saved_rows.push({ character_id, row })
    },
    remove: async (character_id: string) => {
      removed.push(character_id)
    },
  }
  const cache = create_owned_position_cache({ storage, on_error: () => undefined })
  const character = (id: string) =>
    ({ id, world: 'nauvis', checkpoint_world: 'nauvis', x: world_center, z: world_center, at_ms: 1 }) as never

  cache.note(character('0xa'), {
    character_id: '0xa',
    world: 'nauvis',
    x: world_center + 7,
    y: 3,
    z: world_center + 9,
  })
  cache.note(character('0xb'), {
    character_id: '0xb',
    world: 'nauvis',
    x: world_center + 11,
    y: 4,
    z: world_center + 13,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(saved_rows.map(({ character_id }) => character_id)).toEqual(['0xa', '0xb'])
  expect(saved_rows[0]?.row).toMatchObject({
    x: chain_to_client_coordinate(world_center + 7),
    y: 3,
    z: chain_to_client_coordinate(world_center + 9),
  })

  cache.invalidate([character('0xa'), character('0xb')])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(removed).toEqual(['0xa', '0xb'])
})

test('follow resumes a saved follower instead of its older chain checkpoint', async () => {
  reset_owned_character_positions_for_testing()
  reset_party_follow_for_testing()
  const follower = {
    id: '0xb',
    world: 'nauvis',
    checkpoint_world: 'nauvis',
    x: world_center,
    z: world_center,
    at_ms: 1,
  } as never
  const storage = {
    load: async () => ({
      x: chain_to_client_coordinate(world_center + 23),
      y: 4,
      z: chain_to_client_coordinate(world_center + 29),
      saved_at: Date.now(),
      anchor: { x: world_center, z: world_center, at_ms: 1 },
    }),
    save: async () => undefined,
    remove: async () => undefined,
  }
  const cache = create_owned_position_cache({
    storage,
    on_error: () => undefined,
  })

  await cache.restore([follower])
  const followed = update_party_follow(
    {
      party_id: '0xp',
      leader_id: '0xa',
      world: 'nauvis',
      target: { x: world_center + 50, y: 4, z: world_center + 50 },
      followers: [{ character_id: '0xb', x: world_center, y: 0, z: world_center }],
    },
    1_000
  )

  expect(followed.followers[0]).toMatchObject({
    character_id: '0xb',
    world: 'nauvis',
    x: world_center + 23,
    y: 4,
    z: world_center + 29,
  })
})

test('a reconnect restore waits for disconnect invalidation', async () => {
  reset_owned_character_positions_for_testing()
  let removed = false
  const follower = {
    id: '0xb',
    world: 'nauvis',
    checkpoint_world: 'nauvis',
    x: world_center,
    z: world_center,
    at_ms: 1,
  } as never
  const storage = {
    load: async () =>
      removed
        ? null
        : {
            x: 23,
            y: 4,
            z: 29,
            saved_at: Date.now(),
            anchor: { x: world_center, z: world_center, at_ms: 1 },
          },
    save: async () => undefined,
    remove: async () => {
      removed = true
    },
  }
  const cache = create_owned_position_cache({ storage, on_error: () => undefined })

  cache.invalidate([follower])
  await cache.restore([follower])

  expect(removed).toBeTrue()
  expect(owned_character_position('0xb', 'nauvis')).toBeNull()
})
