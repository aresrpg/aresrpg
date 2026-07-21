// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ① VANISH +MP · ordered prefix parity — on-chain give_points is immediate, so a Vanish grant funds every move
// DRAFTED AFTER that cast, including move→Vanish→move. The presented pool already folds the prefix in exact order;
// the move wash must consume that pool without the old first-kind regrouping.
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
const cast_data = {
  fight: FIGHT,
  caster_is_mob: false,
  caster_idx: 0,
  target_cell: START,
}
const confirm_cast = {
  receipt: () => ({
    type: 'receipt',
    version: 6,
    receipt: { events: [{ type: '0xpkg::fight_events::Cast', parsedJson: cast_data }] },
  }),
  journal: () => ({
    type: 'journal',
    fight_id: FIGHT,
    page: {
      fight: FIGHT,
      journal_head: '1',
      events: [{ seq: '0', version: '6', kind: 'Cast', data: cast_data }],
    },
  }),
}
const wash_reach = (store) => project.move_wash(store.getState(), { busy: false, targeting: false }).reach.length
const wash_cells = (store) => new Set(project.move_wash(store.getState(), { busy: false, targeting: false }).reach)
const wash_blocked = (store) => {
  const p = presented_state(store.getState())
  const blocked = new Set()
  for (const f of Object.values(p.fighters ?? {})) if (f.key !== 'p0' && f.alive && f.cell != null) blocked.add(f.cell)
  return blocked
}

describe('① Vanish +MP — the next move consumes the ordered draft prefix', () => {
  test('Vanish→move: the grant funds movement from the raised pool', () => {
    const store = boot()
    store.getState().input({ type: 'predicted', actions: [vanish_cast(START), granted_mp(1)], basis_version: 6 }, 2_000)
    expect(project.draft_cast_first(store.getState().log)).toBe(true)
    // committed base 3 + immediate grant 1 = 4 MP of reach from the un-moved cell.
    const expected = bfsReachable(START, 4, wash_blocked(store)).length
    expect(committed_state(store.getState()).fighters.p0.mp).toBe(3)
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
    expect(wash_reach(store)).toBe(expected)
  })

  for (const source of ['receipt', 'journal'])
    test(`M2b ${source.toUpperCase()}: the Cast claim preserves its chain-silent grant across a checkpoint`, () => {
      const store = boot()
      const four_steps_away = cell(9, 5)
      expect(wash_cells(store).has(four_steps_away), 'base 3 MP cannot reach a cell four steps away').toBe(false)

      store.getState().input(
        {
          type: 'predicted',
          intent_id: `cast:vanish:${source}`,
          actions: [vanish_cast(START), granted_mp(1)],
          basis_version: 6,
        },
        2_000
      )
      expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
      expect(wash_cells(store).has(four_steps_away), 'the optimistic +1 MP extends the overlay').toBe(true)

      // M2b accepts the same canonical Cast through either transport. Cast is the batch's claim anchor, while
      // give_points emits no journal event; settling the claim must retire the prediction without erasing the
      // current-turn grant it proved. This is the boundary the pre-M2b tests never crossed.
      store.getState().input(confirm_cast[source](), 2_100)
      expect(Object.values(store.getState().entries).some((e) => e.source === 'intent')).toBe(false)
      expect(presented_state(store.getState()).fighters.p0.mp, 'the accepted Cast keeps its +1 MP').toBe(4)
      expect(wash_cells(store).has(four_steps_away), 'the accepted grant keeps the range overlay extended').toBe(true)
      expect(store.getState().divergence).toBeNull()

      // A post-M2b object read is checkpoint-only. Even though its row also says mp=4, it cannot be the repair
      // path: the accepted claim overlay above must already hold, and the bootstrap view remains at version 5.
      store.getState().input(
        {
          type: 'snapshot',
          version: 7,
          journal_head: '1',
          fight: { ...FIGHT_OBJECT, participants: [{ ...FIGHT_OBJECT.participants[0], mp: 4 }] },
        },
        2_200
      )
      expect(store.getState().view_version).toBe(5)
      expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
      expect(wash_cells(store).has(four_steps_away)).toBe(true)
    })

  test('move→Vanish→move: the grant funds the second move, never retroactively regroups before the first', () => {
    const store = boot()
    // The first move legally spends one base MP. Vanish then raises the live pool from 2 to 3 before the NEXT move.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: cell(6, 5), mp_left: 2 } }, 2_000)
    store
      .getState()
      .input({ type: 'predicted', actions: [vanish_cast(cell(6, 5)), granted_mp(1)], basis_version: 7 }, 2_100)
    expect(project.draft_cast_first(store.getState().log)).toBe(false)
    // The presented pool is the exact ordered state: 2 left after move1 + 1 grant before move2.
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(3)
    const ordered = bfsReachable(cell(6, 5), 3, wash_blocked(store)).length
    const regrouped = bfsReachable(cell(6, 5), 2, wash_blocked(store)).length
    expect(ordered).not.toBe(regrouped)
    expect(wash_reach(store)).toBe(ordered)
  })
})
