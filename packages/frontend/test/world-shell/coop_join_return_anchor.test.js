// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#2174) — a coop teammate resets to world origin after the fight.
//
// Both roles walk to the SAME fight coords (630, -706) and fight there. The INITIATOR's engage consumed a
// `zones::claim_mob_group` ticket, which travel-verifies AND advances the on-chain checkpoint to the group's
// position (zones.move:298/608 → character_link::y2) — so their next boot reads chain truth AT the fight.
// The JOINER's `fight::join` (fight.move:185) takes no `&World`, no ticket, and writes no checkpoint, so their
// chain anchor is still the world-join spawn (chain-space bounds/2 → signed world ORIGIN). The local free-walk
// row that would otherwise carry them is then discarded by the agreement guard (946 blocks away), and the boot
// arbiter falls back to the stale checkpoint: the teammate wakes up at the world origin.
//
// #2231 CHANGED THE GUARD, NOT THIS LAW: agreement is now the chain's TIME budget, so an honest 946-block walk
// is kept on its own once enough time has passed to cover it. The return anchor is what still carries the
// teammate when it has NOT — the FRESH-ANCHOR case below pins exactly that, so #2174 cannot silently rot into
// "the budget happened to allow it".

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { resolve_boot_spawn } from '@aresrpg/world/checkpoint'

import { publish_dungeon_session } from '../../src/world-shell/dungeon_session.js'
import { publish_world_binding, reset_world_binding } from '../../src/world-shell/session_gate.js'

const CHARACTER = '0xTEAMMATE'
const WORLD_A = '0xWORLD_A'
const NOW = 1_800_000_000_000
const OFFSET = 1_000
const CHAIN_TIME = NOW - 600_000
// The live worlds' dial (11.5 blocks/s ×100 — move/scripts/apply_speed_budget.mjs).
const SPEED_BUDGET = 1150
// The owner-reported coop fight coords (issue #2174): ~946 blocks from the world origin — past AGREE_RADIUS_M.
const FIGHT = { x: 630, z: -706 }
const ORIGIN = { x: 0, z: 0 }
const WORLD_SPAWN = /** @type {[number, number, number]} */ ([0, 138, 0])

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
const position_edge = await import('../../src/world-shell/spawns_adapter.js')

/** Publish the character's CHAIN checkpoint for this world (signed world space) through the real reducer door. */
const publish_chain_checkpoint = (world_position, time_ms = CHAIN_TIME) => {
  position_edge.spawns_input({
    type: 'checkpoint_resolved',
    character_id: CHARACTER,
    world_id: WORLD_A,
    x: OFFSET + world_position.x,
    z: OFFSET + world_position.z,
    world_position: { ...world_position, time_ms, speed_budget: SPEED_BUDGET },
    source: 'read',
  })
}

/** Boot the session: bind the character to the world and hand it the world doc it reads its offsets from. */
const boot_session = () => {
  reset_world_binding()
  position_edge.spawns_input({ type: 'world_bound', world_id: null })
  publish_world_binding(CHARACTER, WORLD_A)
  position_edge.spawns_input({
    type: 'world_doc',
    doc: { bounds_x: OFFSET * 2, bounds_z: OFFSET * 2, zone_size: 512 },
  })
}

/**
 * Drive one role's whole session: boot at the origin spawn, walk to the fight, fight, then reboot and ask the
 * boot arbiter where the body wakes up. `stamp_return_anchor` is the ONE difference between the two roles —
 * the engage door's chain checkpoint write that the join door has no equivalent for.
 */
const play_a_coop_fight = async ({ stamp_return_anchor, checkpoint_age_ms = 600_000 }) => {
  const join_time = NOW - checkpoint_age_ms
  boot_session()
  publish_chain_checkpoint(ORIGIN, join_time) // world join rolled the spawn at the world centre → world origin

  // walk out to the group and stand there (the ~5s IndexedDB cadence at the position edge)
  position_edge.note_world_position({ character_id: CHARACTER, world_id: WORLD_A, ...FIGHT }, NOW)
  await position_edge.flush_world_position(NOW)

  // the fight: position persistence is blocked for its whole duration (both roles alike)
  publish_dungeon_session({ fight_id: '0xFIGHT' })
  if (stamp_return_anchor) publish_chain_checkpoint(FIGHT, NOW) // engage only: claim_mob_group wrote it
  publish_dungeon_session({})

  // the fight ended; the player comes back later (a reload, a character switch, a fresh mount)
  position_edge._reset_position_persistence_for_test()
  boot_session()
  const chain_anchor = stamp_return_anchor
    ? { ...FIGHT, time_ms: NOW, speed_budget: SPEED_BUDGET }
    : { ...ORIGIN, time_ms: join_time, speed_budget: SPEED_BUDGET }
  publish_chain_checkpoint(stamp_return_anchor ? FIGHT : ORIGIN, chain_anchor.time_ms)

  const restored = await position_edge.restore_world_position(CHARACTER, WORLD_A, chain_anchor, NOW + 60_000)
  const { checkpoint } = position_edge.spawns_store.getState()
  const spawn = resolve_boot_spawn({
    checkpoint,
    session: restored,
    fallback: WORLD_SPAWN,
    y_seed: WORLD_SPAWN[1],
    now: NOW + 60_000,
  })
  return { x: spawn.position[0], z: spawn.position[2], source: spawn.source }
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
  globalThis.indexedDB = real_indexeddb
})

describe('#2174 — a coop fight returns BOTH roles to where they fought', () => {
  // THE GREEN CONTROL: the initiator's engage stamped the return anchor on chain, so this already passes.
  test('the INITIATOR resumes at the fight coords', async () => {
    const woke_at = await play_a_coop_fight({ stamp_return_anchor: true })
    expect({ x: woke_at.x, z: woke_at.z }).toEqual(FIGHT)
  })

  // THE RED: the join door stamps nothing, so the teammate wakes at the world origin.
  test('the JOINER resumes at the fight coords, not the world origin', async () => {
    const woke_at = await play_a_coop_fight({ stamp_return_anchor: false })
    expect({ x: woke_at.x, z: woke_at.z }).not.toEqual(ORIGIN)
    expect({ x: woke_at.x, z: woke_at.z }).toEqual(FIGHT)
  })

  // THE ISOLATING CASE (#2231 interaction): a checkpoint written 20s ago buys 230 blocks — the chain would
  // refuse the 946-block pose outright, so nothing but the fight door's return anchor can bring the teammate
  // back. Without the stamp this is the yank; with it, the body resumes where it fought.
  test('the JOINER still resumes when the walk is BEYOND the travel budget (the anchor, not the budget)', async () => {
    const woke_at = await play_a_coop_fight({ stamp_return_anchor: false, checkpoint_age_ms: 20_000 })
    expect({ x: woke_at.x, z: woke_at.z }).toEqual(FIGHT)
  })
})
