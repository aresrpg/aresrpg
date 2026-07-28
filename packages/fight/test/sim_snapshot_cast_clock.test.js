// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1456 — the simulator snapshot is the object read behind every preview. Its committed-action count must
// come from the same event history as the sim's action clock, or the next card reuses an already-spent crit slot.

import { describe, expect, test } from 'bun:test'
import { K_DAMAGE, TF_NOT_TEAM } from '@aresrpg/sim/spell_effect'
import { slot_crit_roll, turn_seed } from '@aresrpg/sim/turn_seed'

import { board_state_from_fight } from '../src/board_state.js'
import { crit_clock_of } from '../src/predict_cast.js'
import {
  arena_from_board,
  create_sim_chain,
  derive_board,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'

import { fighter, level } from './sim_chain_corpus.js'

const SEED = 0x1456ca57
const FIGHT_ID = 'sim:1456:cast-clock'
const SPELL_ID = 'double_cast'
const SPELL = {
  id: SPELL_ID,
  levels: [
    level([{ kind: K_DAMAGE, element: 0, value: 1, target_filter: TF_NOT_TEAM }], {
      ap_cost: 0,
      range_max: 99,
    }),
  ],
}

const build = () => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [
      fighter('caster', arena.spawns_a[0], true, {
        health: 100,
        ap: 8,
        mp: 3,
        deck: [SPELL_ID],
      }),
    ],
    team1: [
      fighter('target', arena.spawns_b[0], false, {
        health: 100,
        ap: 0,
        mp: 0,
        deck: [],
      }),
    ],
    templates_raw: [SPELL],
  })
}

const snapshot_clock = (chain) => {
  const snapshot = snapshot_from_sim(chain)
  const fight = board_state_from_fight({ fight: snapshot, version: chain.version })
  return {
    snapshot,
    clock: crit_clock_of({ fight, seat_row: fight.escrow[0] }),
  }
}

describe('snapshot_from_sim — committed action clock (#1456)', () => {
  test('two committed casts advance the snapshot count and the second cast preview', () => {
    const opened = build()
    const target = opened.sim_state.team1[0].cell
    const command = { type: 'cast', entity_id: 'caster', spell_id: SPELL_ID, target }
    const before_first = snapshot_clock(opened)
    const after_first = submit_commands(opened, [command]).chain
    const before_second = snapshot_clock(after_first)
    const after_second = submit_commands(after_first, [command]).chain
    const committed = snapshot_clock(after_second)

    expect(committed.snapshot.participants[0].casts_this_turn).toBe(2)
    expect(before_second.clock.slot).toBe(before_first.clock.slot + 1)
    expect(slot_crit_roll(turn_seed(before_second.clock), before_second.clock.slot)).not.toBe(
      slot_crit_roll(turn_seed(before_first.clock), before_first.clock.slot)
    )
  })
})
