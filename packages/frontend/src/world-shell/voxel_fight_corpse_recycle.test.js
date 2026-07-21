// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CORPSE PERMANENCE — reconciled to WAVE-A V1 (retirement floor) + V3 (keystone deleted). Seat §5d.
//
// THE ORIGINAL TEST (git history) drove alive → poll-only death → corrected-snapshot REVIVE → poll-only death
// again, and asserted the SECOND death still despawned (the `dying`-flag mirror leak in voxel_fight_adapter.js).
// Its whole scenario RESTED on two mechanisms Wave A deliberately removes: the "KEYSTONE (register #3)" equal-
// version compare-adopt it cited to justify the revive (DELETED by V3) and the resurrection itself (a floor-dead
// mob brought back alive by a later higher-version read — the EXACT resurrection root V1 eliminates, symptom ②).
//
// Under the ratified law an authoritative death is a FLOOR: a later read carrying the mob ALIVE again is a parity
// incident, held DEAD (BLANKPAGE §②/§③). So a mob dies AT MOST ONCE per fight — the corpse-recycle precondition
// (one id dying twice) is now structurally impossible, and the `dying`-leak it guarded is unreachable dead-weight.
// This test now LOCKS that new law at the REAL adapter: a floor-dead mob-0, then a "corrected" alive snapshot,
// must NOT revive — it despawns once and stays gone. It drives the REAL create_voxel_fight_adapter + REAL
// fight_store/use_dungeon singletons (voxel_fight_beat_playback.test.js's recording-board harness), one fight_id.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// the adapter drags the browser-flavoured graph (auth/i18n/toast/context) — window must exist BEFORE import.
const restore_browser_globals = install_browser_globals()
const had_audio = 'Audio' in globalThis
// @ts-expect-error test shim — no receipts/casts play here, but the adapter's transitive imports are shared
// with voxel_fight_beat_playback.test.js's module graph; stub defensively so a bun-side Audio ReferenceError
// can never masquerade as this suite's own red.
if (!had_audio)
  globalThis.Audio = function AudioStub() {
    this.play = () => Promise.resolve()
    this.pause = () => {}
    this.addEventListener = () => {}
    this.removeEventListener = () => {}
  }

const { fight_store } = await import('@aresrpg/fight/store')
const { engine_view } = await import('@aresrpg/fight/project')
const { use_dungeon } = await import('./dungeon_store.js')
const { SENSHI_MALE_GLB_AVAILABLE } = await import('../test_helpers/glb_fixture.js')
// MISSING-ARTIFACT (#117): voxel_fight_adapter.js imports @aresrpg/engine3/tactical, whose board_entities.js
// unconditionally imports character_avatar.js — a static import of the absent-by-design senshi_male.glb
// (test_helpers/glb_fixture.js; full chain documented in packages/engine/src/test_helpers/glb_fixture.js).
const { create_voxel_fight_adapter } = SENSHI_MALE_GLB_AVAILABLE ? await import('./voxel_fight_adapter.js') : {}

const FIGHT = '0xcorpse-recycle-fight'
const CHAR = '0xc1'

/** A decoded-Fight-shaped object (fight_board_simdrive.test.js's harness shape) — `mob_hp` drives the
 *  poll-only death/revive: board_state.js derives `alive: Number(m.hp ?? 0) > 0` straight off this hp, no
 *  receipt/wave beat involved either way. */
const fight_object = (mob_hp) => ({
  id: FIGHT,
  width: 20,
  height: 19,
  status: 1, // STATUS_ACTIVE
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 100, // { x: 0, y: 5 }
      ready: true,
      casts_this_turn: 0,
    },
  ],
  mobs: [{ template: '0xabc', level: 1, hp: mob_hp, max_hp: 30, cell: 105, ap: 4, mp: 3 }], // { x: 5, y: 5 }
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [100],
  start_cells_b: [105],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
})

/** A recording BoardHandle stand-in — mirrors voxel_fight_beat_playback.test.js's make_board, plus a
 *  `removes` tap (that suite never needed it; this one's whole point is proving entity_remove fires TWICE). */
