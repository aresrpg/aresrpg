// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #37 — the fight-stream broadcast glue (board #49 STREAM-PREVIEW + PLACEMENT GHOSTS) predated tests entirely.
// Pins the REAL contract of init_fight_stream / stream_pick / on_peer_stream: idempotent install (the module has
// NO teardown by design — fight-stream.js:68 "the listeners live for the app lifetime" — so idempotent
// double-init is the one lifecycle property actually testable here), send-on-pick gating, fold-on-receive (the
// placement_ghost input), same-event dedupe, multi-peer fan-out, and the error path a throwing local-state read
// takes (a FINDING, pinned not fixed — see the last describe block's header).
//
// REAL PATH: the real context.events bus (Node EventEmitter), the real use_dungeon_turn store (zustand — picks
// are drafted through it exactly as DungeonBoard/voxel_fight_adapter do), the real fight_store singleton (seeded
// through the house test door, test_helpers/fight_core_harness.js) and the real board_view projection mirrored
// into use_dungeon.dungeon by hand (production wiring a poll loop performs; nothing polls in a unit test). The
// ONLY fake is the transport edge — p2p/lobby-room.js's broadcast_fight_stream — spied exactly like
// world_fight_party_public.test.js spies broadcast_state: a named-export spy that mockRestore()s in afterAll,
// never a mock.module (a process-global registry entry that would outlive this file — the #123 pollution class).

import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'

import { fight_store } from '@aresrpg/fight/store'
import { board_view, fight_view } from '@aresrpg/fight/project'
import * as log_module from '../../core/log.js'
import { install_browser_globals } from '../../test_helpers/browser_globals.js'
import { seed_fight_core, reset_fight_core } from '../../test_helpers/fight_core_harness.js'
import { use_dungeon_turn } from './dungeon-turn.js'

// fight-stream.js pulls in dungeon_store.js + p2p/lobby-room.js, whose import chain reaches auth/index.ts
// (registerEnokiWallets touches `window` at MODULE-LOAD time — a browser-only side effect, not lazy). The house
// fix (world_fight_party_public.test.js) is the same here: install a fake window/document/localStorage BEFORE
// dynamically importing that chain, so the eager read resolves instead of throwing under bun's Node-like runner.
const restore_browser_globals = install_browser_globals({ with_document: true })

const [{ context }, lobby_room, { use_dungeon }, { init_fight_stream }] = await Promise.all([
  import('../store.js'),
  import('../../p2p/lobby-room.js'),
  import('../../world-shell/dungeon_store.js'),
  import('./fight-stream.js'),
])

const FIGHT_ID = '0xf1'
const ME = '0xme'
const PEER = '0xpeer'
const PEER_2 = '0xpeer2'
const CELL_A = 40
const CELL_B = 41
const CELL_C = 42

// Idempotent per app-lifetime install (fight-stream.js:70-84) — safe to call once here at module load, exactly
// as the dungeon bridge does on the app's first sync.
init_fight_stream()

const broadcast_spy = spyOn(lobby_room, 'broadcast_fight_stream').mockImplementation(() => {})
// game_log is a real, side-effect-free ring buffer (silent unless debug is on — core/log.js) — spying it is safe
// and gives an observable proxy for "did on_peer_stream's move/cast branch reach verify_and_render_*", which has
// NO store write to assert on directly (see the S2-FLIP comment in fight-stream.js: render returns at S4).
// FOUND VIA MUTATION-TESTING: game_log is a SHARED cross-cutting logger — seeding a real fight_store snapshot
// also wakes an unrelated combat-music edge subscriber that logs under its OWN 'music'/'fight' tags. Filter to
// the exact 'fight-stream' namespace verify_and_render_move/cast use, or this spy false-positives on noise that
// has nothing to do with the glue under test.
const log_spy = spyOn(log_module, 'game_log')
const fire = (payload) => context.events.emit('packet/fightStream', payload)
const sent_to = (kind) => broadcast_spy.mock.calls.map(([p]) => p).filter((p) => p.kind === kind)
const fight_stream_logs = () => log_spy.mock.calls.filter(([ns]) => ns === 'fight-stream')

/** Seed BOTH halves fight-stream.js reads: the fight core (the house test door) + its board_view mirror into
 *  use_dungeon.dungeon (dungeon_run_store's real projection — production wiring a poll loop performs; this
 *  reproduces it by hand since nothing polls in a unit test). Returns the fight_store singleton for chaining. */
