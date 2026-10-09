// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integration examples, not an autonomous spender. The caller owns authorization, fresh state,
// durable transaction storage, budgets, and the authenticated websocket lifecycle.

import type { TradeRow } from '@aresrpg/protocol'

import { create_fight, type FightCommand, type HydratedFightCheckpoint } from '../../fight/src/index.ts'
import type { Sdk } from '../src/client.ts'
import { character_actions } from '../src/character_actions.ts'
import { character_create, type CharacterCreateInput } from '../src/character.ts'
import { dungeon_actions } from '../src/dungeon.ts'
import { fight_actions, type FightTurnAction } from '../src/fight.ts'
import { create_personal_kiosk_runner } from '../src/kiosk_runner.ts'
import { marketplace_actions } from '../src/marketplace.ts'
import { mastery_actions } from '../src/mastery.ts'
import { party_actions } from '../src/party.ts'
import { trade_actions } from '../src/trade.ts'

/** Use an SDK constructed for this same signing address. Every method below can spend gas. */
export const create_agent_actions = (sdk: Sdk, address: string) => {
  const kiosk_cap = async (kiosk_id?: string) => {
    const { kioskOwnerCaps: caps } = await sdk.get_owned_kiosks(address)
    return caps.find((cap) => cap.isPersonal && (!kiosk_id || cap.kioskId === kiosk_id)) ?? null
  }
  const create_in_kiosk = create_personal_kiosk_runner(kiosk_cap)
  return {
    create_character: (input: CharacterCreateInput, first_world: string) =>
      create_in_kiosk(async (cap) => {
        const result = await character_create(sdk, { ...input, kiosk_cap: cap }, first_world)
        return { value: result, kiosk_cap: result.kiosk_cap }
      }),
    character: character_actions(sdk, { kiosk_cap }),
    fight: fight_actions(sdk, { kiosk_cap }),
    dungeon: dungeon_actions(sdk, { kiosk_cap }),
    marketplace: marketplace_actions(sdk, { kiosk_cap, address }),
    mastery: mastery_actions(sdk, { kiosk_cap, address }),
    party: party_actions(sdk, { kiosk_cap }),
    trade: (trade: TradeRow) => trade_actions(sdk, { trade, address, kiosk_cap }),
  }
}

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
