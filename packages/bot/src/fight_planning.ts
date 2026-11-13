// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  CONTRACT_CONSTANTS,
  create_fight,
  project_board_cells,
  spell_level_of,
  spell_target_cells,
  weapon_target_cells,
  type FightEvent,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'

import {
  fight_turn_inputs,
  gameplay_observed_ms,
  owned_fight,
  parse_fight_turn,
  type GameplayContext,
} from './gameplay.ts'

const active_turn = ({ contract }: HydratedFightCheckpoint, seat: bigint) =>
  contract.round > 0n &&
  !contract.ended &&
  contract.queue[Number(contract.turn_ptr)] === seat &&
  !contract.fighters[Number(seat)]!.dead

/** Disposable current-turn analysis. Never commits, ends a turn, or supplies future entropy.
 * This fails if an illegal prefix is silently dropped and its remainder reported as a legal plan. */
export const fight_planning = (context: GameplayContext, input: unknown) => {
  const payload = parse_fight_turn(input)
  const observed_ms = gameplay_observed_ms(context)
  const { checkpoint, seat } = owned_fight(payload, context)
  if (!active_turn(checkpoint, seat)) throw new Error('not_active_turn')
  if (observed_ms < checkpoint.contract.turn_started_ms) throw new Error('needs_resync')
  const runtime = create_fight({ state: checkpoint, mode: 'remote' })
  const events: FightEvent[] = []
  let error: Readonly<{ action_index: number; code: string; detail: unknown }> | null = null
  for (const [action_index, action] of fight_turn_inputs(payload).entries()) {
    const result = runtime.apply({ ...action, observed_ms })
    if (result.error) {
      error = { action_index, ...result.error }
      break
    }
    events.push(...result.events)
  }
  const state = runtime.state()
  const can_continue = !error && active_turn(state, seat)
  return {
    prediction: true,
    checkpoint_id: payload.checkpoint_id,
    limits:
      'Current observed PvE turn only; seed and authored sources are those of the fight twin. No future turns, transaction preflight or confirmed execution. Events and fighters describe only the successful prefix; an error invalidates the proposed plan. Reobserve before submitting.',
    error,
    events,
    fighters: state.contract.fighters,
    grid: {
      width: CONTRACT_CONSTANTS.grid_w,
      height: CONTRACT_CONSTANTS.grid_h,
      cell_encoding: 'y * width + x',
      cells: project_board_cells(state.contract.board),
    },
    next_casts: can_continue
      ? Object.keys(state.sources.spells).flatMap((spell) =>
          spell_level_of(state, seat, spell)
            ? [{ spell, target_cells: spell_target_cells(state, seat, spell).targetable }]
            : []
        )
      : [],
    next_strike_cells: can_continue ? weapon_target_cells(state, seat).targetable : [],
  }
}
