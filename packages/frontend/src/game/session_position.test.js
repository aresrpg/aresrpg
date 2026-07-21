// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const char_a = '0xCHAR_A'
const char_b = '0xCHAR_B'
const world_a = '0xWORLD_A'
const world_b = '0xWORLD_B'
const position = { x: 137.5, z: 164.5 }

const make_storage = () => {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

const restore_browser_globals = install_browser_globals()
const real_storage = globalThis.localStorage
// session_position's defense-in-depth gate reads the real dungeon store. Its browser-flavoured dependency
// graph needs the same minimal pre-import surface used by fight_entry.test.js.

const { resolve_boot_spawn } = await import('@aresrpg/world/checkpoint')
const {
  _reset_for_test,
  can_cache_live_position,
  flush_live_position,
  live_position_storage_key,
  note_live_position,
  read_live_position,
} = await import('./session_position.js')
const { use_dungeon } = await import('../world-shell/dungeon_store.js')
const original_phase = {
  in_session: use_dungeon.getState().in_session,
  run_pass_id: use_dungeon.getState().run_pass_id,
  dungeon: use_dungeon.getState().dungeon,
  dungeon_id: use_dungeon.getState().dungeon_id,
  fight_id: use_dungeon.getState().fight_id,
}
const embed_source = readFileSync(new URL('./embed_voxel.js', import.meta.url), 'utf8')
// Mutate the test snapshot directly: Zustand subscribers start/stop browser audio on `in_session` transitions,
// while this unit needs only the synchronous getState() seam the cache guard reads.
const set_phase_for_test = (phase) => Object.assign(use_dungeon.getState(), phase)

beforeEach(() => {
  globalThis.localStorage = /** @type {any} */ (make_storage())
  set_phase_for_test({ in_session: false, run_pass_id: null, dungeon: null, dungeon_id: null, fight_id: null })
  _reset_for_test()
})

afterEach(() => {
  set_phase_for_test(original_phase)
  if (real_storage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = real_storage
})

afterAll(restore_browser_globals)

describe('last overworld position localStorage cache', () => {
  it('persists exactly {x,z,world_id,ts} under a per-character key', () => {
    note_live_position({ character_id: char_a, world_id: world_a, ...position })

    const raw = localStorage.getItem(live_position_storage_key(char_a))
    expect(raw).not.toBeNull()
    const saved = JSON.parse(/** @type {string} */ (raw))
    expect(saved).toEqual({ ...position, world_id: world_a, ts: expect.any(Number) })
    expect(Object.keys(saved).sort()).toEqual(['ts', 'world_id', 'x', 'z'])
    expect(read_live_position(char_a, world_a)).toEqual(position)
  })

  it('keeps separate entries for separate characters', () => {
    note_live_position({ character_id: char_a, world_id: world_a, ...position })
    note_live_position({ character_id: char_b, world_id: world_a, x: 4, z: 8 })

    expect(read_live_position(char_a, world_a)).toEqual(position)
    expect(read_live_position(char_b, world_a)).toEqual({ x: 4, z: 8 })
    expect(localStorage.getItem(live_position_storage_key(char_a))).not.toBeNull()
    expect(localStorage.getItem(live_position_storage_key(char_b))).not.toBeNull()
  })

  it('throttles interval writes but an explicit unload flush commits the freshest x/z', () => {
    note_live_position({ character_id: char_a, world_id: world_a, ...position })
    note_live_position({ character_id: char_a, world_id: world_a, x: 999, z: 777 })
    expect(read_live_position(char_a, world_a)).toEqual(position)

    flush_live_position()
    expect(read_live_position(char_a, world_a)).toEqual({ x: 999, z: 777 })
  })

  it('ignores missing identity and non-finite coordinates', () => {
    note_live_position({ character_id: '', world_id: world_a, ...position })
    note_live_position({ character_id: char_a, world_id: '', ...position })
    note_live_position({ character_id: char_a, world_id: world_a, x: NaN, z: 1 })
    expect(localStorage.getItem(live_position_storage_key(char_a))).toBeNull()
  })
})

describe('read_live_position validation and boot arbitration', () => {
  it('ignores a different world and therefore lets the chain checkpoint win at resolve_boot_spawn', () => {
    note_live_position({ character_id: char_a, world_id: world_a, ...position })
    const session = read_live_position(char_a, world_b)
    expect(session).toBeNull()

    expect(
      resolve_boot_spawn({
        checkpoint: { x: 20, z: 30 },
        session,
        fallback: [3.5, 138, 4.5],
        y_seed: 138,
      })
    ).toEqual({ position: [20, 138, 30], yaw: 0, source: 'checkpoint' })
  })

  it('ignores stale, corrupt, and non-finite entries', () => {
    const key = live_position_storage_key(char_a)
    localStorage.setItem(key, JSON.stringify({ ...position, world_id: world_a, ts: Date.now() - 31 * 60 * 1000 }))
    expect(read_live_position(char_a, world_a)).toBeNull()

    localStorage.setItem(key, '{not json')
    expect(read_live_position(char_a, world_a)).toBeNull()

    localStorage.setItem(key, JSON.stringify({ x: 'nope', z: 1, world_id: world_a, ts: Date.now() }))
    expect(read_live_position(char_a, world_a)).toBeNull()
  })

  it('accepts a fresh entry after a reload with empty module memory', () => {
    localStorage.setItem(
      live_position_storage_key(char_a),
      JSON.stringify({ ...position, world_id: world_a, ts: Date.now() - 29 * 60 * 1000 })
    )
    _reset_for_test()
    expect(read_live_position(char_a, world_a)).toEqual(position)
  })
})

describe('can_cache_live_position — free-walking overworld only', () => {
  const free_walk = { character_id: char_a, world_id: world_a }

  it('accepts free walking and rejects fights, dungeons, caves, or an unresolved identity', () => {
    expect(can_cache_live_position(free_walk)).toBe(true)
    expect(can_cache_live_position({ ...free_walk, in_fight: true })).toBe(false)
    expect(can_cache_live_position({ ...free_walk, in_dungeon: true })).toBe(false)
    expect(can_cache_live_position({ ...free_walk, in_cave: true })).toBe(false)
    expect(can_cache_live_position({ ...free_walk, world_id: null })).toBe(false)
    expect(can_cache_live_position({ ...free_walk, character_id: null })).toBe(false)
  })
})

describe('dungeon-store defense in depth', () => {
  it('refuses direct notes throughout optimistic entry, a bound run, a dungeon, or a fight', () => {
    const blocked_phases = [
      { in_session: true },
      { run_pass_id: '0xPASS' },
      { dungeon: {} },
      { dungeon_id: '0xRUN' },
      { fight_id: '0xFIGHT' },
    ]

    for (const phase of blocked_phases) {
      set_phase_for_test({
        in_session: false,
        run_pass_id: null,
        dungeon: null,
        dungeon_id: null,
        fight_id: null,
        ...phase,
      })
      note_live_position({ character_id: char_a, world_id: world_a, ...position })
      expect(localStorage.getItem(live_position_storage_key(char_a))).toBeNull()
      _reset_for_test()
    }
  })

  it('refuses a flush during a fight and discards the stale pre-fight pending pose', () => {
    note_live_position({ character_id: char_a, world_id: world_a, ...position })
    note_live_position({ character_id: char_a, world_id: world_a, x: 999, z: 777 })

    set_phase_for_test({ fight_id: '0xFIGHT' })
    flush_live_position()
    expect(read_live_position(char_a, world_a)).toEqual(position)

    set_phase_for_test({ fight_id: null })
    flush_live_position()
    expect(read_live_position(char_a, world_a)).toEqual(position)
  })
})

describe('embed position-cache integration', () => {
  it('feeds the cache through resolve_boot_spawn and gates cadence, pagehide, and quality flushes', () => {
    expect(embed_source).toContain('const stored = read_live_position(character.id, world_id)')
    expect(embed_source).toContain('resolve_boot_spawn({ checkpoint, session, fallback: WORLD_SPAWN')
    expect(embed_source).toContain('if (can_persist_position())\n      note_live_position({')
    expect(embed_source).toContain('session.flush_position?.() // no-op unless the unload occurs while free-walking')
    expect(embed_source.match(/session\.flush_position\?\.\(\)/g)).toHaveLength(2)
  })
})
