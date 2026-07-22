// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #334 — THE COURTESY CHANNEL's legality gate (pure). A peer's relayed draft is a PREDICTION on my board; it
// PAINTS, so an injected illegal batch must never reach the eye. This gate reduces the peer's batch over MY
// committed state with the SAME spatial primitive the local draft/chain use (bfsPathCost), and DROPS + FLAGS a
// batch that could not legally be that fighter's turn. It gates STRUCTURE (living author, own in-budget moves, own
// casts), never a cast's private damage/range — those effects ride as presentation, the receipt is their truth.

import { describe, expect, test } from 'bun:test'

import { peer_batch_legality } from './peer_legality.js'

// encode(x,y) = y*20 + x (los.js GRID_W=20): 22=(2,1) 24=(4,1) 28=(8,1). A coop board: ME p0 @21, PEER p1 @22
// (turn-start MP 3), one mob m0 @45. The gate reads committed positions + the turn-start refill budget only.
const committed = () => ({
  fighters: {
    p0: { cell: 21, alive: true },
    p1: { cell: 22, alive: true },
    m0: { cell: 45, alive: true },
  },
  active: 'p0',
})
const view = () => ({ escrow: [{ base_mp: 3 }, { base_mp: 3 }], obstacles: [], holes: [] })
const resolve_seat = character => ({ '0xchar_a': 0, '0xchar_b': 1 }[character] ?? null)

const gate = (actor_key, actions, over = {}) =>
  peer_batch_legality({ committed: committed(), view: view(), actor_key, actions, resolve_seat, ...over })

describe('#334 peer_batch_legality — the courtesy legality gate', () => {
  test('a living actor moving its OWN cell within its turn-start MP is legal', () => {
    // p1 from 22=(2,1) to 24=(4,1): 2 cells, within MP 3.
    expect(gate('p1', [{ kind: 'Moved', character: '0xchar_b', to_cell: 24 }])).toEqual({ legal: true })
  })

  test('an OVER-BUDGET move (6 cells, MP 3) is illegal with reason over_budget_move', () => {
    // p1 from 22=(2,1) to 28=(8,1): 6 cells > MP 3.
    expect(gate('p1', [{ kind: 'Moved', character: '0xchar_b', to_cell: 28 }])).toEqual({
      legal: false,
      reason: 'over_budget_move',
    })
  })

  test('a SPOOFED move (authored as ANOTHER fighter) is illegal with reason spoofed_mover', () => {
    // Broadcaster is p1 but the Moved is authored as ME (0xchar_a = seat 0) — a cross-seat forgery.
    expect(gate('p1', [{ kind: 'Moved', character: '0xchar_a', to_cell: 24 }])).toEqual({
      legal: false,
      reason: 'spoofed_mover',
    })
  })

  test('a dead or absent actor can never act', () => {
    const dead = { fighters: { p1: { cell: 22, alive: false } }, active: 'p1' }
    expect(
      peer_batch_legality({ committed: dead, view: view(), actor_key: 'p1', actions: [], resolve_seat })
    ).toEqual({ legal: false, reason: 'dead_or_absent_actor' })
    expect(
      peer_batch_legality({ committed: committed(), view: view(), actor_key: 'p9', actions: [], resolve_seat })
    ).toEqual({ legal: false, reason: 'dead_or_absent_actor' })
  })

  test('a mob-move inside a player turn is a spoof', () => {
    expect(gate('p1', [{ kind: 'MobMoved', idx: 0, to_cell: 44 }])).toEqual({
      legal: false,
      reason: 'mob_move_in_player_turn',
    })
  })

  test('a Cast by the actor itself is structurally legal (range/damage is the receipt’s truth, not the gate’s)', () => {
    expect(gate('p1', [{ kind: 'Cast', caster_is_mob: false, caster_idx: 1, target_cell: 45, damaging: true }])).toEqual(
      { legal: true }
    )
  })

  test('a Cast authored as ANOTHER fighter is a spoofed_caster', () => {
    expect(gate('p1', [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: 45 }])).toEqual({
      legal: false,
      reason: 'spoofed_caster',
    })
  })

  test('a null / mob actor_key resolves to no_actor', () => {
    expect(gate(null, [])).toEqual({ legal: false, reason: 'no_actor' })
    expect(gate('m0', [])).toEqual({ legal: false, reason: 'no_actor' })
  })

  test('a two-step move then a cast composes: the MP budget carries across the batch', () => {
    // p1: 22->24 (cost 2), leaving MP 1; then a cast (no MP cost). Legal.
    expect(
      gate('p1', [
        { kind: 'Moved', character: '0xchar_b', to_cell: 24 },
        { kind: 'Cast', caster_is_mob: false, caster_idx: 1, target_cell: 45 },
      ])
    ).toEqual({ legal: true })
  })
})
