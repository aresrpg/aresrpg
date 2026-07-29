// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1672 — "RangeError: Maximum call stack size exceeded at base_from_view … at recompute" killed an ordinary
// 2-mob world fight at turn 5, right after a successful cast. The reported frames (fold_base/recompute, plus
// voxel_fight_adapter / dungeon_store / fight_session_scope) are the PRESENTATION fold, not the store drain —
// so the issue asks for the same shape to be re-driven on POST-#1636 edge to tell a live independent recursion
// site apart from the cured store class wearing different frames.
//
// The cure's own row (fight/test/store_reentrant_drain.test.js) drives the bare store with a synthetic `error`
// subscriber. It never touches the world feedback cascade that produced these frames: every fight-store
// notification runs the dungeon projection mirror (dungeon_run_store's `use_dungeon.setState({ dungeon:
// board_view(s) })` → presented_state → base_from_view), the busy mirror that dispatches back INTO the door,
// and the adapter's own drain_wave/reconcile (→ fight_view_in_scope). This row drives THAT path, in the
// reported shape, and measures the fold's synchronous stack depth per turn.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()

function audio_stub() {
  this.play = () => Promise.resolve()
  this.pause = () => {}
  this.addEventListener = () => {}
  this.removeEventListener = () => {}
}
const had_audio = 'Audio' in globalThis
if (!had_audio) globalThis.Audio = audio_stub

const { fight_store } = await import('@aresrpg/fight/store')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { SENSHI_MALE_GLB_AVAILABLE } = await import('../../src/test_helpers/glb_fixture.js')
const { create_voxel_fight_adapter } = await import('../../src/world-shell/voxel_fight_adapter.js')

const FIGHT = '0x1672-fight'
const CHAR = '0xc1672'
const TURNS = 10 // the report died at 5; drive well past it
const MY_CELL = 100

const event = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

/** The reported shape: an ordinary WORLD fight seating one of my characters against TWO mobs. */
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
      hp: 900,
      max_hp: 900,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: MY_CELL,
      ready: true,
      casts_this_turn: 0,
    },
  ],
  mobs: [
    { template: '0xabc', level: 1, hp: 900, max_hp: 900, cell: 105, ap: 4, mp: 3 },
    { template: '0xabc', level: 1, hp: 900, max_hp: 900, cell: 106, ap: 4, mp: 3 },
  ],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [MY_CELL],
  start_cells_b: [105, 106],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
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

/** My successful cast on mob 0, predicted optimistically exactly as the HUD commits it. */
const my_cast_prediction = (turn) => ({
  type: 'predicted',
  intent_id: `cast-${turn}`,
  basis_version: 5 + turn,
  actions: [
    { kind: 'Cast', target_cell: 105, caster_is_mob: false, caster_idx: 0 },
    { kind: 'Hit', victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 900 - 5 * turn },
  ],
  beats: [
    {
      kind: 'cast',
      at: 0,
      duration: 1,
      payload: { source_id: CHAR, spell_id: 'dungeon_strike', cell: { x: 5, y: 5 } },
    },
  ],
})

/** The authoritative receipt that resolves my turn AND both mob turns — the single-PTB cascade shape. */
const round_receipt = (turn) => ({
  type: 'receipt',
  version: 5 + turn,
  receipt: {
    events: [
      event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
      event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 900 - 5 * turn }),
      event('TurnEnded', { is_mob: false, idx: 0 }),
      event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
      event('MobMoved', { idx: 0, to_cell: 104 + (turn % 3) }),
      event('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: MY_CELL }),
      event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 3, remaining_hp: 900 - 6 * turn }),
      event('TurnEnded', { is_mob: true, idx: 0 }),
      event('TurnStarted', { is_mob: true, idx: 1, deadline_ms: 0 }),
      event('MobMoved', { idx: 1, to_cell: 108 + (turn % 3) }),
      event('Cast', { caster_is_mob: true, caster_idx: 1, target_cell: MY_CELL }),
      event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 3, remaining_hp: 900 - 6 * turn - 3 }),
      event('TurnEnded', { is_mob: true, idx: 1 }),
      event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
    ],
  },
})

