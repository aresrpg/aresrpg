// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BEAT PLAYBACK — the mount seam (regression coverage: "there is no more floating numbers in fights").
//
// THE CONTRACT UNDER TEST: the render adapter's playback leg. The core paces receipt turns into `state.wave`
// (fight/present.js — DATA, proven by the multi-turn gold row); the adapter's drain_wave → bind_render_turn →
// play_* chain must turn each beat into a VISUAL MOUNT on the board handle:
//   · a 'damage' beat  → board.entity_beat(victim, { anim:'hit', float:{ text:'-N', kind:'damage' } })  (the floater)
//   · a 'cast' beat    → board.entity_beat(caster, { anim:'attack' })                                   (the swing)
// The trap this suite exists to catch: fight_render_queue SLEEPS each beat's `duration` even when its render()
// silently no-ops — so turn PACING stays perfect (every data-level assert green) while every mount is dead
// (the exact reported symptom). Pacing green ∧ mounts dead is UNREPRESENTABLE only if a test drives the REAL
// adapter and asserts the board calls — no other row does (the queue-clock row binds a REPLICA of the
// drain shape, not the adapter's own binding).
//
// This is the FIRST test to mount the real create_voxel_fight_adapter: real singleton fight_store, real
// use_dungeon projection tail (dungeon_run_store's fight_store.subscribe), fake recording board. Headless
// (engine:null) — the delivery-VFX orb needs a live engine, so the cast leg's observable here is the swing
// beat + the sequenced victim package (exactly the no-engine path play_cast declares).

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// the adapter drags the browser-flavoured graph (auth/i18n/toast/context) — window must exist BEFORE import.
const restore_browser_globals = install_browser_globals()
// play_element_sfx does `new Audio(...)` on the CAST leg (mob caster-layer SFX). bun has no Audio; without
// this stub the cast slot THROWS mid-render and the queue (slot-isolated by design) plays every OTHER beat —
// a harness artifact that faked the exact "swing never mounted" red this suite exists to catch for real.
function AudioStub() {
  this.play = () => Promise.resolve()
  this.pause = () => {}
  this.addEventListener = () => {}
  this.removeEventListener = () => {}
}
const had_audio = 'Audio' in globalThis
// @ts-expect-error test shim
if (!had_audio) globalThis.Audio = AudioStub

const { fight_store } = await import('@aresrpg/fight/store')
const { use_dungeon } = await import('./dungeon_store.js')
const { SENSHI_MALE_GLB_AVAILABLE } = await import('../test_helpers/glb_fixture.js')
// GLB RESOLVER (#771): voxel_fight_adapter.js reaches an absent engine-local senshi_male.glb import;
// the Bun preload maps it to the tracked frontend runtime GLB's CDN route (see test_helpers/glb_fixture.js).
const { create_voxel_fight_adapter } = SENSHI_MALE_GLB_AVAILABLE ? await import('./voxel_fight_adapter.js') : {}

const FIGHT = '0xbeat-fight'
const CHAR = '0xc1'
const MOB_HIT_ON_ME = 7
// STAT_BUFF/STAT_DEBUFF are the reported leak (an owner live-report saw a literal slug floating over a fighter):
// the sim passes its own effect type straight through as the status name (fight_stat_effects.js / evolve.js).
const STANDALONE_STATUSES = ['SHIELD', 'STUN', 'POISON', 'GLYPH', 'STAT_BUFF', 'STAT_DEBUFF']

/** A decoded-Fight-shaped object the core's snapshot door adopts (fight_board_simdrive.test.js's harness,
 *  ACTIVE status so derive_phase wants a live board). */
const FIGHT_OBJECT = {
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
  mobs: [{ template: '0xabc', level: 1, hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3 }], // { x: 5, y: 5 }
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
}

const event = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

/** My committed end-turn resolving the mob's whole turn in ONE receipt (the ack-window CASCADE shape):
 *  the mob walks 105→107, casts at my cell, hits me for 7. */
