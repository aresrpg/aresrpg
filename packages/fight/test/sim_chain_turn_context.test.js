// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

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
})
