// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST: the live player position already enters the spawns atom through `player_pos`; this suite pins the
// missing persistence edge around that door. IndexedDB is driven with its real request/transaction callback
// protocol so save → module-memory reset → restore proves the reload contract, not an in-memory shortcut.

import { readFileSync } from 'node:fs'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { publish_dungeon_session } from './dungeon_session.js'
import { publish_world_binding, rebind_world_character, reset_world_binding } from './session_gate.js'

const CHARACTER = '0xCHARACTER'
const OTHER_CHARACTER = '0xOTHER_CHARACTER'
const WORLD_A = '0xWORLD_A'
const WORLD_B = '0xWORLD_B'
const NOW = 1_800_000_000_000
const OFFSET = 1_000
const CHAIN_TIME = NOW - 60_000
// The live worlds' dial (11.5 blocks/s ×100): 60s since the checkpoint buys 690 blocks of honest walking.
const SPEED_BUDGET = 1150
const anchor_at = (x, z, time_ms = CHAIN_TIME) => ({ x, z, time_ms, speed_budget: SPEED_BUDGET })

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
    delete: (key) => {
      store_of(name).delete(key)
      const request = { result: undefined }
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
const host_source = readFileSync(new URL('../GameWorldHost.tsx', import.meta.url), 'utf8')
const embed_source = readFileSync(new URL('../game/embed_voxel.js', import.meta.url), 'utf8')
const prompts_source = readFileSync(new URL('../game/screens/hud/world/DiscoveryPrompts.jsx', import.meta.url), 'utf8')

const bind_with_anchor = (world_id, anchor, character_id = CHARACTER) => {
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
  publish_world_binding(character_id, world_id)
  position_edge.spawns_input({
    type: 'world_doc',
    doc: { bounds_x: OFFSET * 2, bounds_z: OFFSET * 2, zone_size: 512 },
  })
  position_edge.spawns_input({
    type: 'checkpoint_resolved',
    character_id,
    world_id,
    x: OFFSET + anchor.x,
    z: OFFSET + anchor.z,
    world_position: anchor,
    source: 'read',
  })
  expect(position_edge.spawns_store.getState().checkpoint).toEqual({
    x: anchor.x,
    z: anchor.z,
    time_ms: anchor.time_ms ?? null,
    speed_budget: anchor.speed_budget ?? null,
    pet_equipped: false,
  })
}

beforeEach(() => {
  globalThis.indexedDB = create_fake_idb()
  position_edge._reset_position_persistence_for_test()
  publish_dungeon_session({})
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
})

afterAll(() => {
  publish_dungeon_session({})
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
  position_edge._reset_position_persistence_for_test()
  if (real_indexeddb === undefined) delete globalThis.indexedDB
  else globalThis.indexedDB = real_indexeddb
})

describe('world position IndexedDB edge', () => {
  test('only free-walking overworld positions are eligible for persistence', () => {
    const free_walk = { character_id: CHARACTER, world_id: WORLD_A }
    expect(position_edge.can_persist_world_position(free_walk)).toBe(true)
    expect(position_edge.can_persist_world_position({ ...free_walk, in_fight: true })).toBe(false)
    expect(position_edge.can_persist_world_position({ ...free_walk, in_dungeon: true })).toBe(false)
    expect(position_edge.can_persist_world_position({ ...free_walk, in_cave: true })).toBe(false)
    expect(position_edge.can_persist_world_position({ ...free_walk, character_id: null })).toBe(false)
    expect(position_edge.can_persist_world_position({ ...free_walk, world_id: null })).toBe(false)
  })

  test('persists and restores per character+world through the existing player_pos reducer door', async () => {
    const anchor = anchor_at(100, 200)
    const walked = { x: 137.5, z: 164.5 }
    bind_with_anchor(WORLD_A, anchor)

    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, ...walked }, NOW)
    await position_edge.flush_world_position(NOW)

    // A reload loses all module/store memory but keeps IndexedDB.
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    expect(position_edge.spawns_store.getState().player).toBeNull()

    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 1_000)).resolves.toEqual(walked)
    expect(position_edge.spawns_store.getState().player).toEqual(walked)
    expect(position_edge.read_world_position(CHARACTER, WORLD_A)).toEqual(walked)
  })

  test('keeps independent rows for two characters in the same world', async () => {
    const anchor = anchor_at(100, 200)
    const first = { x: 120, z: 220 }
    const second = { x: 80, z: 180 }
    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, ...first }, NOW)
    await position_edge.flush_world_position(NOW)

    bind_with_anchor(WORLD_A, anchor, OTHER_CHARACTER)
    await position_edge.note_world_position({ character_id: OTHER_CHARACTER, world_id: WORLD_A, ...second }, NOW + 1)
    await position_edge.flush_world_position(NOW + 1)

    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 1_000)).resolves.toEqual(first)

    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor, OTHER_CHARACTER)
    await expect(position_edge.restore_world_position(OTHER_CHARACTER, WORLD_A, anchor, NOW + 1_000)).resolves.toEqual(
      second
    )
  })

  test('reduces every movement note but never writes IndexedDB per frame', async () => {
    const anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 110, z: 210 }, NOW)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW + 1_000)
    expect(position_edge.spawns_store.getState().player).toEqual({ x: 120, z: 220 })

    // Lose the unflushed module tail. IndexedDB must still contain the first cadence write, not the per-frame note.
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 2_000)).resolves.toEqual({
      x: 110,
      z: 210,
    })
  })

  test('commits the newest pose at the five-second cadence', async () => {
    const anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 110, z: 210 }, NOW)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 130, z: 230 }, NOW + 5_000)

    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 6_000)).resolves.toEqual({
      x: 130,
      z: 230,
    })
  })

  test('an explicit lifecycle flush commits the newest throttled pose', async () => {
    const anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 110, z: 210 }, NOW)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 140, z: 240 }, NOW + 1_000)
    await position_edge.flush_world_position(NOW + 1_001)

    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 2_000)).resolves.toEqual({
      x: 140,
      z: 240,
    })
  })

  test('a receipt invalidation deletes the previous visit even when the chain anchor later matches', async () => {
    const anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, anchor)
    void position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)

    // Join/travel receipts use this edge before rebinding. Its delete must serialize behind the in-flight save.
    await position_edge.invalidate_world_position(CHARACTER, WORLD_A)
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)

    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 1_000)).resolves.toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
  })

  test('drops a pending movement-stop write when a dungeon phase starts before commit', async () => {
    const anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 110, z: 210 }, NOW)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW + 1_000)

    publish_dungeon_session({ fight_id: '0xFIGHT', character_id: CHARACTER })
    await position_edge.flush_world_position(NOW + 2_000)
    expect(position_edge.spawns_store.getState().player).toEqual({ x: 120, z: 220 })

    publish_dungeon_session({})
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 3_000)).resolves.toEqual({
      x: 110,
      z: 210,
    })
  })

  test('rejects a snapshot from the character’s previous world when the chain binding moved worlds', async () => {
    bind_with_anchor(WORLD_A, anchor_at(100, 200))
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge._reset_position_persistence_for_test()
    const moved_anchor = anchor_at(-300, 400, CHAIN_TIME + 1_000)
    bind_with_anchor(WORLD_B, moved_anchor)

    await expect(
      position_edge.restore_world_position(CHARACTER, WORLD_B, moved_anchor, NOW + 1_000)
    ).resolves.toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
    expect(position_edge.read_world_position(CHARACTER, WORLD_B)).toBeNull()
  })

  test('rejects a pre-teleport snapshot when the same-world chain anchor advanced afterward', async () => {
    bind_with_anchor(WORLD_A, anchor_at(100, 200))
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge._reset_position_persistence_for_test()
    // Deliberately still near the saved pose: distance alone would accept it. The changed committed anchor
    // proves the local row predates a chain-known move, so chain truth must win.
    const moved_anchor = anchor_at(110, 210, CHAIN_TIME + 1_000)
    bind_with_anchor(WORLD_A, moved_anchor)

    await expect(
      position_edge.restore_world_position(CHARACTER, WORLD_A, moved_anchor, NOW + 1_000)
    ).resolves.toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
  })

  test('rejects a pre-event snapshot even when the chain returns to the same coordinates', async () => {
    const old_anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, old_anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge._reset_position_persistence_for_test()
    const rewritten_anchor = anchor_at(100, 200, CHAIN_TIME + 1_000)
    bind_with_anchor(WORLD_A, rewritten_anchor)

    await expect(
      position_edge.restore_world_position(CHARACTER, WORLD_A, rewritten_anchor, NOW + 1_000)
    ).resolves.toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
  })

  test('does not let a stale resolver fallback replace a newer receipt-proven anchor', async () => {
    const old_anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, old_anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    const receipt_anchor = { x: 110, z: 210 }
    position_edge.spawns_input({
      type: 'zone_searched',
      character_id: CHARACTER,
      world_id: WORLD_A,
      zx: 0,
      zy: 0,
      x: receipt_anchor.x,
      z: receipt_anchor.z,
      found: null,
    })
    expect(position_edge.spawns_store.getState().checkpoint).toMatchObject(receipt_anchor)

    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, old_anchor, NOW + 1_000)).resolves.toBeNull()
    expect(position_edge.read_world_chain_anchor(CHARACTER, WORLD_A)).toEqual({
      ...receipt_anchor,
      time_ms: null,
      speed_budget: null,
      pet_equipped: false,
    })
    expect(position_edge.read_world_position(CHARACTER, WORLD_A)).toBeNull()
  })

  test('persists walking that happens after a timestamped search receipt', async () => {
    const old_anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, old_anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)
    await position_edge.flush_world_position(NOW)

    const receipt_anchor = anchor_at(110, 210, CHAIN_TIME + 1_000)
    position_edge.spawns_input({
      type: 'zone_searched',
      character_id: CHARACTER,
      world_id: WORLD_A,
      zx: 0,
      zy: 0,
      x: receipt_anchor.x,
      z: receipt_anchor.z,
      time_ms: receipt_anchor.time_ms,
      found: null,
    })
    const walked = { x: 140, z: 240 }
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, ...walked }, NOW + 1_000)
    await position_edge.flush_world_position(NOW + 1_001)

    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, receipt_anchor)
    await expect(
      position_edge.restore_world_position(CHARACTER, WORLD_A, receipt_anchor, NOW + 2_000)
    ).resolves.toEqual(walked)
  })

  test('a same-world character switch resets the reducer before the new checkpoint arrives', async () => {
    bind_with_anchor(WORLD_A, anchor_at(100, 200))
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 120, z: 220 }, NOW)

    // #2007 — a SWITCH is a selection, not a publish: an owned alt's own binding publish is a fact about that
    // alt and must never re-key the live session (it used to, and this test rode that hijack).
    rebind_world_character(OTHER_CHARACTER, WORLD_A)

    expect(position_edge.spawns_store.getState().checkpoint).toBeNull()
    expect(position_edge.spawns_store.getState().hunt_zone).toBeNull()
    expect(position_edge.spawns_store.getState().player).toBeNull()
  })

  test('rejects a late checkpoint result for the previously selected character before reducer entry', () => {
    const current_anchor = anchor_at(100, 200)
    bind_with_anchor(WORLD_A, current_anchor, OTHER_CHARACTER)

    position_edge.spawns_input({
      type: 'checkpoint_resolved',
      character_id: CHARACTER,
      world_id: WORLD_A,
      x: OFFSET + 900,
      z: OFFSET + 900,
      world_position: anchor_at(900, 900, CHAIN_TIME + 1_000),
      source: 'read',
    })

    expect(position_edge.spawns_store.getState().checkpoint).toMatchObject({
      x: current_anchor.x,
      z: current_anchor.z,
    })
  })

  test('rejects snapshots that are expired or beyond the chain travel budget for an unchanged anchor', async () => {
    const anchor = anchor_at(0, 0)
    bind_with_anchor(WORLD_A, anchor)
    // 5000 blocks in the 60s since the checkpoint — the chain would abort 121 from there, so the row dies.
    // (600 blocks would NOT: 690 is honest walking in that minute — that is exactly the #2231 fix.)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 5_000, z: 0 }, NOW)
    await position_edge.flush_world_position(NOW)

    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 1_000)).resolves.toBeNull()

    bind_with_anchor(WORLD_A, anchor)
    await position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, x: 10, z: 10 }, NOW)
    await position_edge.flush_world_position(NOW)
    position_edge.spawns_input({ type: 'world_bound', world_id: null })
    position_edge._reset_position_persistence_for_test()
    bind_with_anchor(WORLD_A, anchor)
    await expect(
      position_edge.restore_world_position(CHARACTER, WORLD_A, anchor, NOW + 30 * 60 * 1_000 + 1)
    ).resolves.toBeNull()
  })

  test('boot awaits chain then IndexedDB, and the renderer reads only reducer-owned position state', () => {
    const chain_at = host_source.indexOf('const [chain_anchor] = await Promise.all([')
    const restore_at = host_source.indexOf('await restore_world_position(char_id, world, chain_anchor)')
    expect(chain_at).toBeGreaterThan(-1)
    expect(restore_at).toBeGreaterThan(chain_at)
    expect(embed_source).toContain('const stored = read_world_position(character.id, world_id)')
    expect(embed_source).toContain('read_world_chain_anchor(character.id, world_id) ?? read_checkpoint_spawn')
    expect(embed_source).toContain('void note_world_position({')
    const indexed_seed = prompts_source.slice(
      prompts_source.indexOf('// char.position is the INDEXER-served CHAIN checkpoint'),
      prompts_source.indexOf('}, [world_id, character_id, character_doc, hunt_zone_known])')
    )
    expect(indexed_seed).toContain('character_id,')
  })
})
