// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #37 — the fight-stream broadcast glue (board #49 STREAM-PREVIEW + PLACEMENT GHOSTS) predated tests entirely.
// Pins the REAL contract of init_fight_stream / stream_pick / on_peer_stream: idempotent install (the module has
// NO teardown by design — fight-stream.js:68 "the listeners live for the app lifetime" — so idempotent
// double-init is the one lifecycle property actually testable here), send-on-pick gating, fold-on-receive (the
// placement_ghost input), same-event dedupe, multi-peer fan-out, and the error path a throwing local-state read
// takes (a FINDING, pinned not fixed — see the last describe block's header).
//
// REAL PATH: the real room courtesy subscription, the real use_dungeon_turn store (zustand — picks are
// drafted through it exactly as DungeonBoard/voxel_fight_adapter do), the real fight_store singleton (seeded
// through the house test door, test_helpers/fight_core_harness.js) and the real board_view projection mirrored
// into use_dungeon.dungeon by hand (production wiring a poll loop performs; nothing polls in a unit test).
//
// The transport is NOT spied at all: this file joins a REAL lobby room over the house trystero double
// (test_helpers/trystero_mock.js) and reads/drives the wire. Sends are asserted off the recorded `fstream`
// frames; a peer signal is delivered through the real action handler, so `on_peer_stream` is exercised exactly
// as production registers it. Spying the transport's named exports instead would patch a module OTHER suites
// in this shared process also import — the #123 pollution class, with no restore that reaches them.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { deliver, reset_trystero_mock, trystero_sent } from '../../test_helpers/trystero_mock.js'
import { fight_store, presented_state } from '@aresrpg/fight/store'
import { board_view, fight_view } from '@aresrpg/fight/project'
import { install_browser_globals } from '../../test_helpers/browser_globals.js'
import { seed_fight_core, reset_fight_core } from '../../test_helpers/fight_core_harness.js'
import { use_dungeon_turn } from './dungeon-turn.js'

// dungeon_store.js reaches auth/index.ts (registerEnokiWallets touches `window` at module load). Install the
// browser globals before dynamically importing that chain.
const restore_browser_globals = install_browser_globals({ with_document: true })

