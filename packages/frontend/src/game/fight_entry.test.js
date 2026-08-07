// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT-ENTRY — deterministic proof of the trigger contract:
//   • OPTIMISTIC (the engage must be visible IN PARALLEL of the authoritative task, not gated behind its
//     receipt): 'fight_entry/engage' starts the beat instantly — camera prepare framed on the GROUP anchor +
//     herald sword; 'fight_entry/abort' (tx failed/refused) rolls it back cleanly; a SUCCESS store flip under a
//     running beat never double-starts;
//     an abort AFTER confirmation is inert.
//   • FRESH-CREATES-ONLY gate: the store flip fires the cinematic ONLY with
//     `fight_fresh: true`; reload-resume/poll-adopt get NO prepare — the camera direct-engages at the settled
//     pose (embed_voxel_fight_camera.test.js proves that half).
// Layers: entry_transition (pure verdict fold, every branch) + create_fight_entry over the REAL use_dungeon
// singleton and the REAL shared bus (setState/emit-driven integration).

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// fight_entry drags the browser-flavoured store graph (dungeon_store → auth/i18n/toast) — stub the window
// surface BEFORE the import (top-level, since imports evaluate at collection). PATCH style (`w.x ??=`), never a
// blanket object: bun runs the whole suite in ONE process, so another file may have created a partial window
// already (the camera test does) — auth/index.ts reads window.location.origin at import the moment ANY window
// exists, so the pieces must be guaranteed individually, whatever the file order.
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

const restore_browser_globals = install_browser_globals()

// MISSING-ARTIFACT (#117): this module graph reaches @aresrpg/engine3, whose board_entities.js/
// character_controller.js unconditionally import character_avatar.js — a static import of the
// absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js.
const { entry_transition, create_fight_entry } = SENSHI_MALE_GLB_AVAILABLE ? await import('./fight_entry.js') : {}
const { use_dungeon } = SENSHI_MALE_GLB_AVAILABLE ? await import('../world-shell/dungeon_store.js') : {}
const { context } = SENSHI_MALE_GLB_AVAILABLE ? await import('./store.js') : {}

