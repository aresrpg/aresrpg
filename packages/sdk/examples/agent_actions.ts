// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integration examples, not an autonomous spender. The caller owns authorization, fresh state,
// durable transaction storage, budgets, and its chosen chain/indexed read lifecycle.

import { create_fight, type FightCommand, type HydratedFightCheckpoint } from '../../fight/src/index.ts'
import type { FightTurnAction } from '../src/fight.ts'
export { create_agent_actions } from '../src/agent_actions.ts'

const simulator_action = (fighter: bigint, action: FightTurnAction): FightCommand => {
  switch (action.type) {
    case 'move':
      return { type: 'move_to', fighter, path: action.path }
    case 'cast':
      return { type: 'cast_spell', fighter: action.fighter_idx, spell: action.spell, target_cell: action.target_cell }
    case 'strike':
      return { type: 'weapon_strike', fighter: action.fighter_idx, target_cell: action.target_cell }
  }
}

/** Preview current-turn actions only. No fake future seed, boundary commit, or wallet access. */
export const preview_turn = (checkpoint: Readonly<HydratedFightCheckpoint>, actions: readonly FightTurnAction[]) => {
  const runtime = create_fight({ state: structuredClone(checkpoint), mode: 'remote' })
  const fighter = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
  if (fighter === undefined || checkpoint.contract.ended) throw new Error('A live active turn is required')
  for (const action of actions) {
    if (action.type !== 'move' && action.fighter_idx !== fighter) throw new Error('Action belongs to another seat')
    const result = runtime.apply(simulator_action(fighter, action))
    if (result.error) throw new Error(`Illegal draft: ${result.error.code}`)
    if (runtime.awaiting_witness()) throw new Error('Draft needs a certified seed witness')
  }
  return runtime.state()
}
