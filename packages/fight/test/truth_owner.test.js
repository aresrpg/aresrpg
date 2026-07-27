// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE TRUTH OWNER. The committed board the renderer reads is projected from the HEADLESS CORE that lives in the
// store atom (`state.core`, fed by the ONE door). This suite pins WHICH SOURCE OWNS TRUTH, so it needs a state
// where committed truth and the eye provably DISAGREE: the fixture below drives one real stream through the store
// door and admits ONE EXTRA authoritative receipt into the core alone (through the public core door — never a
// hand-written board), so the committed reads land on 33/12 while the paced presentation still holds 7.
//
// The legacy settlement fold used to be the other half of these rows (#1027 retired it, PR #1171's ruling). The
// discriminator is now the one that always mattered: PRESENTATION IS A DIFFERENT QUESTION — the rendered `cell`
// comes from the paced display fold, so a committed read that silently dragged presentation along still fails.

import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { board_view, engine_view, committed_mob_hp, committed_truth } from '../src/project.js'
import { empty_core_state, ingest, project_board } from '../src/core.js'
import { input_envelope } from '../src/envelope.js'
import { classify_input } from '../src/classify_input.js'

const FIGHT = '0xb0x4'
const CHAR = '0xa11ce'

const active_fight = (cells) => ({
  width: 12,
  height: 12,
  status: 1, // active → base_from_view derives base_turn_number 1
  participants: [{ character: CHAR, cell: String(cells.p0), hp: '70', ap: '6', mp: '3' }],
  mobs: [{ cell: String(cells.m0), hp: '80' }],
})

const receipt = (version, events) => ({ type: 'receipt', fight_id: FIGHT, version, receipt: { events } })
const moved = (to_cell) => ({
  type: '0x0::fight_events::Moved',
  parsedJson: { fight: FIGHT, character: CHAR, to_cell },
})
const hit = (hp) => ({
  type: '0x0::fight_events::Hit',
  parsedJson: { fight: FIGHT, victim_is_mob: true, victim_idx: 0, amount: '68', remaining_hp: String(hp) },
})

// The stream BOTH sides see: a bootstrap snapshot, then a receipt that starts my turn and walks me to cell 7.
const SHARED = [
  { msg: { type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: {} }, at: 1 },
  { msg: { type: 'snapshot', fight_id: FIGHT, version: 100, fight: active_fight({ p0: 5, m0: 9 }) }, at: 2 },
  {
    msg: receipt(200, [
      {
        type: '0x0::fight_events::TurnStarted',
        parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 1784000000000 },
      },
      moved(7),
    ]),
    at: 3,
  },
]

// The EXTRA receipt only the core admits — a later authoritative version that walks me to 33 and wounds the mob to 12.
const CORE_ONLY = { msg: receipt(300, [moved(33), hit(12)]), at: 4 }

/** Fold an envelope stream through the PUBLIC v2 door — the same bridge the store's own door uses. */
const core_of = (stream) =>
  stream.reduce(
    (core, { msg, at }, index) =>
      ingest(
        core,
        input_envelope({
          session_id: msg?.fight_id ?? null,
          input_seq: index,
          observed_at_ms: at,
          payload: classify_input(msg),
        })
      ),
    empty_core_state()
  )

/** A store driven through the SHARED stream, with the divergent core installed in its atom. */
const diverged_store = () => {
  const store = create_fight_store()
  for (const { msg, at } of SHARED) store.getState().input(msg, at)
  store.setState({ core: core_of([...SHARED, CORE_ONLY]) })
  return store
}

