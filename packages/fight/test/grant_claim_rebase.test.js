// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import * as project from '../src/project.js'
import { create_fight_store, presented_state } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const START = 105
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: START,
      stats: { agility: 0 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 315, ap: 4, mp: 3, level: 1, stats: { agility: 0 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}
const vanish = [
  { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: START, damaging: false },
  { kind: 'Granted', target_is_mob: false, target_idx: 0, point_kind: 1, granted: 1 },
]

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const predict = (store, intent_id, now) =>
  store.getState().input({ type: 'predicted', intent_id, actions: vanish, basis_version: 6 }, now)

describe('silent grant claims rebase when an earlier prediction disappears', () => {
  test('the second Vanish contributes only its own +1 when the first Vanish fumbles', () => {
    const store = boot()
    predict(store, 'vanish:a', 2_000)
    predict(store, 'vanish:b', 2_010)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(5)

    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: {
          events: [
            {
              type: '0xpkg::fight_events::CriticalFailure',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 },
            },
            {
              type: '0xpkg::fight_events::Cast',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
            },
            {
              type: '0xpkg::fight_events::Cast',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
            },
          ],
        },
      },
      2_100
    )

    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
    expect(project.board_view(store.getState()).escrow[0].committed).toMatchObject({
      mp: 4,
      claimed_mp: 1,
      pending_mp: 0,
    })
  })

  test('the remaining Vanish rebases to +1 after targeted rollback of its predecessor', () => {
    const store = boot()
    predict(store, 'vanish:a', 2_000)
    predict(store, 'vanish:b', 2_010)

    store.getState().input({ type: 'rollback', intent_id: 'vanish:a' }, 2_100)

    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
    expect(project.board_view(store.getState()).escrow[0].committed.pending_mp).toBe(1)
  })

  test('p2p-first move confirmation cannot displace the absolute spend needed by a later delta grant', () => {
    const store = boot()
    const destination = START + 1
    const moved = { fight: FIGHT, character: CHAR, to_cell: destination }
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: destination, mp_left: 2 } }, 2_000)
    store.getState().input(
      {
        type: 'predicted',
        intent_id: 'vanish:after-move',
        actions: [{ ...vanish[0], target_cell: destination }, vanish[1]],
        basis_version: 6,
      },
      2_010
    )
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)

    // The early canonical Moved occupies the prediction's exact (version,event_idx), but cannot carry mp_left.
    store.getState().input(
      {
        type: 'p2p',
        version: 6,
        receipt: { events: [{ type: '0xpkg::fight_events::Moved', parsedJson: moved }] },
      },
      2_050
    )
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)

    store.getState().input(
      {
        type: 'journal',
        fight_id: FIGHT,
        page: {
          fight: FIGHT,
          journal_head: '2',
          events: [{ seq: '0', version: '6', kind: 'Moved', data: moved }],
        },
      },
      2_100
    )
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)

    store.getState().input(
      {
        type: 'journal',
        fight_id: FIGHT,
        page: {
          fight: FIGHT,
          journal_head: '2',
          events: [
            {
              seq: '1',
              version: '6',
              kind: 'Cast',
              data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: destination },
            },
          ],
        },
      },
      2_200
    )
    expect(store.getState().budget_predictions).toEqual([])
    expect(
      store
        .getState()
        .claimed_budget.map((row) => row.action.kind)
        .sort()
    ).toEqual(['Granted', 'Moved'])
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)
  })

  test('a confirmed move keeps its own spend when the cast that funded its absolute remainder fumbles', () => {
    const store = boot()
    const destination = START + 1
    predict(store, 'vanish:before-move', 2_000)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: destination, mp_left: 3 } }, 2_010)

    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: {
          events: [
            {
              type: '0xpkg::fight_events::CriticalFailure',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 },
            },
            {
              type: '0xpkg::fight_events::Cast',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
            },
            {
              type: '0xpkg::fight_events::Moved',
              parsedJson: { fight: FIGHT, character: CHAR, to_cell: destination },
            },
          ],
        },
      },
      2_100
    )

    expect(presented_state(store.getState()).fighters.p0.mp).toBe(2)
  })

  test('a pending move keeps its own spend when the preceding grant is rolled back', () => {
    const store = boot()
    predict(store, 'vanish:before-move', 2_000)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: START + 1, mp_left: 3 } }, 2_010)

    store.getState().input({ type: 'rollback', intent_id: 'vanish:before-move' }, 2_100)

    expect(presented_state(store.getState()).fighters.p0.mp).toBe(2)
  })

  test('a rolled-back grant does not erase overspend debt before a later undo refund', () => {
    const store = boot()
    predict(store, 'vanish:funding-fourth-step', 2_000)
    for (const [i, mp_left] of [3, 2, 1, 0].entries())
      store
        .getState()
        .input(
          { type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: START + i + 1, mp_left } },
          2_010 + i
        )
    // Backtrack one cell while the +1 still exists: the current draft now costs 3, leaving 1 of its four MP.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: START + 3, mp_left: 1 } }, 2_020)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(1)

    store.getState().input({ type: 'rollback', intent_id: 'vanish:funding-fourth-step' }, 2_100)

    // The same three-step draft exhausts the base pool. Per-row clamping would lose the fourth step's -1 debt and
    // then expose the undo's +1 refund, incorrectly reporting one MP.
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(0)
  })

  test('undo actions dispatched after rollback measure from the unclamped movement balance', () => {
    const store = boot()
    predict(store, 'vanish:rolled-back-before-undo', 2_000)
    for (const [i, mp_left] of [3, 2, 1, 0].entries())
      store
        .getState()
        .input(
          { type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: START + i + 1, mp_left } },
          2_010 + i
        )

    store.getState().input({ type: 'rollback', intent_id: 'vanish:rolled-back-before-undo' }, 2_100)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(0)

    // The first undo repays the hidden -1 debt, so the visible absolute remains zero; the second must then expose
    // one MP. Deriving either delta from the clamped zero instead of the raw balance loses the first refund.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: START + 3, mp_left: 0 } }, 2_110)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: START + 2, mp_left: 1 } }, 2_120)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(1)
  })

  for (const source of ['p2p', 'poll'])
    test(`${source} TurnEnded bounds restored budget evidence before journal confirmation`, () => {
      const store = boot()
      predict(store, `vanish:${source}-turn-boundary`, 2_000)

      store.getState().input(
        {
          type: source,
          version: 6,
          receipt: {
            events: [
              {
                type: '0xpkg::fight_events::Cast',
                parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
              },
              {
                type: '0xpkg::fight_events::TurnEnded',
                parsedJson: { fight: FIGHT, is_mob: false, idx: 0 },
              },
            ],
          },
        },
        2_100
      )

      // M2b intentionally waits for receipt/journal proof before retiring the prediction metadata, but the target's
      // accepted turn boundary must already make its current-turn budget evidence inert.
      expect(store.getState().budget_predictions).not.toEqual([])
      expect(store.getState().log.some((action) => action.kind === 'Granted')).toBe(false)
      expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)
      expect(project.board_view(store.getState()).escrow[0].committed.pending_mp).toBe(0)

      store.getState().input(
        {
          type: 'journal',
          fight_id: FIGHT,
          page: {
            fight: FIGHT,
            journal_head: '2',
            events: [
              { seq: '0', version: '6', kind: 'Cast', data: { fight: FIGHT, ...vanish[0] } },
              {
                seq: '1',
                version: '6',
                kind: 'TurnEnded',
                data: { fight: FIGHT, is_mob: false, idx: 0 },
              },
            ],
          },
        },
        2_200
      )
      expect(store.getState().budget_predictions).toEqual([])
      expect(store.getState().claimed_budget).toEqual([])
      expect(Object.values(store.getState().entries).some((action) => action.source === 'intent')).toBe(false)
      expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)
    })
})
