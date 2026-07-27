// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A contested AP/MP removal has ONE wire fact: Drain{removed, requested}. The chain emits it even when
// removed=0; the simulator must do the same so the receipt presenter can speak a full or partial dodge.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import {
  arena_from_board,
  commands_from_staged,
  create_sim_chain,
  derive_board,
  submit_commands,
} from '../src/sim_chain.js'

const level = (effect) => ({
  ap_cost: 0,
  range_min: 0,
  range_max: 99,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn: 1,
  casts_per_target: 1,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: [{ chance: 100, ...effect }],
  crit_effects: [],
})

const fighter = (id, cell, is_player, stats, deck) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
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
  spell_levels: Object.fromEntries(deck.map((spell_id) => [spell_id, 1])),
  ap_reserve: 0,
})

const contested_drain = ({ seed, requested, caster_wisdom, target_dodge }) => {
  const spell_id = `drain_${requested}`
  const { board } = derive_board(seed)
  const arena = arena_from_board(board)
  const player_cell = arena.spawns_a[0]
  const mob_cell = arena.spawns_b[0]
  const template = {
    id: spell_id,
    levels: [
      level({
        kind: SE.K_REMOVE_POINTS,
        stat: SE.POINT_AP,
        value: requested,
        flags: SE.FLAG_DODGE,
        target_filter: SE.TF_NOT_TEAM,
      }),
    ],
  }
  const chain = create_sim_chain({
    seed,
    fight_id: `dodge:${seed}`,
    group_template: '0xgroup',
    templates_raw: [template],
    team0: [fighter('p0', player_cell, true, { wisdom: caster_wisdom }, [spell_id])],
    team1: [fighter('mob_0', mob_cell, false, { ap_dodge: target_dodge }, [])],
  })
  const out = submit_commands(
    chain,
    commands_from_staged(
      [{ kind: 1, target: encode(mob_cell.x, mob_cell.y), spell_template_id: spell_id }],
      'p0',
    ),
  )
  return out.receipt.events.filter((event) => event.type.endsWith('::Drain'))
}

describe('sim chain · contested drain rows match the chain twin', () => {
  test('full dodge still emits Drain{removed:0, requested:2} — Move floor parity vector', () => {
    const rows = contested_drain({
      seed: 0,
      requested: 2,
      caster_wisdom: 0,
      target_dodge: 100,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].parsedJson).toMatchObject({
      target_is_mob: true,
      target_idx: '0',
      point_kind: 0,
      removed: '0',
      requested: '2',
    })
  })

  test('partial dodge carries the exact removed/requested pair — Move deterministic parity vector', () => {
    const rows = contested_drain({
      seed: 424242,
      requested: 3,
      caster_wisdom: 200,
      target_dodge: 1,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].parsedJson).toMatchObject({
      target_is_mob: true,
      target_idx: '0',
      point_kind: 0,
      removed: '1',
      requested: '3',
    })
  })
})
