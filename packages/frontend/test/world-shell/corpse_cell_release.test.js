// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2025 (re-report of #1806) — A CORPSE NEVER BLOCKS A WALK, INCLUDING THE ONE I JUST MADE.
//
// #1806's pin (0258b5bfe) drove the kill as a RECEIPT — a chain-CONFIRMED death, so `committed_dead` flips true
// in the same input — and asserted only on `move_wash`. That never enters the window the player actually lives
// in: MY kill is PREDICTED first (`engine_view.dead = true`) and stays committed-alive until the receipt lands
// (`committed_dead = false`, pinned by fight/test/committed_liveness.test.js). In that window the client's
// SECOND blocked-set builder — `presentation_blocked_cells`, which the 3D board's steering preview and the
// click gate both path over — still held the cell, so the wash painted the cell reachable and the walk onto it
// silently did nothing (no hover path on desktop, a dead tap on mobile).
//
// The law, from the sim's own tripwire (`occupancy_exclusive` forbids LIVING actors only; `find_entity_at`
// drops health<=0) and its chain twin (`displacement::add_living_bodies`): occupancy is living-only in EVERY
// projection. So the two client builders must agree on liveness — the paint's `wash_blocked` reads the
// PRESENTED fold, and this one must too.
//
// Driven end to end on the real @aresrpg/fight store: kill the adjacent mob, then walk the freed cell in the
// SAME turn (prediction only, pre-receipt) and on the NEXT read (receipt + snapshot). Both halves of the
// verdict are asserted — the reachable SET (`presentation_blocked_cells`) and the RESOLVED movement
// (`move_plan_dungeon`, the plan the click executes) — against the sim-side twin (`move_wash`, whose BFS is
// @aresrpg/sim's `bfs_reachable`).

import { describe, expect, test } from 'bun:test'
import { decode, encode } from '@aresrpg/fight/los'
import { engine_view, move_wash } from '@aresrpg/fight/project'

import { active_store, ev, fight_object, ME, mob, participant, T0 } from '../../../fight/harness/fixtures.js'
import { move_plan_dungeon } from '../../src/fight-engine/overlay_intents.js'
import { presentation_blocked_cells } from '../../src/world-shell/fight_board_blockers.js'

// Canonical stride 20. Me at (1,1), the mob at (2,1), the prize at (3,1). With 3 MP the detour around a LIVING
// body costs 4 steps, so both cells are out of reach exactly while the body is alive — the fixture discriminates.
const ME_CELL = encode(1, 1)
const MOB_CELL = encode(2, 1)
const BEYOND_CELL = encode(3, 1)
const MP = 3

const board = (mob_hp = 20) =>
  fight_object({
    participants: [participant(ME, ME_CELL, { mp: MP, base_mp: MP })],
    mobs: [mob(MOB_CELL, { hp: mob_hp })],
  })

// An open board: PROVEN dims, no stored mask ⇒ the honest rectangle, no obstacles, no holes. The walls are the
// only thing `presentation_blocked_cells` reads off the dungeon; the bodies come from the projection.
const dungeon = {
  id: '0xboard2025',
  room_index: 0,
  grid_width: 20,
  grid_height: 19,
  shape_mask: [],
  obstacles: [],
  holes: [],
}

const blocked_of = (store) => presentation_blocked_cells(dungeon, engine_view(store.getState()).fighters, ME)

/** The resolved walk the click executes — the plan `on_cell_click` builds before it stages anything. */
const plan_to = (store, target) =>
  move_plan_dungeon({ cell: decode(ME_CELL) }, decode(target), { blocked: blocked_of(store), mp: MP })

const wash_reach = (store) => new Set(move_wash(store.getState(), { busy: false }).reach)

/** MY kill, exactly as the client folds it: a predicted lethal Hit, no receipt yet. */
const predict_kill = (store) =>
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } }, T0 + 1_000)

describe('#2025 — the cell of a mob I just killed is walkable in the same turn', () => {
  test('the living body really is what blocks the walk (the fixture discriminates)', () => {
    const store = active_store({ fight: board() })
    expect(blocked_of(store).has(MOB_CELL)).toBe(true)
    expect(plan_to(store, MOB_CELL)).toBeNull()
    expect(plan_to(store, BEYOND_CELL)).toBeNull()
    expect(wash_reach(store).has(BEYOND_CELL)).toBe(false)
  })

  test('the discriminating window exists: predicted-dead, committed-alive', () => {
    const store = active_store({ fight: board() })
    predict_kill(store)
    const corpse = engine_view(store.getState()).fighters.get('mob-0')
    expect(corpse.dead, 'the eye already renders my kill').toBe(true)
    expect(corpse.committed_dead, 'the chain has not acked it yet — the window #1806 never drove').toBe(false)
  })

  test('SAME TURN, pre-receipt: the reachable set frees the cell and the walk resolves through it', () => {
    const store = active_store({ fight: board() })
    predict_kill(store)
    expect(blocked_of(store).has(MOB_CELL), 'a corpse is not a body').toBe(false)
    expect(plan_to(store, MOB_CELL)?.mp_cost).toBe(1)
    expect(plan_to(store, BEYOND_CELL)?.mp_cost).toBe(2)
  })

  test('SAME TURN: the click gate and the movement paint agree cell-for-cell', () => {
    const store = active_store({ fight: board() })
    predict_kill(store)
    const blocked = blocked_of(store)
    // THE CLASS GATE (#1070): the client has two blocked-set builders. Every cell the paint offers must be a
    // cell the walk can resolve — a green cell the click refuses is the whole defect.
    for (const cell of wash_reach(store))
      expect(blocked.has(cell), `wash offers ${cell} but the gate blocks it`).toBe(false)
    expect(wash_reach(store).has(MOB_CELL)).toBe(true)
    expect(wash_reach(store).has(BEYOND_CELL)).toBe(true)
  })

  test('NEXT TURN — the receipt, then a snapshot carrying hp 0, keep the cell open', () => {
    const store = active_store({ fight: board() })
    predict_kill(store)
    store.getState().input(
      {
        type: 'receipt',
        version: 3,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20, remaining_hp: 0 })] },
      },
      T0 + 2_000
    )
    expect(engine_view(store.getState()).fighters.get('mob-0').committed_dead).toBe(true)
    expect(blocked_of(store).has(MOB_CELL)).toBe(false)
    expect(plan_to(store, BEYOND_CELL)?.mp_cost).toBe(2)

    store.getState().input({ type: 'snapshot', fight: board(0), version: 4 }, T0 + 3_000)
    expect(blocked_of(store).has(MOB_CELL)).toBe(false)
    expect(plan_to(store, BEYOND_CELL)?.mp_cost).toBe(2)
  })
})
