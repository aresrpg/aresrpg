// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1806 — A CORPSE NEVER BLOCKS A WALK. Occupancy is LIVING-only on every home: the sim's `make_is_occupied`
// (find_entity_at drops health<=0), the chain's `displacement::add_living_bodies` (twin fixture:
// packages/move/engine/tests/corpse_release_tests.move), and the client's two blocked-set builders —
// `project.move_wash`'s wash_blocked and the frontend's `presentation_blocked_cells`.
//
// The drive kills the one body standing between me and the far cell, then asserts the walk opens: the instant
// the kill's beat has presented (same turn), and again on the next read that adopts hp 0. Both are asserted on
// the WASH — the movement paint's home.
//
// #2025 CORRECTION: this file's kill arrives as a RECEIPT, so `committed_dead` flips inside the same input and
// the pre-ack window never opens here. The wash is NOT "the one home the click gate reads" — the gate paths over
// `presentation_blocked_cells`, which lagged a whole receipt behind on MY OWN predicted kill and refused the
// freed cell. That half is driven in frontend test/world-shell/corpse_cell_release.test.js; this file stays the
// chain-acked leg.
//
// Measured while writing this (the reported symptom's window): for the length of the killing beat the move
// affordance is disarmed wholesale (`input_armed` → `presenting`), so during that window there is no reach set
// at all rather than a reach set with the corpse cut out of it. Once the beat drains, the retirement floor binds
// and the cell is free — which is why the assertions below drain first.

import { describe, expect, test } from 'bun:test'

import { ev, FIGHT, fight_object, ME, mob, participant, T0 } from '../harness/fixtures.js'
import { engine_view, move_wash } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

// GRID_W = 20. me at (1,1)=21, the mob at (2,1)=22, the prize at (3,1)=23. With 3 MP the detour around a LIVING
// body costs 4 steps, so 22 and 23 are both out of reach exactly while the body is alive.
const ME_CELL = 21
const MOB_CELL = 22
const BEYOND_CELL = 23

const board = (mob_hp = 20) =>
  fight_object({
    participants: [participant(ME, ME_CELL, { mp: 3, base_mp: 3 })],
    mobs: [mob(MOB_CELL, { hp: mob_hp })],
  })

const booted = () => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: board(), version: 1 }, T0 + 10)
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
      version: 2,
    },
    T0 + 100
  )
  return store
}

/** Run the eye's clock until nothing is left to present — the beat is the animation, never a legality fact. */
const present_out = (store, from) => {
  for (let i = 0; i < 80; i += 1) store.getState().input({ type: 'tick' }, from + i * 500)
}

const reach_of = (store) => new Set(move_wash(store.getState(), { busy: false }).reach)

describe('#1806 — a dead mob releases its cell', () => {
  test('the living body really is what blocks the walk (the fixture discriminates)', () => {
    const store = booted()
    const wash = move_wash(store.getState(), { busy: false })
    expect(wash.armed).toBe(true)
    expect(wash.reach.length).toBeGreaterThan(0)
    expect(wash.reach).not.toContain(MOB_CELL)
    expect(wash.reach).not.toContain(BEYOND_CELL)
  })

  test('the kill opens the cell in the SAME turn', () => {
    const store = booted()
    store.getState().input(
      {
        type: 'receipt',
        version: 3,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20, remaining_hp: 0 })] },
      },
      T0 + 1_000
    )
    // `presentation_blocked_cells` keys on committed_dead — the gate flag flips at the receipt, not at the beat.
    expect(engine_view(store.getState()).fighters.get('mob-0').committed_dead).toBe(true)
    present_out(store, T0 + 1_000)
    const reach = reach_of(store)
    expect(reach.has(MOB_CELL)).toBe(true)
    expect(reach.has(BEYOND_CELL)).toBe(true)
  })

  test('the NEXT read agrees — a snapshot carrying hp 0 keeps the cell open', () => {
    const store = booted()
    store.getState().input({ type: 'snapshot', fight: board(0), version: 4 }, T0 + 2_000)
    expect(engine_view(store.getState()).fighters.get('mob-0').committed_dead).toBe(true)
    const reach = reach_of(store)
    expect(reach.has(MOB_CELL)).toBe(true)
    expect(reach.has(BEYOND_CELL)).toBe(true)
  })
})
