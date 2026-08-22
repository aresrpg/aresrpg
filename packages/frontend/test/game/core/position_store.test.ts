// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  create_position_writer,
  resolve_world_boot_position,
  resume_position,
  type SavedPosition,
} from '../../../src/game/core/position_store.ts'

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