const [lobby_room, { use_dungeon }, { init_fight_stream }] = await Promise.all([
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

const WORLD = `0x${'a'.repeat(64)}`

// ONE real room for the file: the sender half needs a live `fstream` action to send on, and the receiver half
// needs the handler production registers. Both come from actually joining.
beforeAll(() => {
  reset_trystero_mock()
  lobby_room.join_room(WORLD, ME, { x: 0, y: 0 })
})

/** A peer's courtesy signal, delivered through the REAL room action handler production registers. */
const fire = (payload) => deliver('fstream', payload)
const sent_to = (kind) =>
  trystero_sent
    .filter((row) => row.name === 'fstream')
    .map((row) => row.payload)
    .filter((p) => p.kind === kind)

/** Seed BOTH halves fight-stream.js reads: the fight core (the house test door) + its board_view mirror into
 *  use_dungeon.dungeon (dungeon_run_store's real projection — production wiring a poll loop performs; this
 *  reproduces it by hand since nothing polls in a unit test). Returns the fight_store singleton for chaining. */
function seed(opts) {
  const store = seed_fight_core({ fight_id: FIGHT_ID, my: ME, ...opts })
  use_dungeon.setState({ dungeon: board_view(store.getState()) })
  return store
}

afterEach(() => {
  trystero_sent.length = 0
  use_dungeon_turn.getState().clear_picks()
  use_dungeon.setState({ dungeon: null })
  reset_fight_core()
})

afterAll(() => {
  lobby_room.leave_room()
  restore_browser_globals()
})

describe('#37 init_fight_stream — idempotent install (no teardown by design)', () => {
  test('calling init twice never double-registers the packet/fightStream listener', () => {
    init_fight_stream()
    init_fight_stream()
    seed({ seats: [{ character: ME }, { character: PEER }], placement: true })
    fire({ dungeon_id: FIGHT_ID, address: PEER, kind: 'placement', target: CELL_A })
    expect(fight_view().placement_ghosts).toEqual([{ character: PEER, cell: CELL_A }])
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

  test('a drafted move on MY active turn streams a courtesy BATCH (the drafted turn in receipt vocabulary)', () => {
    const store = seed({ active: ME })
    // Draft a move — the fight core records my Moved intent; the store-driven sender streams it to peers as a batch.
    store.getState().input({ type: 'intent', intent: { kind: 'move', character: ME, to_cell: CELL_A } })
    const batches = sent_to('batch')
    expect(batches.length).toBe(1)
    expect(batches[0]).toMatchObject({ dungeon_id: FIGHT_ID, address: ME, kind: 'batch' })
    expect(batches[0].actions.some(a => a.kind === 'Moved' && a.to_cell === CELL_A)).toBe(true)
  })

  test('the same drafted batch streams ONCE — later unrelated store churn never re-broadcasts it', () => {
    const store = seed({ active: ME })
    store.getState().input({ type: 'intent', intent: { kind: 'move', character: ME, to_cell: CELL_A } })
    const first = sent_to('batch').length
    store.getState().input({ type: 'hand_update', hand: ['a'] }) // unrelated churn — no new draft
    expect(sent_to('batch').length).toBe(first)
  })

  test('a PEER turn (not mine) never streams a courtesy batch — the sender fires only for MY own turn', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], active: PEER })
    // A local draft is refused on a peer turn (provider gate); its refusal still churns the store, yet the
    // provider guard in the sender keeps anything off the wire.
    fight_store.getState().input({ type: 'intent', intent: { kind: 'move', character: ME, to_cell: CELL_A } })
    expect(sent_to('batch')).toEqual([])
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

  test('a legal PEER batch pre-paints through the core (legality lives in the fight core now, not this glue)', () => {
    const store = seed({ seats: [{ character: ME }, { character: PEER }], active: PEER }) // PEER seat 1 @ cell 101
    fire({
      dungeon_id: FIGHT_ID,
      address: PEER,
      kind: 'batch',
      intent_id: 'peer:mv',
      actions: [{ kind: 'Moved', character: PEER, to_cell: 102 }], // one step from 101 — within the peer's MP
    })
    expect(presented_state(store.getState()).fighters?.p1?.cell, 'the peer batch pre-painted the move').toBe(102)
  })

  test('my OWN echo (batch) never pre-paints — the own-echo guard drops it before the core door', () => {
    const store = seed({ active: ME })
    const before = presented_state(store.getState()).fighters?.p0?.cell
    fire({
      dungeon_id: FIGHT_ID,
      address: ME,
      kind: 'batch',
      intent_id: 'echo',
      actions: [{ kind: 'Moved', character: ME, to_cell: CELL_A }],
    })
    expect(presented_state(store.getState()).fighters?.p0?.cell, 'my own relay never paints itself').toBe(before)
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

// FINDING (partially resolved by #334): on_peer_stream still has NO try/catch, and the PLACEMENT branch calls
// dungeon.escrow.some(...) with no presence guard — a torn/mid-transition local record (missing escrow — a class
// board_state.js's own fight_geometry_complete / HOLD-NOT-DEGRADE handling treats as real) makes an arriving
// placement signal throw synchronously out of the room courtesy subscriber callback. The listener registration
// survives, so the next valid signal still folds. #334 removed
// the old turn_queue read (active_character_id): the COURTESY batch path reads only dungeon.id/status, so that
// torn-record class no longer throws — proven below.
// TODO(#37 follow-up): guard the placement escrow read too, so a torn record degrades to a dropped packet.
describe('#37 error path — a throwing consumer (FINDING, see comment above)', () => {
  test('a courtesy batch over a torn record (missing turn_queue) no longer throws — the batch path reads no turn_queue', () => {
    seed({ seats: [{ character: ME }, { character: PEER }], active: PEER })
    use_dungeon.setState((s) => {
      const { turn_queue, ...torn } = s.dungeon
      return { dungeon: torn }
    })
    expect(() =>
      fire({
        dungeon_id: FIGHT_ID,
        address: PEER,
        kind: 'batch',
        intent_id: 'peer:mv',
        actions: [{ kind: 'Moved', character: PEER, to_cell: 102 }],
      })
    ).not.toThrow()
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
