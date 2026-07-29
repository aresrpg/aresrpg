// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1387) — a simulator fight must admit the same kind-2 weapon strike the production fight does.
//
// PARITY FIXTURE: packages/fight/test/weapon_lines_preview.test.js. This test uses that fixture's exact
// authored rows (fire 10..20, water 5..9), seed, zero-stat attacker and 60% fire-resistant target. At the
// simulator's first player slot the shared turn clock rolls 12 fire + 6 water; resistance resolves those as
// 4 + 6 = 10. The fixture proves those are the chain twin's numbers; this test proves the committed simulator
// fight reaches them through the shared weapon derivation instead of refusing kind 2 at the shim.

import { describe, expect, test } from 'bun:test'

import { encode } from '../src/los.js'
import { arena_from_board, create_sim_chain, derive_board, submit_staged } from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:1387:weapon'
const CASTER_ID = 'seat_a'
const TARGET_ID = 'mob_0'
const TARGET_HP = 400

const ZERO_STATS = {
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  raw_damage: 0,
  critical_hit: 0,
  range: 0,
  fire_resistance: 0,
  water_resistance: 0,
  earth_resistance: 0,
  air_resistance: 0,
}

const entity = (id, cell, is_player, stats = ZERO_STATS) => ({
  id,
  name: id,
  cell,
  health: TARGET_HP,
  health_max: TARGET_HP,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 20,
  stats,
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const authored_weapon = {
  element: 2,
  damage: 7,
  damage_max: 7,
  crit_damage: 11,
  crit_damage_max: 11,
  crit_rate: 0,
  ap_cost: 3,
  reach: 1,
  lines: [
    { element: 0, damage: 10, damage_max: 20, crit_damage: 15, crit_damage_max: 30 },
    { element: 1, damage: 5, damage_max: 9, crit_damage: 7, crit_damage_max: 13 },
  ],
}

const boot = () => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [{ ...entity(CASTER_ID, arena.spawns_a[0], true), weapon: authored_weapon }],
    team1: [
      entity(TARGET_ID, arena.spawns_a[1], false, {
        ...ZERO_STATS,
        fire_resistance: 60,
      }),
    ],
    templates_raw: [],
  })
}

describe('#1387 — a simulator fight resolves an authored weapon swing', () => {
  test('kind 2 lands the parity fixture’s per-element slot-0 damage', () => {
    const chain = boot()
    const target = chain.sim_state.team1[0]
    const result = submit_staged(
      chain,
      [{ kind: 2, target: encode(target.cell.x, target.cell.y), spell_key: 'weapon' }],
      CASTER_ID,
      { now_ms: 0 }
    )
    const hits = result.receipt.events.filter(
      (event) => event.type.endsWith('::Hit') && event.parsedJson.victim_is_mob === true
    )

    expect(hits.map((event) => Number(event.parsedJson.amount))).toEqual([4, 6])
    expect(result.chain.sim_state.team1[0].health).toBe(TARGET_HP - 10)
    expect(result.chain.sim_state.team0[0].ap).toBe(3)
  })
})
