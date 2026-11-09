// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integration examples, not an autonomous spender. The caller owns authorization, fresh state,
// durable transaction storage, budgets, and its chosen chain/indexed read lifecycle.

import type { TradeRow } from '@aresrpg/protocol'

import { read_personal_kiosks } from './kiosk_discovery.ts'
import type { Sdk } from './client.ts'
import { character_actions } from './character_actions.ts'
import { character_create, type CharacterCreateInput } from './character.ts'
import { dungeon_actions } from './dungeon.ts'
import { fight_actions } from './fight.ts'
import { create_personal_kiosk_runner } from './kiosk_runner.ts'
import { marketplace_actions } from './marketplace.ts'
import { mastery_actions } from './mastery.ts'
import { party_actions } from './party.ts'
import { trade_actions } from './trade.ts'

/** Use an SDK constructed for this same signing address. Every method below can spend gas. */
export const create_agent_actions = (sdk: Sdk, address: string) => {
  const kiosk_cap = async (kiosk_id?: string) => {
    const caps = await read_personal_kiosks(sdk, address)
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
