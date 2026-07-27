// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import * as project from '../src/project.js'
import { STATUS_ROOM_CLEARED, STATUS_WON } from '../src/board_state.js'
import { create_fight_store } from '../src/store.js'

const fight_id = '0xoutcome-confirmation'
const character_id = '0xhero'

const active_fight = {
  id: fight_id,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xowner',
      character: character_id,
      team: 0,
      hp: 40,
      max_hp: 40,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 20,
      ready: true,
    },
  ],
  mobs: [{ hp: 5, max_hp: 5, cell: 100 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 50_000,
  turn_entropy: 50_000,
  turn_ordinal: 1,
}

const victory_event = {
  type: '0xengine::fight_events::Victory',
  parsedJson: { fight: fight_id },
}

const framing_winner = (state) =>
  typeof project.outcome_winner === 'function' ? project.outcome_winner(state) : project.winner(state)

describe('transaction-confirmed outcome presentation', () => {
  test('optimistic victory freezes input but cannot publish framing before the ending receipt', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: 'p0',
      ctx: { my_entity_id: character_id, rooms_total: 1 },
    })
    store.getState().input({ type: 'snapshot', fight: active_fight, version: 1 }, 1_000)
    store.getState().input({
      type: 'intent',
      version: 2,
      event_idx: 0,
      intent: { kind: 'Victory' },
    })

    expect(project.is_over(store.getState()), 'optimistic terminal still freezes fight input').toBe(true)
    expect(project.board_view(store.getState()).status, 'the killing prediction may still paint').toBe(STATUS_WON)
    expect(framing_winner(store.getState()), 'no result framing before chain terminal').toBe(null)

    store.getState().input({
      type: 'receipt',
      version: 2,
      fight_id,
      receipt: { events: [victory_event] },
    })

    expect(framing_winner(store.getState()), 'the ending receipt publishes framing').toBe(0)
  })

  test('a confirmed non-last-room clear never publishes terminal Victory/Defeat framing', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: 'p0',
      ctx: { my_entity_id: character_id, run: { room: 1 }, rooms_total: 2 },
    })
    store.getState().input({ type: 'snapshot', fight: active_fight, version: 1 }, 1_000)
    store.getState().input({
      type: 'receipt',
      version: 2,
      fight_id,
      receipt: { events: [victory_event] },
    })

    expect(project.chain_terminal_status(store.getState())).toBe(STATUS_ROOM_CLEARED)
    expect(project.outcome_winner(store.getState())).toBe(null)
  })
})