const CASCADE = [
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
  event('MobMoved', { idx: 0, to_cell: 107 }),
  event('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 100 }),
  event('Hit', { victim_is_mob: false, victim_idx: 0, amount: MOB_HIT_ON_ME, remaining_hp: 43 }),
  event('TurnEnded', { is_mob: true, idx: 0 }),
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
]

/** A recording BoardHandle stand-in: every mount surface writes a row; beats resolve like the engine facade
 *  (the returned promise resolves "at impact", `.done` at natural end, `.duration_ms` a real clip length). */
const make_board = () => {
  const calls = { beats: [], upserts: [], moves: [], floats: [] }
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
    entity_remove: () => {},
    entity_move: (id, path) => {
      calls.moves.push({ id, path })
      return Promise.resolve()
    },
    entity_beat: (id, opts) => {
      calls.beats.push({ id, ...opts })
      return beat_promise()
    },
    float: (id, payload) => calls.floats.push({ id, ...payload }),
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
  'voxel fight adapter — wave beats become VISUAL MOUNTS (the floater/VFX playback leg)',
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

    test('a receipt damage beat mounts the floater and the cast beat mounts the swing on the board handle', async () => {
      // ── boot the live fight through the ONE door (the projection tail fills use_dungeon.dungeon itself) ──
      fight_store.getState().input({
        type: 'init',
        fight_id: FIGHT,
        my_key: 'p0',
        ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
      })
      fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 })
      expect(use_dungeon.getState().dungeon?.id, 'the run store must project the live board record').toBe(FIGHT)

      adapter_handle.current = create_voxel_fight_adapter(board)
      // the board build is async — the rigs must exist before the receipt (entity_ids gates every mount).
      const wired = await poll(
        () => board.calls.upserts.some((u) => u.id === CHAR) && board.calls.upserts.some((u) => u.id === 'mob-0')
      )
      expect(wired, 'the adapter never built/wired the board (no fighter rigs upserted)').toBe(true)

      // ── standalone statuses: feed the exact renderer-neutral specs the real prediction producer emits.
      //    OWNER LAW (live report, floats = numbers only): a float is a NUMBER — damage / heal / AP / MP.
      //    A status beat must mount NO float at all; the arm that printed `String(payload.status)` shipped raw
      //    effect slugs ("STAT_BUFF") as floating combat numbers over the fighters. ──
      fight_store.getState().input({
        type: 'predicted',
        intent_id: 'status-presentation',
        basis_version: 6,
        actions: [],
        beats: STANDALONE_STATUSES.map((status) => ({
          kind: 'status',
          at: 0,
          duration: 0,
          payload: { target_id: CHAR, status },
          source_turn: 'status-presentation',
        })),
      })
      await sleep(250) // give the (forbidden) status floats every chance to land before counting
      expect(
        board.calls.floats,
        'a status beat mounted a slug float — floats are numbers only (damage / heal / AP / MP)'
      ).toEqual([])

      // ── DRAIN keeps its OWN arm — and it speaks in NUMBERS (the AP/MP pool delta, see
      //    voxel_fight_adapter_drain_float.test.js), never the status name as a text float ──
      fight_store.getState().input({
        type: 'predicted',
        intent_id: 'drain-presentation',
        basis_version: 6,
        actions: [],
        beats: [
          {
            kind: 'status',
            at: 0,
            duration: 0,
            payload: { target_id: CHAR, caster_id: CHAR, status: 'DRAIN', pool: 'ap', landed: 0, dodged: 0 },
            source_turn: 'drain-presentation',
          },
        ],
      })
      await sleep(200)
      expect(
        board.calls.floats.some((row) => row.text === 'DRAIN'),
        'a DRAIN status beat mounted the generic status float — its combat-log arm is shadowed'
      ).toBe(false)

      // ── the receipt: the mob's whole paced turn (move → cast → hit me for 7) enters the wave ──
      fight_store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 })
      expect(
        fight_store.getState().wave.some((t) => t.source_id === 'mob-0'),
        'the core must pace a non-local mob turn (the stream half is NOT under test here)'
      ).toBe(true)

      // ── THE MOUNT ASSERTS — the reported bug class: pacing plays, mounts never fire ──
      await poll(() => board.calls.beats.some((b) => b.float) && board.calls.beats.some((b) => b.anim === 'attack'))

      const swing = board.calls.beats.find((b) => b.id === 'mob-0' && b.anim === 'attack')
      expect(swing, "the cast beat never mounted the caster's attack swing on the board").toBeTruthy()

      const floater = board.calls.beats.find(
        (b) => b.id === CHAR && b.anim === 'hit' && b.float?.kind === 'damage' && b.float?.text === `-${MOB_HIT_ON_ME}`
      )
      expect(
        floater,
        `the damage beat never mounted the '-${MOB_HIT_ON_ME}' floater on the struck fighter (regression: "no more floating numbers in fights")`
      ).toBeTruthy()

      // the mob's paced walk also drives the rig (playback, not pacing — same dead-mount class).
      expect(
        board.calls.moves.some((m) => m.id === 'mob-0' && m.path?.length),
        "the move beat never drove the mob's walk on the board"
      ).toBe(true)
    }, 20_000)
  }
)
