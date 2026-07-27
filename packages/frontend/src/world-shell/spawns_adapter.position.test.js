// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST: the live player position already enters the spawns atom through `player_pos`; this suite pins the
// missing persistence edge around that door. IndexedDB is driven with its real request/transaction callback
// protocol so save → module-memory reset → restore proves the reload contract, not an in-memory shortcut.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { publish_world_binding, reset_world_binding } from './session_gate.js'

const CHARACTER = '0xCHARACTER'
const WORLD_A = '0xWORLD_A'
const WORLD_B = '0xWORLD_B'
const NOW = 1_800_000_000_000
const OFFSET = 1_000

// ── minimal IndexedDB double (same request/transaction shape as simulator/persistence.test.ts) ────────────────
const create_fake_idb = () => {
  const data = new Map()
  const store_of = (name) => {
    const rows = data.get(name) ?? new Map()
    data.set(name, rows)
    return rows
  }
  const settle = (request) => queueMicrotask(() => request.onsuccess?.())
  const object_store = (name) => ({
    get: (key) => {
      const request = { result: store_of(name).get(key) }
      settle(request)
      return request
    },
    put: (value, key) => {
      store_of(name).set(key, structuredClone(value))
      const request = { result: key }
      settle(request)
      return request
    },
  })
  return {
    open: () => {
      const request = {}
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: (name) => data.has(name) },
          createObjectStore: (name) => store_of(name),
          transaction: () => {
            const tx = { objectStore: (name) => object_store(name) }
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
            return tx
          },
          close: () => {},
        }
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

const real_indexeddb = globalThis.indexedDB
const position_edge = await import('./spawns_adapter.js')

const bind_with_anchor = (world_id, anchor) => {
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
  publish_world_binding(CHARACTER, world_id)
  position_edge.spawns_input({
    type: 'world_doc',
    doc: { bounds_x: OFFSET * 2, bounds_z: OFFSET * 2, zone_size: 512 },
  })
  position_edge.spawns_input({
    type: 'checkpoint_resolved',
    world_id,
    x: OFFSET + anchor.x,
    z: OFFSET + anchor.z,
    source: 'read',
  })
  expect(position_edge.spawns_store.getState().checkpoint).toEqual(anchor)
}

beforeEach(() => {
  globalThis.indexedDB = create_fake_idb()
  position_edge._reset_position_persistence_for_test()
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
})

afterAll(() => {
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
  position_edge._reset_position_persistence_for_test()
  if (real_indexeddb === undefined) delete globalThis.indexedDB
  else globalThis.indexedDB = real_indexeddb
})

describe('world position IndexedDB edge', () => {
  test('persists and restores per character+world through the existing player_pos reducer door', async () => {
    const anchor = { x: 100, z: 200 }
    const walked = { x: 137.5, z: 164.5 }
    bind_with_anchor(WORLD_A, anchor)

    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, ...walked }, NOW)
    await position_edge.flush_world_position(NOW)

    // A reload loses all module/store memory but keeps IndexedDB.
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    expect(position_edge.spawns_store.getState().player).toBeNull()

    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, NOW + 1_000)).resolves.toEqual(walked)
    expect(position_edge.spawns_store.getState().player).toEqual(walked)
    expect(position_edge.read_world_position(CHARACTER, WORLD_A)).toEqual(walked)
  })

  test('rejects a snapshot from the character’s previous world when the chain binding moved worlds', async () => {
    bind_with_anchor(WORLD_A, { x: 100, z: 200 })
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_B, { x: -300, z: 400 })

    await expect(position_edge.restore_world_position(CHARACTER, WORLD_B, NOW + 1_000)).resolves.toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
    expect(position_edge.read_world_position(CHARACTER, WORLD_B)).toBeNull()
  })

  test('rejects a pre-teleport snapshot when the same-world chain anchor advanced afterward', async () => {
    bind_with_anchor(WORLD_A, { x: 100, z: 200 })
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge._reset_position_persistence_for_test()
    // Deliberately still near the saved pose: distance alone would accept it. The changed committed anchor
    // proves the local row predates a chain-known move, so chain truth must win.
    bind_with_anchor(WORLD_A, { x: 110, z: 210 })

    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, NOW + 1_000)).resolves.toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
  })

  test('rejects snapshots that are expired or implausibly far from an unchanged chain anchor', async () => {
    const anchor = { x: 0, z: 0 }
    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 600, z: 0 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, NOW + 1_000)).resolves.toBeNull()

    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 10, z: 10 }, NOW)
    await position_edge.flush_world_position(NOW)
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(
      position_edge.restore_world_position(CHARACTER, WORLD_A, NOW + 30 * 60 * 1_000 + 1)
    ).resolves.toBeNull()
  })
})