describe('the core lives in the store atom, fed by the ONE door', () => {
  test('driving the door folds the core: no second ingress, no closure, a pure read off the state', () => {
    const store = create_fight_store()
    expect(project_board(store.getState().core).fighters).toEqual({}) // empty before anything is dispatched
    for (const { msg, at } of SHARED) store.getState().input(msg, at)

    const board = project_board(store.getState().core)
    expect(store.getState().core.fight_id).toBe(FIGHT)
    expect(board.fighters.p0.cell).toBe(7) // the receipt the door carried reached the core
    // `fight_view()`-shaped purity: the same state object projects to the same values, with no store call.
    expect(board).toEqual(project_board(store.getState().core))
  })

  test('the `{ page }` journal alias reaches the core too — an accepted shape is never silently ignored', () => {
    // seq 2 continues the accept cursor the SHARED receipt left at seq 1 (a hole would be a gap request, not a fold).
    const page = {
      fight: FIGHT,
      journal_head: '2',
      events: [
        { seq: '2', kind: 'Moved', data: { fight: FIGHT, character: CHAR, to_cell: 44 }, digest: 'd', version: '300' },
      ],
    }
    const store = create_fight_store()
    for (const { msg, at } of SHARED) store.getState().input(msg, at)
    store.getState().input({ type: 'journal', fight_id: FIGHT, page }, 5)

    expect(project_board(store.getState().core).fighters.p0.cell).toBe(44)
  })

  test('a message the classify bridge cannot read lands as a FAILURE on the core, never a throw', () => {
    const store = create_fight_store()
    const poison = {
      type: 'board_click',
      get cell() {
        throw new Error('boom')
      },
    }
    expect(() => store.getState().input(poison, 9)).not.toThrow()
    expect(store.getState().core.failures).toEqual([{ kind: 'malformed_envelope', at: 9 }])
  })
})

describe('the committed truth owner', () => {
  test('the fixture DIVERGES: the core-only receipt is one the eye has not reached (else this proves nothing)', () => {
    const store = diverged_store()
    const core = project_board(store.getState().core)
    expect(core.fighters.p0.cell).toBe(33) // the extra receipt only the core admitted
    expect(core.fighters.m0.hp).toBe(12)
    expect(board_view(store.getState()).escrow[0].cell).toBe(7) // the paced fold has not moved
  })

  test('board_view committed rows read the CORE, never the paced fold beside it', () => {
    const board = board_view(diverged_store().getState())
    expect(board.escrow[0].committed.cell).toBe(33)
    expect(board.mobs[0].committed.hp).toBe(12)
  })

  test('engine_view committed fields read the CORE, never the paced fold beside it', () => {
    const view = engine_view(diverged_store().getState())
    const mob = view.fighters.get('mob-0')
    expect(mob.committed_health).toBe(12)
    expect(mob.presented_health).toBe(12) // no wave draining → the committed value is what the card shows
  })

  test('committed_mob_hp reads the CORE', () => {
    expect(committed_mob_hp(diverged_store().getState(), 0)).toBe(12)
  })

  // #1027 — the TX-SHAPING read. DungeonBoard's flush resolves the clicked fighter through the eye-state, then asks
  // this door for the cell that goes into the PTB (`target_committed_cell` → txs.retarget_cast). It is the one
  // committed read whose answer is spent as gas, so it gets its own row: the eye still shows 7 here.
  test('committed_truth — the door the cast retarget shapes its PTB cell with — resolves off the CORE', () => {
    const state = diverged_store().getState()
    expect(committed_truth(state).fighters?.p0?.cell).toBe(33)
  })

  test('PRESENTATION stays on the paced display fold: the rendered cell is unmoved', () => {
    const board = board_view(diverged_store().getState())
    expect(board.escrow[0].cell).toBe(7)
  })
})

describe('the committed door is TOTAL — there is no second fold to answer from', () => {
  test('strip the core and the board does not resolve: no settlement arm silently stands in for it', () => {
    const store = create_fight_store()
    for (const { msg, at } of SHARED) store.getState().input(msg, at)
    const { core, ...coreless } = store.getState()
    expect(core).toBeDefined() // every real atom carries one; empty_core_state(null) is one too
    // The old fallback folded `entries` here and answered 7 — a SWITCH between two derivations, which ADR §2
    // forbids. With the legacy fold retired there is nothing to switch to, and this is what proves it.
    expect(() => board_view(coreless)).toThrow()
  })
})