const make_board = () => {
  const calls = { beats: [], upserts: [], removes: [] }
  const beat_promise = () => {
    const p = Promise.resolve()
    p.done = Promise.resolve()
    p.duration_ms = 300
    return p
  }
  return {
    calls,
    on: () => () => {},
    build: async () => {},
    teardown: () => {},
    entity_upsert: (spec) => calls.upserts.push(spec),
    entity_remove: (id) => calls.removes.push(id),
    entity_move: () => Promise.resolve(),
    entity_beat: (id, opts) => {
      calls.beats.push({ id, ...opts })
      return beat_promise()
    },
    flash_cell: () => {},
    flash_entity: () => {},
    pulse_cells: () => {},
    ripple: () => {},
    set_cell_state: () => {},
    clear_states: () => {},
    render_position_of: () => null,
    set_entity_anchor: () => {},
    clear_entity_anchor: () => {},
    entity_height_of: () => 2,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const poll = async (predicate, { timeout = 8_000, step = 50 } = {}) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (predicate()) return true
    await sleep(step)
  }
  return predicate()
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
  'voxel fight adapter — a corpse despawns even after its id already died once earlier THIS fight',
  () => {
    const board = make_board()
    const adapter_handle = { current: null }

    afterAll(() => {
      adapter_handle.current?.destroy()
      fight_store.getState().input({ type: 'init', fight_id: null }) // reset the singleton for the rest of the suite
      use_dungeon.setState({ fight_id: null, fight_fresh: false })
      // @ts-expect-error test shim
      if (!had_audio) delete globalThis.Audio
      restore_browser_globals()
    })

    test('a floor-dead mob-0 is NOT revived by a corrected alive snapshot — it despawns once and stays gone (V1)', async () => {
      fight_store
        .getState()
        .input({
          type: 'init',
          fight_id: FIGHT,
          my_key: 'p0',
          ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
        })
      fight_store.getState().input({ type: 'snapshot', fight: fight_object(30), version: 5 })
      expect(use_dungeon.getState().dungeon?.id, 'the run store must project the live board record').toBe(FIGHT)

      adapter_handle.current = create_voxel_fight_adapter(board)
      const wired = await poll(() => board.calls.upserts.some((u) => u.id === 'mob-0'))
      expect(wired, 'the adapter never mounted mob-0').toBe(true)

      // ── DEATH — poll-only (no receipt/wave beat behind it): sync_entities' fold discovers it, and V1 FLOORS it. ──
      fight_store.getState().input({ type: 'snapshot', fight: fight_object(0), version: 6 })
      const died = await poll(() => board.calls.beats.some((b) => b.id === 'mob-0' && b.anim === 'death'))
      expect(died, 'the poll-only death was never folded into a death beat').toBe(true)
      const removed = await poll(() => board.calls.removes.includes('mob-0'))
      expect(removed, 'the corpse never despawned (entity_remove never called)').toBe(true)
      expect(
        engine_view(fight_store.getState()).fighters.get('mob-0').committed_dead,
        'mob-0 is floor-dead at v6'
      ).toBe(true)

      // ── NO REVIVE (V1 · symptom ②) — a later, higher-version read carrying mob-0 ALIVE again is a parity incident,
      // held DEAD by the retirement floor. The old keystone re-adopt that would have resurrected it is DELETED (V3).
      // The rig must NOT re-mount, and the core must keep mob-0 dead. ──
      board.calls.upserts.length = 0
      fight_store.getState().input({ type: 'snapshot', fight: fight_object(30), version: 7 })
      await sleep(400) // the adapter reconciles synchronously on the store change + its tick; a re-mount would be here
      expect(
        board.calls.upserts.some((u) => u.id === 'mob-0'),
        'a floor-dead mob must NOT be revived by a corrected alive snapshot (no resurrection — V1)'
      ).toBe(false)
      expect(
        engine_view(fight_store.getState()).fighters.get('mob-0').committed_dead,
        'retirement is permanent within the fight — the alive snapshot is discarded as a parity incident'
      ).toBe(true)
    }, 20_000)
  }
)