function seed(opts) {
  const store = seed_fight_core({ fight_id: FIGHT_ID, my: ME, ...opts })
  use_dungeon.setState({ dungeon: board_view(store.getState()) })
  return store
}

afterEach(() => {
  broadcast_spy.mockClear()
  log_spy.mockClear()
  use_dungeon_turn.getState().clear_picks()
  use_dungeon.setState({ dungeon: null })
  reset_fight_core()
})

afterAll(() => {
  broadcast_spy.mockRestore()
  log_spy.mockRestore()
  restore_browser_globals()
})

describe('#37 init_fight_stream — idempotent install (no teardown by design)', () => {
  test('calling init twice never double-registers the packet/fightStream listener', () => {
    const before = context.events.listenerCount('packet/fightStream')
    init_fight_stream()
    init_fight_stream()
    expect(context.events.listenerCount('packet/fightStream')).toBe(before)
  })
})

describe('#37 send-on-pick — SENDER gating (stream_pick, driven through the REAL use_dungeon_turn subscription)', () => {
  test('a placement pick during STATUS_PLACEMENT broadcasts kind:placement for my own escrow seat', () => {
    seed({ placement: true })
    use_dungeon_turn.getState().set_placement_pick(CELL_A)
    expect(sent_to('placement')).toEqual([{ dungeon_id: FIGHT_ID, address: ME, kind: 'placement', target: CELL_A }])
  })

  test('a placement pick OUTSIDE placement (fight already active) never broadcasts', () => {
    seed({ placement: false, active: ME })
    use_dungeon_turn.getState().set_placement_pick(CELL_A)
    expect(sent_to('placement')).toEqual([])
  })

  test('a drafted move while it is genuinely my ACTIVE turn broadcasts kind:move', () => {
    seed({ active: ME })
    use_dungeon_turn.getState().set_move_target(CELL_A)
    expect(sent_to('move')).toEqual([{ dungeon_id: FIGHT_ID, address: ME, kind: 'move', target: CELL_A }])
  })

  test('a drafted cast on a PEER turn (not mine) never broadcasts — only the active seat streams its own turn', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], active: PEER })
    use_dungeon_turn.getState().set_cast_target(CELL_A)
    expect(sent_to('cast')).toEqual([])
  })

  test('clearing a pick (null) never broadcasts — the drafted-off no-op, not a stream event', () => {
    seed({ active: ME })
    use_dungeon_turn.getState().set_move_target(CELL_A)
    broadcast_spy.mockClear()
    use_dungeon_turn.getState().set_move_target(null)
    expect(broadcast_spy).not.toHaveBeenCalled()
  })

  test('a pick never broadcasts once my own escrow seat desyncs locally (the escrow.some guard)', () => {
    seed({ active: ME })
    use_dungeon.setState((s) => ({ dungeon: { ...s.dungeon, escrow: [] } })) // my_entity_id resolves, but I'm not seated locally
    use_dungeon_turn.getState().set_move_target(CELL_A)
    expect(broadcast_spy).not.toHaveBeenCalled()
  })
})

describe('#37 fold-on-receive — RECEIVER gating + the placement_ghost fold (on_peer_stream)', () => {
  test('a valid peer placement pick folds into fight_store as ONE placement_ghost', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([{ character: PEER, cell: CELL_A }])
  })

  // NOTE (found via mutation-testing fight-stream.js's own guard away): for PLACEMENT this is defense-in-depth —
  // fold.js's store reducer has its OWN independent own-seat exclusion (store.js:591), so this assertion alone
  // does not pin fight-stream.js's line specifically. The two move/cast tests below DO pin it in isolation: those
  // kinds never touch the store (no backstop), so on_peer_stream's own-echo guard is their ONLY defense.
  test('my OWN echo (placement) never becomes a ghost of myself', () => {
    seed({ placement: true })
    fire({ dungeon_id: FIGHT_ID, address: ME, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([])
  })

  test('a legit PEER move (active seat, in range, unobstructed) reaches sim-verify (game_log fires) — proves the filtered log spy below actually detects a real invocation, not a false negative', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], active: PEER }) // PEER seat 1 @ cell 101 = (1,5)
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'move', target: 102 }) // (2,5) — one step, unobstructed
    expect(fight_stream_logs().length).toBe(1)
  })

  test('my OWN echo (move) never reaches verify — the ONLY guard for move/cast, no store backstop exists', () => {
    seed({ active: ME })
    fire({ dungeon_id: FIGHT_ID, address: ME, kind: 'move', target: CELL_A })
    expect(fight_stream_logs()).toEqual([])
  })

  test('a wrong dungeon_id (stale/foreign broadcast) is dropped', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true })
    fire({ dungeon_id: '0xsomeotherfight', address: PEER, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([])
  })

  test('a peer not seated in MY escrow is dropped (a spoofed address never becomes a ghost)', () => {
    seed({ seats: [{ character: ME }], placement: true }) // PEER never seated
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([])
  })

  test('a placement stream arriving after the fight left placement is dropped', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], active: ME }) // status ACTIVE, not placement
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([])
  })
})

