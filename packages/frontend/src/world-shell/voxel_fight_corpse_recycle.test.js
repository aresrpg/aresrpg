// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CORPSE RECONCILIATION — an ahead complete snapshot replaces the one-pipeline base and its retirement state.
//
// A behind/equal object cannot alter a receipt-proven death. An object ahead of the event cursor is different: it is
// the complete new base, so the old retirement state is discarded with the subsumed event tail (#1336). This test
// pins the REAL adapter side of that law: the first death despawns, then an ahead alive base mounts the entity again.

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
// GLB RESOLVER (#771): voxel_fight_adapter.js reaches an absent engine-local senshi_male.glb import;
// the Bun preload maps it to the tracked frontend runtime GLB's CDN route (see test_helpers/glb_fixture.js).
const { create_voxel_fight_adapter } = SENSHI_MALE_GLB_AVAILABLE ? await import('./voxel_fight_adapter.js') : {}

const FIGHT = '0xcorpse-recycle-fight'
const CHAR = '0xc1'
const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})

/** A decoded-Fight-shaped object. The first read bootstraps the live mob; the later positive-HP read is an ahead,
 * complete replacement base. */
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
 *  `removes` tap (that suite never needed it; this one's whole point is proving entity_remove fires once). */
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
  'voxel fight adapter — corpse state follows the one-pipeline snapshot boundary',
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

    test('a receipt-dead mob despawns, then an ahead alive base mounts it again (#1336)', async () => {
      fight_store.getState().input({
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

      // ── DEATH — poll early-copy (no presentation wave): sync_entities discovers the canonical Hit, and V1
      // floors it. A second object snapshot is checkpoint-only, so it cannot be used to synthesize this edge. ──
      fight_store.getState().input({
        type: 'poll',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            event('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 30,
              remaining_hp: 0,
            }),
          ],
        },
      })
      const died = await poll(() => board.calls.beats.some((b) => b.id === 'mob-0' && b.anim === 'death'))
      expect(died, 'the poll-only death was never folded into a death beat').toBe(true)
      const removed = await poll(() => board.calls.removes.includes('mob-0'))
      expect(removed, 'the corpse never despawned (entity_remove never called)').toBe(true)
      expect(
        engine_view(fight_store.getState()).fighters.get('mob-0').committed_dead,
        'mob-0 is floor-dead at v6'
      ).toBe(true)

      // ── AHEAD REPLACEMENT (#1336) — v7 is beyond the v6 event cursor, so this complete object becomes the base.
      // The old retirement row is subsumed with the tail; projection and rig both return to the object's alive fact. ──
      board.calls.upserts.length = 0
      fight_store.getState().input({ type: 'snapshot', fight: fight_object(30), version: 7 })
      const remounted = await poll(() => board.calls.upserts.some((u) => u.id === 'mob-0'))
      expect(remounted, 'the ahead alive base did not remount mob-0').toBe(true)
      expect(
        engine_view(fight_store.getState()).fighters.get('mob-0').committed_dead,
        'the replacement base discards the subsumed retirement state'
      ).toBe(false)
    }, 20_000)
  }
)
