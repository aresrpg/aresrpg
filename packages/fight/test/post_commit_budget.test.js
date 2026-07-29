// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1113 — a committed turn publishes its leftover AP/MP even when the same receipt starts the next turn.

import { describe, expect, test } from 'bun:test'

import { board_view, engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'

const fight = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'tomoda',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 30,
      max_hp: 30,
      cell: 100,
    },
  ],
  mobs: [{ template: '0xabc', hp: 20, max_hp: 20, cell: 105, ap: 4, mp: 3 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const event = (kind, parsedJson) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...parsedJson },
})

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight, version: 5 }, 1_000)
  return store
}

describe('#1113 — post-commit budget publication', () => {
  test('the resolved turn leftovers survive the next-turn refill in both public projections', () => {
    const store = boot()
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: 105, damaging: true, ap_cost: 2 } }, 2_000)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: 102, mp_left: 1 } }, 2_100)
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' } }, 4_100)

    expect(engine_view(store.getState()).fighters.get(CHAR)).toMatchObject({ ap: 4, mp: 1 })

    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        events: [
          event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
          event('Moved', { character: CHAR, to_cell: 102 }),
          event('TurnEnded', { is_mob: false, idx: 0 }),
          event('TurnStarted', { is_mob: true, idx: 0 }),
          event('TurnEnded', { is_mob: true, idx: 0 }),
          event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 180_000 }),
        ],
      },
      5_000
    )

    const fighter = engine_view(store.getState()).fighters.get(CHAR)
    expect(fighter, 'live pool is the newly refilled turn').toMatchObject({ ap: 6, mp: 3 })
    expect(fighter.post_commit_ap, 'engine/HUD projection publishes resolved AP').toBe(4)
    expect(fighter.post_commit_mp, 'engine/HUD projection publishes resolved MP').toBe(1)
    expect(board_view(store.getState()).post_commit_budget, 'board/test projection publishes the same pools').toEqual({
      ap: 4,
      mp: 1,
      version: 6,
    })
  })
})