describe('#37 dedupe/idempotency — the one-pipeline law (same event twice = one application)', () => {
  test('firing the identical peer placement event twice yields exactly ONE ghost, not two', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([{ character: PEER, cell: CELL_A }])
  })

  test('a re-pick from the SAME peer replaces (never accumulates) — latest pick wins', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_B })
    expect(fight_view().placement_ghosts).toEqual([{ character: PEER, cell: CELL_B }])
  })
})

describe('#37 fan-out — multiple distinct peers project independently, in stable key order', () => {
  test('two different peers each keep their own ghost; a later re-pick from one never disturbs the other', () => {
    seed({ seats: [{ character: ME }, { character: PEER }, { character: PEER_2 }], placement: true })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    fire({ dungeon_id: FIGHT_ID, address: PEER_2, kind: 'placement', target: CELL_B })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_C }) // PEER re-picks
    // insertion order is PEER-then-PEER_2 (re-assigning an existing key never moves it) — first-seen order.
    expect(fight_view().placement_ghosts).toEqual([
      { character: PEER, cell: CELL_C },
      { character: PEER_2, cell: CELL_B },
    ])
  })
})

// FINDING (pinned, not fixed — brief scope is unit coverage only): on_peer_stream has NO try/catch.
// active_character_id(dungeon) indexes dungeon.turn_queue[dungeon.turn_ptr] and the placement branch calls
// dungeon.escrow.some(...) with no presence guard on either field. A torn/mid-transition local dungeon record
// (missing turn_queue/escrow — a class this codebase already treats as real: board_state.js's own
// fight_geometry_complete / HOLD-NOT-DEGRADE handling) makes an arriving peer packet throw SYNCHRONOUSLY out of
// context.events.emit. This is NOT a silent swallow — Node's EventEmitter propagates a listener's throw to the
// emit() caller (lobby-room.js's fight_stream_action.onMessage, invoked directly by Trystero's WebRTC message
// dispatch, which has no try/catch of its own either), so in production this surfaces as an uncaught exception
// on that one inbound message. The listener registration itself survives (EventEmitter does not unsubscribe a
// throwing listener), so the next valid packet still folds correctly.
// TODO(#37 follow-up): guard on_peer_stream's two unguarded reads so a torn local record degrades to a dropped
// packet instead of an uncaught throw — matches the no-silent-failure law without going silent either way.
describe('#37 error path — a throwing consumer (FINDING, see comment above)', () => {
  test('TODO(#37 follow-up): a move/cast stream over a torn dungeon record (missing turn_queue) throws — pinned', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], active: ME })
    use_dungeon.setState((s) => {
      const { turn_queue, ...torn } = s.dungeon
      return { dungeon: torn }
    })
    // address must be a genuine PEER, not ME — an own-echo (address === my_entity_id) returns before this
    // throwing read is ever reached, and a self-test here would pass for the wrong reason.
    expect(() => fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'move', target: CELL_A })).toThrow()
  })

  test('TODO(#37 follow-up): a placement stream over a torn dungeon record (missing escrow) throws — pinned', () => {
    seed({ placement: true })
    use_dungeon.setState((s) => {
      const { escrow, ...torn } = s.dungeon
      return { dungeon: torn }
    })
    expect(() => fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })).toThrow()
  })

  test('the listener survives its own throw — the NEXT valid packet on a healthy record still folds normally', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true })
    use_dungeon.setState((s) => {
      const { escrow, ...torn } = s.dungeon
      return { dungeon: torn }
    })
    expect(() => fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })).toThrow()
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true }) // heal the record
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_B })
    expect(fight_view().placement_ghosts).toEqual([{ character: PEER, cell: CELL_B }])
  })
})
