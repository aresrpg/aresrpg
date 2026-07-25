// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// BOX 4 (issue #522) — THE TRUTH-OWNER CUTOVER. The committed board the renderer reads is now projected from the
// HEADLESS CORE that lives in the store atom (`state.core`, fed by the ONE door), not from the legacy `committed_state`
// fold. This suite pins WHICH SOURCE OWNS TRUTH, so it needs a state where the two folds provably DISAGREE: the
// divergence fixture below drives one real stream through the store door and admits ONE EXTRA authoritative receipt
// into the core alone (through the public v2 door — never a hand-written board). The legacy fold cannot know that
// receipt, so every committed field renders one value under the old owner and another under the new one.
//
// RED before the swap (the committed projections render the legacy numbers), GREEN after. The ROLLBACK case asserts
// the epic-mandated one-flip escape hatch: `truth_source: 'legacy'` restores the legacy fold in the same projection.
//
// PRESENTATION IS UNTOUCHED by this box (boxes 5-7 own it): the rendered `cell` still comes from the legacy display
// fold, and the assertions below pin that too — a cutover that silently dragged presentation along would be a
// regression, not this ticket.

import { describe, test, expect } from 'bun:test'

import {
  create_fight_store,
  committed_state,
  truth_source_from,
  TRUTH_QUERY_PARAM,
  TRUTH_STORAGE_KEY,
} from '../../src/store.js'
import { board_view, engine_view, committed_mob_hp } from '../../src/project.js'
import { empty_core_state, ingest, project_board } from '../../src/v2/index.js'
import { input_envelope } from '../../src/envelope.js'
import { classify_input } from '../../src/classify_input.js'

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

describe('box 4 — the core lives in the store atom, fed by the ONE door', () => {
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

  test('the legacy `{ page }` journal alias reaches the core too — an accepted shape is never silently ignored', () => {
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
    expect(committed_state(store.getState()).fighters.p0.cell).toBe(44) // both folds saw the same page
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

describe('box 4 — the committed truth owner', () => {
  test('the fixture DIVERGES: the two folds disagree on cell and hp (else this suite proves nothing)', () => {
    const store = diverged_store()
    const legacy = committed_state(store.getState())
    const core = project_board(store.getState().core)
    expect(legacy.fighters.p0.cell).toBe(7)
    expect(core.fighters.p0.cell).toBe(33)
    expect(legacy.fighters.m0.hp).toBe(80)
    expect(core.fighters.m0.hp).toBe(12)
  })

  test('board_view committed rows read the CORE, not the legacy fold', () => {
    const board = board_view(diverged_store().getState())
    expect(board.escrow[0].committed.cell).toBe(33)
    expect(board.mobs[0].committed.hp).toBe(12)
  })

  test('engine_view committed fields read the CORE, not the legacy fold', () => {
    const view = engine_view(diverged_store().getState())
    const mob = view.fighters.get('mob-0')
    expect(mob.committed_health).toBe(12)
    expect(mob.presented_health).toBe(12) // no wave draining → the committed value is what the card shows
  })

  test('committed_mob_hp reads the CORE', () => {
    expect(committed_mob_hp(diverged_store().getState(), 0)).toBe(12)
  })

  test('PRESENTATION stays on the legacy fold (boxes 5-7 own it): the rendered cell is unmoved', () => {
    const board = board_view(diverged_store().getState())
    expect(board.escrow[0].cell).toBe(7)
  })
})

describe('box 4 — the one-flip rollback switch', () => {
  test('the pure arm check: DEFAULT is the core; only an explicit "0" rolls back', () => {
    expect(truth_source_from()).toBe('core')
    expect(truth_source_from({})).toBe('core')
    expect(truth_source_from({ search: `?${TRUTH_QUERY_PARAM}=0` })).toBe('legacy')
    expect(truth_source_from({ search: `?${TRUTH_QUERY_PARAM}=1` })).toBe('core')
    const stored = (value) => (key) => (key === TRUTH_STORAGE_KEY ? value : null)
    expect(truth_source_from({ storage_get: stored('0') })).toBe('legacy')
    expect(truth_source_from({ storage_get: stored('1') })).toBe('core')
    // an EXPLICIT query value beats the stored preference, both directions
    expect(truth_source_from({ search: `?${TRUTH_QUERY_PARAM}=1`, storage_get: stored('0') })).toBe('core')
    expect(truth_source_from({ search: `?${TRUTH_QUERY_PARAM}=0`, storage_get: stored('1') })).toBe('legacy')
    expect(truth_source_from({ search: '?other=1' })).toBe('core')
  })

  test("truth_source: 'legacy' restores the legacy fold in every committed projection", () => {
    const store = diverged_store()
    store.setState({ truth_source: 'legacy' })
    const board = board_view(store.getState())
    expect(board.escrow[0].committed.cell).toBe(7)
    expect(board.mobs[0].committed.hp).toBe(80)
    expect(engine_view(store.getState()).fighters.get('mob-0').committed_health).toBe(80)
    expect(committed_mob_hp(store.getState(), 0)).toBe(80)
  })

  test('a hand-built state that never crossed the door (no core) still projects through the legacy fold', () => {
    const store = create_fight_store()
    for (const { msg, at } of SHARED) store.getState().input(msg, at)
    const { core, ...coreless } = store.getState()
    expect(core).toBeDefined() // the real atom always carries one — this case is tests/tools only
    expect(board_view(coreless).escrow[0].committed.cell).toBe(7)
  })
})
