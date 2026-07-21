// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #304 regression: load_world_gates rides the /v1 encyclopedia worlds view, never the chain-direct
// `read_worlds.js` batch fan-out it replaced (see fullnode_object_reads.test.js for the standing gate).
// Uses the REAL T62_WORLDS (real seeded ids) so no mock.module is needed for the deployment constant —
// only rpc/client's get_encyclopedia is spied, mirroring read_findables.test.js's idiom.

import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../../../rpc/client'
import { T62_WORLDS } from '../../../chain/deployment'

const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia')

afterEach(() => {
  get_encyclopedia.mockReset()
})
afterAll(() => {
  get_encyclopedia.mockRestore()
})

const { load_world_gates, _reset_for_test } = await import('./world_levels.js')

test('resolves required_level off /v1 encyclopedia?kind=worlds, labelled from T62_WORLDS', async () => {
  _reset_for_test()
  const [first, second] = T62_WORLDS
  get_encyclopedia.mockImplementation(async (kind) => {
    expect(kind).toBe('worlds')
    return {
      worlds: [{ world_id: first.id, seed: '1', biome: 'archipelago', required_level: 12 }],
      // `second` deliberately absent — not yet indexer-snapshotted.
    }
  })

  const gates = await load_world_gates()

  expect(get_encyclopedia).toHaveBeenCalledTimes(1)
  expect(gates).toContainEqual({ id: first.id, label: first.label, required_level: 12 })
  expect(gates.some((g) => g.id === second.id)).toBe(false)
})

test('a read failure degrades to an empty list and never throws', async () => {
  _reset_for_test()
  get_encyclopedia.mockImplementation(async () => {
    throw new Error('rpc unavailable')
  })

  await expect(load_world_gates()).resolves.toEqual([])
})

test('caches the resolved gates across calls (one /v1 fetch per session)', async () => {
  _reset_for_test()
  get_encyclopedia.mockImplementation(async () => ({
    worlds: T62_WORLDS.map(({ id }) => ({ world_id: id, seed: '1', biome: 'x', required_level: 1 })),
  }))

  const a = await load_world_gates()
  const b = await load_world_gates()

  expect(a).toBe(b) // same cached promise resolution — identity, not just deep-equal
  expect(get_encyclopedia).toHaveBeenCalledTimes(1)
})
