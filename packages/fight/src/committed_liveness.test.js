// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { active_store, ev, ME, T0 } from '../harness/fixtures.js'

import { board_view, engine_view } from './project.js'

describe('committed-floored action liveness', () => {
  test('a predicted-dead mob stays alive for action gates while rendering the predicted death', () => {
    const store = active_store()
    store
      .getState()
      .input(
        { type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } },
        T0 + 1_000
      )

    const [board_mob] = board_view(store.getState()).mobs
    const engine_mob = engine_view(store.getState()).fighters.get('mob-0')
    expect(board_mob.alive, 'render projection still paints the optimistic kill').toBe(false)
    expect(engine_mob.dead, 'engine render projection still paints the optimistic kill').toBe(true)
    expect(engine_mob.health).toBe(0)
    expect(board_mob.committed.alive, 'board action gates read the committed floor').toBe(true)
    expect(board_mob.committed.hp).toBe(20)
    expect(engine_mob.committed_alive, 'engine action gates read the committed floor').toBe(true)
    expect(engine_mob.committed_dead).toBe(false)
    expect(engine_mob.committed_health).toBe(20)
    expect(engine_view(store.getState()).fighters.get(ME).committed_alive).toBe(true)
  })
})

describe('per-action receipt divergence', () => {
  test('a chain-applied HP delta that differs from its prediction is adopted and surfaced once', () => {
    const store = active_store()
    store.getState().input({
      type: 'predicted',
      intent_id: 'cast:fifth',
      actions: [{ kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 }],
    })
    store.getState().input(
      {
        type: 'receipt',
        version: 3,
        receipt: {
          events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 13, remaining_hp: 7 })],
        },
      },
      T0 + 2_000
    )

    expect(board_view(store.getState()).mobs[0].committed.hp, 'authoritative receipt delta wins').toBe(7)
    expect(store.getState().divergence).toMatchObject({
      kind: 'action',
      action: 'Hit:m0',
      predicted: { remaining_hp: 0 },
      applied: { remaining_hp: 7 },
      shown: false,
    })
  })
})
