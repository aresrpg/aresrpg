// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import * as SE from '@aresrpg/sim/spell_effect'
import { roll_in_range, slot_damage_roll, turn_seed } from '@aresrpg/sim/turn_seed'

import {
  create_sim_chain,
  derive_board,
  arena_from_board,
  run_ai_turn,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'

const entity = (id, cell, is_player) => ({
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
  template_id: is_player ? 'senshi' : '0xmob',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const VENOM = [
  {
    id: 'venom',
    levels: [
      {
        ap_cost: 2,
        range_min: 0,
        range_max: 6,
        modifiable_range: false,
        line_launch: false,
        line_of_sight: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown_turns: 0,
        crit_rate: 0,
        effects: [
          {
            kind: SE.K_APPLY_DOT,
            element: 0,
            value: 10,
            value_max: 40,
            target_filter: SE.TF_ONLY_CASTER,
            turns: 6,
            chance: 100,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]

const health_of = (chain, id) =>
  [...chain.sim_state.team0, ...chain.sim_state.team1].find((entity) => entity.id === id)?.health

describe('create_sim_chain turn clock', () => {
  test('the local authority supplies and snapshots an entropy-bearing turn_context', () => {
    const seed = 0x1306
    const { board } = derive_board(seed)
    const arena = arena_from_board(board)
    const chain = create_sim_chain({
      seed,
      fight_id: 'sim:turn-context',
      team0: [entity('p0', arena.spawns_a[0], true)],
      team1: [entity('m0', arena.spawns_b[0], false)],
    })
    const clock = chain.ctx.turn_context
    const snapshot = snapshot_from_sim(chain)

    expect(clock).toMatchObject({ spawn_id: seed, turn_ordinal: 1, seat: 0, slot: 0 })
    expect(clock.turn_entropy).toBeNumber()
    expect(snapshot.turn_entropy).toBe(clock.turn_entropy)
    expect(snapshot.turn_ordinal).toBe(clock.turn_ordinal)

    const advanced = submit_commands(chain, [{ type: 'end_turn', entity_id: 'p0' }])
    const mob_opened = advanced.receipt.events.find((event) => event.type.endsWith('::TurnStarted')).parsedJson
    expect(mob_opened.turn_ordinal).toBe(String(clock.turn_ordinal))

    const landed = run_ai_turn(advanced.chain, 'm0')
    const player_opened = landed.receipt.events.find((event) => event.type.endsWith('::TurnStarted')).parsedJson
    expect(landed.chain.ctx.turn_context.turn_ordinal).toBeGreaterThan(clock.turn_ordinal)
    expect(player_opened.turn_entropy).toBe(String(landed.chain.ctx.turn_context.turn_entropy))
    expect(player_opened.turn_ordinal).toBe(String(landed.chain.ctx.turn_context.turn_ordinal))
  })

  test('multi-tick DoT parity uses each incoming player turn ordinal', () => {
    const seed = 0x1306
    const { board } = derive_board(seed)
    const arena = arena_from_board(board)
    const player = {
      ...entity('p0', arena.spawns_a[0], true),
      health: 200,
      health_max: 200,
      spell_levels: { venom: 1 },
    }
    let chain = create_sim_chain({
      seed,
      fight_id: 'sim:dot-incoming-turn-clock',
      team0: [player],
      team1: [entity('m0', arena.spawns_b[0], false)],
      templates_raw: VENOM,
    })

    ;({ chain } = submit_commands(chain, [{ type: 'cast', entity_id: 'p0', spell_id: 'venom', target: player.cell }]))

    const actual = []
    const expected = []
    const ordinals = []
    for (let tick = 0; tick < 3; tick++) {
      ;({ chain } = submit_commands(chain, [{ type: 'end_turn', entity_id: 'p0' }]))
      const before = health_of(chain, 'p0')
      ;({ chain } = submit_commands(chain, [{ type: 'end_turn', entity_id: 'm0' }]))
      const incoming = chain.ctx.turn_context
      ordinals.push(incoming.turn_ordinal)
      actual.push(before - health_of(chain, 'p0'))
      expected.push(roll_in_range(10, 40, slot_damage_roll(turn_seed(incoming), 0)))
    }

    // `turn_seed(incoming)` is the JS twin of Move's `fight::turn_seed(fight, fid)`, and slot 0 is the first
    // row in this glyph-free tick batch. Each bite must therefore price off the turn that just STARTED.
    expect(ordinals).toEqual([2, 3, 4])
    expect(actual).toEqual(expected)
  })
})
