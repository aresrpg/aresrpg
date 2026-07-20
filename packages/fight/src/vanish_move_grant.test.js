// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ① VANISH +MP · move-wash ↔ move-gate ONE-HOME — a Vanish MP grant wasn't usable for movement even though the
// green zones showed it should be. Two consumers of the post-Vanish movement
// budget: the GREEN WASH (project.move_wash, off the PRESENTED pool — grant folded ALWAYS via the Granted arm) and
// the DRAFT GATE (DungeonBoard my_mp_eff = committed + `cast_first ? grant : 0`). They diverge MOVE-FIRST: the wash
// painted a cell the gate — and the chain — refuse. On-chain give_points is IMMEDIATE (cast.move:1099
// participant::give_points) but the commit ships [moves, casts] when the move is drafted first, so apply_move
// spends the BASE pool before the grant lands (draft_budget.js FIX 1). ONE rule now: the grant funds movement iff
// cast_first (draft_budget.movement_grant), and move_wash strips it otherwise so green == gate == chain.
import { describe, expect, test } from 'bun:test'

import { bfsReachable } from './los.js'
import * as project from './project.js'
import { create_fight_store, committed_state, presented_state } from './store.js'

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x
const START = cell(5, 5)
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
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
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(15, 15), ap: 4, mp: 3, level: 1, stats: { agility: 0 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}
const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input({ type: 'arm', spell_id: 'weapon' }, 1_000) // keeps the move wash live on my playable turn
  return store
}
const granted_mp = (n) => ({ kind: 'Granted', target_is_mob: false, target_idx: 0, point_kind: 1, granted: n })
const vanish_cast = (target) => ({
  kind: 'Cast',
  caster_is_mob: false,
  caster_idx: 0,
  target_cell: target,
  damaging: false,
})
const wash_reach = (store) => project.move_wash(store.getState(), { busy: false, targeting: false }).reach.length
const wash_blocked = (store) => {
  const p = presented_state(store.getState())
  const blocked = new Set()
  for (const f of Object.values(p.fighters ?? {})) if (f.key !== 'p0' && f.alive && f.cell != null) blocked.add(f.cell)
  return blocked
}

describe('① Vanish +MP — the green wash never paints reach the move gate refuses', () => {
  test('CAST-FIRST: the grant DOES fund movement — wash reach == the raised (base+grant) budget', () => {
    const store = boot()
    store.getState().input({ type: 'predicted', actions: [vanish_cast(START), granted_mp(1)], basis_version: 6 }, 2_000)
    expect(project.draft_cast_first(store.getState().log)).toBe(true)
    // committed base 3 + grant 1 (spendable cast-first) = 4 MP of reach from the un-moved cell.
    const expected = bfsReachable(START, 4, wash_blocked(store)).length
    expect(committed_state(store.getState()).fighters.p0.mp).toBe(3)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
    expect(wash_reach(store)).toBe(expected)
  })

  test('MOVE-FIRST: the grant does NOT fund this turn — wash reach == the base budget after the step (grant stripped)', () => {
    const store = boot()
    // Draft a 1-step move first (mp_left = base-1 = 2; grant excluded move-first, exactly as DungeonBoard folds it),
    // THEN Vanish. The Granted arm still raises the PRESENTED pool (HUD MP is honest), but movement can't spend it.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: cell(6, 5), mp_left: 2 } }, 2_000)
    store
      .getState()
      .input({ type: 'predicted', actions: [vanish_cast(cell(6, 5)), granted_mp(1)], basis_version: 7 }, 2_100)
    expect(project.draft_cast_first(store.getState().log)).toBe(false)
    // The presented pool reads base(3): 2 left after the step + 1 grant. The chain honors only the 2 for movement.
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)
    const honest = bfsReachable(cell(6, 5), 2, wash_blocked(store)).length // 2 MP — grant NOT spendable move-first
    const grant_expanded = bfsReachable(cell(6, 5), 3, wash_blocked(store)).length // the over-show the wash MUST NOT paint
    expect(honest).not.toBe(grant_expanded) // the divergence is real (guards the assertion below)
    expect(wash_reach(store)).toBe(honest) // RED at HEAD: paints grant_expanded (mp 3), not honest (mp 2)
  })
})