const make_board = () => {
  const calls = { beats: [], upserts: [], moves: [], floats: [] }
  const beat_promise = () => {
    const p = Promise.resolve()
    p.done = Promise.resolve()
    p.duration_ms = 1
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

// Injected rather than inherited: the ambient game context is a module singleton whose engine events are only
// wired by a mounted app, so a suite-wide run would otherwise mount this adapter against an uninitialised bus.
const game_context = {
  events: { on: () => {}, off: () => {}, emit: () => {} },
  dispatch: () => {},
  get_state: () => ({ sui: { characters: [] } }),
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const poll = async (predicate, { timeout = 8_000, step = 20 } = {}) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (predicate()) return true
    await sleep(step)
  }
  return predicate()
}

/** Synchronous stack depth at this instant — the only place the recursion was ever observable. */
const stack_depth = () => {
  const previous = Error.stackTraceLimit
  Error.stackTraceLimit = Infinity
  const depth = (new Error().stack ?? '').split('\n').length
  Error.stackTraceLimit = previous
  return depth
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('#1672 · the world presentation fold survives a multi-turn fight', () => {
  const board = make_board()
  const adapter_handle = { current: null }

  const boot = async () => {
    fight_store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 })
    expect(use_dungeon.getState().dungeon?.id, 'the projection mirror must publish the live board').toBe(FIGHT)
    if (adapter_handle.current) return
    adapter_handle.current = create_voxel_fight_adapter(board, { game_context })
    const wired = await poll(() => board.calls.upserts.some((u) => u.id === CHAR))
    expect(wired, 'the adapter never built/wired the board').toBe(true)
  }

  afterAll(() => {
    adapter_handle.current?.destroy()
    fight_store.getState().input({ type: 'init', fight_id: null })
    use_dungeon.setState({ fight_id: null, fight_fresh: false })
    if (!had_audio) delete globalThis.Audio
    restore_browser_globals()
  })

  // THE INSTRUMENT'S POSITIVE CONTROL. A depth measurement that only ever reports "flat" proves nothing unless
  // the same harness is shown to CATCH a real non-converging feedback edge on this exact cascade. Pre-#1636 this
  // subscriber walked the stack off its end (RangeError); the flat drain must now stop it BY NAME instead.
  test('a non-converging subscriber on the live world cascade is refused by name, never by a stack overflow', async () => {
    await boot()
    const unsubscribe = fight_store.subscribe(() => {
      fight_store.getState().input({ type: 'error', message: `storm ${Math.random()}` })
    })
    let thrown = null
    try {
      fight_store.getState().input(round_receipt(1))
    } catch (error) {
      thrown = error
    }
    unsubscribe()
    expect(thrown, 'the harness never provoked the pathology — the instrument is not measuring anything').toBeTruthy()
    expect(thrown?.name, 'the fold walked off the stack instead of refusing the storm').not.toBe('RangeError')
    expect(thrown?.message).toContain('re-entrant inputs folded during ONE input')
  }, 30_000)

  // THE DEPTH GATE. The world cascade's real feedback edges (the roster adoption's ctx re-entry, the busy
  // mirror, the wave acks) dispatch back INTO the door from inside a notification, and each of them runs the
  // PROJECTION fold on the way (engine_view_of → fold_canonical / presented_state → base_from_view). Pre-#1636
  // every such re-entrant input nested a whole fold+notify frame set, so depth grew with the fan-out and the
  // deepest projection call tipped the stack — the reported RangeError. Depth must be O(1) in the fan-out.
  const feed_on_notify = (budget) => {
    let left = budget
    let max_depth = 0
    const unsubscribe = fight_store.subscribe(() => {
      max_depth = Math.max(max_depth, stack_depth())
      if (left <= 0) return
      left -= 1
      fight_store.getState().input({ type: 'error', message: `world feedback ${left}` })
    })
    return { unsubscribe, depth: () => max_depth }
  }

  test('re-entrant fan-out across the world cascade costs no stack', async () => {
    await boot()

    const few = feed_on_notify(10)
    fight_store.getState().input(round_receipt(1))
    few.unsubscribe()

    const many = feed_on_notify(400)
    fight_store.getState().input(round_receipt(2))
    many.unsubscribe()

    // 40x the re-entrant inputs, through the real projection fold, must cost no meaningful extra stack.
    expect(
      many.depth() - few.depth(),
      `the fold nests per re-entrant input (10 → ${few.depth()} frames, 400 → ${many.depth()} frames)`
    ).toBeLessThan(20)
  }, 30_000)

  test('ten folded turns with a successful cast never grow the fold stack', async () => {
    // the storm above deliberately left the singleton mid-fight; re-adopt a clean base for the real drive.
    await boot()

    // Probe BOTH legs of the reported cascade: the fight store's own notification and the dungeon projection
    // mirror's. A probe on one store alone would be blind to a cycle that closes through the other.
    const depths = []
    const record = () => depths.push(stack_depth())
    const off_fight_probe = fight_store.subscribe(record)
    const off_dungeon_probe = use_dungeon.subscribe(record)

    const per_turn = []
    let paced_mob_turns = 0
    for (let turn = 1; turn <= TURNS; turn += 1) {
      const before = depths.length
      // a successful cast, then the receipt that resolves it and both mob turns — the reported shape
      fight_store.getState().input(my_cast_prediction(turn))
      fight_store.getState().input(round_receipt(turn))
      paced_mob_turns += (fight_store.getState().wave ?? []).filter((t) => !t.is_local).length
      await sleep(60)
      const window = depths.slice(before)
      per_turn.push(window.length ? Math.max(...window) : 0)
    }
    off_fight_probe()
    off_dungeon_probe()

    // THE DRIVE MUST HAVE HAPPENED. A flat depth over a fold that never ran is a lying green: assert the
    // presentation lane actually paced non-local turns and that every probe leg fired.
    expect(paced_mob_turns, 'no mob turn was ever paced — the presentation fold never ran').toBeGreaterThan(0)
    expect(depths.length, 'neither store ever notified — the probe measured nothing').toBeGreaterThan(TURNS)

    const [first] = per_turn
    const worst = Math.max(...per_turn)
    // A per-turn recursion shows up as depth GROWING with the turn count; the reported death was at turn 5.
    expect(
      worst,
      `the presentation fold's stack grows with turns (per-turn max depth: ${per_turn.join(', ')})`
    ).toBeLessThan(first * 2)

    // …and the fight is still alive and folding past the turn it died on.
    expect(fight_store.getState().view?.id, 'the fight died mid-drive').toBe(FIGHT)
    expect(use_dungeon.getState().dungeon?.id, 'the projection mirror stopped publishing').toBe(FIGHT)
    expect(fight_store.getState().applied_version).toBe(5 + TURNS)
    // eslint-disable-next-line no-console
    console.log(`#1672 drive — per-turn max fold depth: ${per_turn.join(', ')} (paced mob turns: ${paced_mob_turns})`)
  }, 60_000)
})