afterAll(restore_browser_globals)

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('entry_transition — the fresh-creates-only verdict fold', () => {
  it("'begin' ONLY on a fresh null→set flip (fight_fresh stamped true by the door)", () => {
    expect(entry_transition(null, { fight_id: '0xf', fight_fresh: true })).toBe('begin')
  })

  it('a reload-resume / poll-adopt flip (fight_fresh false or absent) is NULL — no cinematic', () => {
    expect(entry_transition(null, { fight_id: '0xf', fight_fresh: false })).toBe(null)
    expect(entry_transition(null, { fight_id: '0xf' })).toBe(null) // unstamped = never fresh (safe default)
  })

  it("'end' on set→null (fight gone), regardless of freshness", () => {
    expect(entry_transition('0xf', { fight_id: null, fight_fresh: false })).toBe('end')
    expect(entry_transition('0xf', { fight_id: null, fight_fresh: true })).toBe('end')
  })

  it('no edge = null (same fight re-set, still roaming, fight swap mid-set)', () => {
    expect(entry_transition('0xf', { fight_id: '0xf', fight_fresh: true })).toBe(null)
    expect(entry_transition(null, { fight_id: null })).toBe(null)
    expect(entry_transition('0xa', { fight_id: '0xb', fight_fresh: true })).toBe(null) // never a mid-fight restart
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('create_fight_entry — the gate over the real store (integration)', () => {
  // RESET-BEFORE-USE (test_helpers/fight_core_harness.js's convention, verbatim: "a file that forgets to clean
  // up after itself still can't poison a well-behaved consumer"). `use_dungeon` is ONE module instance for the
  // whole bun run, and `create_fight_shim().start()` leaves `fight_id` set on it — its `dispose()` tears the
  // fight CORE down but never clears the store field its own `start()` wrote. Any simulator suite that ran first
  // therefore handed us a non-null prev_fight_id, and `entry_transition` reads a fight SWAP (never a fresh
  // create), so no cinematic fired. Whether that happened was decided by readdir order. Cleaning up in the
  // `finally` below is not enough — only resetting BEFORE use makes file order irrelevant.
  beforeEach(() => use_dungeon.setState({ fight_id: null, fight_fresh: false }))

  it('fresh create fires the cinematic; resume does not; fight-end releases', () => {
    const calls = /** @type {any[][]} */ ([])
    let active = false
    const cam = {
      begin_prepare: (/** @type {any} */ a) => {
        calls.push(['begin', a])
        active = true
      },
      set_active: (/** @type {boolean} */ on) => {
        calls.push(['active', on])
        active = on
      },
      is_active: () => active,
    }
    const cave = { x: 5, y: 60, z: 9 } // cave path — the D280 ceremony owns the sword (none planted here)
    const entry = create_fight_entry({
      engine: {},
      fight_camera: cam,
      board_cell_m: 1.33,
      get_cave_anchor: () => cave,
      get_player_pos: () => [0, 0, 0],
    })
    try {
      // FRESH create (the door stamped fight_fresh:true in the same set) → the cinematic begins, framed on the cave.
      use_dungeon.setState({ fight_id: '0xfresh', fight_fresh: true })
      expect(calls.filter((c) => c[0] === 'begin').length).toBe(1)
      const arg = calls[0][1]
      expect(arg.frame.origin).toEqual(cave) // the prepare orbit is anchored on the coming board
      expect(arg.reduced).toBe(false) // matchMedia stub: no reduced-motion
      // fight ends while the camera is engaged → the entry releases it (aborted-create safety leg).
      use_dungeon.setState({ fight_id: null })
      expect(calls.at(-1)).toEqual(['active', false])
      // RELOAD-RESUME (the door stamped fight_fresh:false) → NO cinematic; the adapter direct-engages later.
      use_dungeon.setState({ fight_id: '0xresume', fight_fresh: false })
      expect(calls.filter((c) => c[0] === 'begin').length).toBe(1) // still just the one fresh begin
      // resume's end with the camera NOT engaged by us → no release call either (the adapter owns that leg).
      use_dungeon.setState({ fight_id: null })
      expect(calls.filter((c) => c[0] === 'active').length).toBe(1)
    } finally {
      entry.dispose()
      use_dungeon.setState({ fight_id: null, fight_fresh: false }) // never leak session state into the shared singleton
    }
  })

  it('D3 DUNGEON optimistic press: rotating camera fires before the receipt, framed on the cave board, with NO sword (the D280 ceremony owns it)', () => {
    const begins = /** @type {any[]} */ ([])
    const planted = /** @type {any[]} */ ([])
    let active = false
    const cam = {
      begin_prepare: (/** @type {any} */ a) => {
        begins.push(a)
        active = true
      },
      set_active: (/** @type {boolean} */ on) => {
        active = on
      },
      is_active: () => active,
    }
    const cave = { x: 12, y: 61, z: 34 } // the mounted cave's board anchor (get_cave_anchor)
    const entry = create_fight_entry({
      engine: {},
      fight_camera: cam,
      board_cell_m: 1.33,
      get_cave_anchor: () => cave, // DUNGEON path — a cave is mounted
      get_player_pos: () => [0, 0, 0],
      plant_sword: (/** @type {any} */ { anchor }) => {
        const h = { anchor: [...anchor], disposed: false, dispose() { h.disposed = true } }
        planted.push(h)
        return h
      },
    })
    try {
      // (1) the DUNGEON PRESS (dungeon_dimension.engage emits with NO anchor) — the camera rotates INSTANTLY,
      // framed on the coming board (get_cave_anchor), while no authoritative receipt has landed (fight_id null).
      context.events.emit('fight_entry/engage', {})
      expect(begins.length).toBe(1)
      expect(begins[0].frame.origin).toEqual(cave) // orbit centred on the cave board's own min-corner
      expect(planted.length, 'NO fight_entry sword in a cave — the D280 ceremony plants the only one').toBe(0)
      // (2) the start tx lands UNDER the running beat (fight_fresh stamped by the dungeon door) — NO double-start,
      // still NO sword. This entry observer reacts immediately and dedupes the later confirmed fight_id.
      use_dungeon.setState({ fight_id: '0xroomfight', fight_fresh: true })
      expect(begins.length).toBe(1)
      expect(planted.length).toBe(0)
      // board mounts → the camera settles; fight ends → releases as usual.
      entry.on_board_ready()
      use_dungeon.setState({ fight_id: null })
      expect(active).toBe(false)
    } finally {
      entry.dispose()
      use_dungeon.setState({ fight_id: null, fight_fresh: false }) // never leak session state into the shared singleton
    }
  })

  it('OPTIMISTIC press: beat starts pre-receipt at the group anchor; abort rolls back; success never double-starts', () => {
    const begins = /** @type {any[]} */ ([])
    const planted = /** @type {{ anchor: number[], disposed: boolean, dispose: () => void }[]} */ ([])
    let active = false
    const cam = {
      begin_prepare: (/** @type {any} */ a) => {
        begins.push(a)
        active = true
      },
      set_active: (/** @type {boolean} */ on) => {
        active = on
      },
      is_active: () => active,
    }
    const entry = create_fight_entry({
      engine: {},
      fight_camera: cam,
      board_cell_m: 1.33,
      get_cave_anchor: () => null, // WORLD path — the optimistic lane
      get_player_pos: () => [0, 0, 0],
      plant_sword: (/** @type {any} */ { anchor }) => {
        const h = {
          anchor: /** @type {number[]} */ ([...anchor]),
          disposed: false,
          dispose() {
            h.disposed = true
          },
        }
        planted.push(h)
        return h
      },
    })
    try {
      // (1) the PRESS — no tx result, no store flip: the beat starts INSTANTLY, framed + sworded on the GROUP.
      context.events.emit('fight_entry/engage', { anchor: [10, 60, 20] })
      expect(begins.length).toBe(1)
      const half = (11 * 1.33) / 2 // PREP_GRID × cell / 2 — the frame is CENTRED on the anchor
      expect(begins[0].frame.origin.x).toBeCloseTo(10 - half, 5)
      expect(begins[0].frame.origin.y).toBe(60)
      expect(begins[0].frame.origin.z).toBeCloseTo(20 - half, 5)
      expect(planted.length).toBe(1)
      expect(planted[0].anchor).toEqual([10, 60, 20])
      // spam-press while the beat runs is inert (never a stacked beat)
      context.events.emit('fight_entry/engage', { anchor: [1, 2, 3] })
      expect(begins.length).toBe(1)
      // (4) FAILURE — the lane's rollback: sword despawns, camera releases (honest rollback, no stuck iso).
      context.events.emit('fight_entry/abort')
      expect(planted[0].disposed).toBe(true)
      expect(active).toBe(false)
      // (2)+(3) a new press, then the tx SUCCEEDS under it: the fresh store flip must NOT double-start.
      context.events.emit('fight_entry/engage', { anchor: [5, 50, 5] })
      expect(begins.length).toBe(2)
      use_dungeon.setState({ fight_id: '0xoptimistic', fight_fresh: true })
      expect(begins.length).toBe(2) // no second begin_prepare — the beat is already playing
      expect(planted.length).toBe(2) // no second sword
      // an abort arriving AFTER confirmation is inert (never roll back a confirmed fight).
      context.events.emit('fight_entry/abort')
      expect(planted[1].disposed).toBe(false)
      expect(active).toBe(true)
      // board mounts → the herald yields to it; fight ends → the camera releases as usual.
      entry.on_board_ready()
      expect(planted[1].disposed).toBe(true)
      use_dungeon.setState({ fight_id: null })
      expect(active).toBe(false)
    } finally {
      entry.dispose()
      use_dungeon.setState({ fight_id: null, fight_fresh: false }) // never leak session state into the shared singleton
    }
  })
})
