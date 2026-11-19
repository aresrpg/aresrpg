// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ItemRow, ListingRow, TradeRow } from '@aresrpg/protocol'

import { initial_agent_inventory } from '../../src/agents/inventory_state.ts'
import type { DappAccount } from '../../src/dapp/account.ts'
import { parse_observation, type DappObservation } from '../../src/dapp/observation.ts'

/** Object IDs follow the bot's identifier rule (0x + 64 hex); other heroes derive their own. */
export const HERO = `0x${'1'.repeat(64)}`
export const hero_id = (digit: string) => `0x${digit.repeat(64)}`
/** A deterministic hero row of the bot account; not a captured payload, only the fields the dapp reads. */
export const character_fixture = (overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id: HERO,
  name: 'Mira',
  classe: 'yogan',
  sex: 'male',
  level: 3,
  experience: '120',
  color_1: 1,
  color_2: 2,
  color_3: 3,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: { miner: '40' },
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50_512,
  z: 50_000,
  kiosk: '0xkiosk',
  equipment: [],
  custody: 'kiosk',
  ...overrides,
})

/** What the bot alone answers: its runs and its direct command. */
export const raw_observation = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  ready: true,
  status: 'ready',
  decision_revision: 3,
  observation_revision: 10,
  event_fence: 1,
  sampled_at: 0,
  state: 'idle',
  runs: [],
  ...overrides,
})
/** One row of the bot's `runs`: the hosted behaviour tree of one hero, and the entry it was bound from. */
export const run_fixture = (character_id = HERO, status = 'active', issue?: string, strategy?: string) => ({
  id: `run-${character_id.slice(-1)}`,
  character_id,
  status,
  issue,
  strategy,
})

export const observation_fixture = (overrides: Readonly<Record<string, unknown>> = {}): DappObservation =>
  parse_observation(raw_observation(overrides))!

/**
 * The bot account as the game socket folds it for its owner: fully read, one hero, an empty bag.
 * Rows are the loose test rows of this file; only the fields the dapp reads are present.
 */
export const account_fixture = (
  overrides: Readonly<{
    characters?: readonly CharacterRow[]
    items?: readonly object[]
    listings?: readonly object[]
    trades?: readonly object[]
    balance_mist?: bigint | null
    phase?: DappAccount['phase']
  }> = {}
): DappAccount => {
  const empty = initial_agent_inventory()
  return {
    ...empty,
    phase: overrides.phase ?? 'ready',
    characters: overrides.characters ?? [character_fixture()],
    inventory: (overrides.items ?? []) as readonly ItemRow[],
    catalogue: { ...empty.catalogue, own_listings: (overrides.listings ?? []) as ListingRow[] },
    trades: (overrides.trades ?? []) as readonly TradeRow[],
    sui_balance_mist: overrides.balance_mist === undefined ? 2_000_000_000n : overrides.balance_mist,
  }
}

export const item_fixture = (item_type: string, amount: number, id = `${item_type}-1`) => ({
  id,
  version: '1',
  name: item_type,
  item_type,
  category: 'resource',
  level: 1,
  amount,
  kiosk: '0xkiosk',
})
/** One public offer as the game socket lists it. */
export const listing_fixture = (
  item_type: string,
  price_mist: string,
  overrides: Readonly<Record<string, unknown>> = {}
) => ({
  kind: 'item',
  id: `0x${'7'.repeat(64)}`,
  version: '5',
  name: item_type,
  item_type,
  category: 'key',
  level: 1,
  amount: 1,
  price_mist,
  kiosk: `0x${'8'.repeat(64)}`,
  seller: `0x${'9'.repeat(64)}`,
  at_ms: 1,
  ...overrides,
})
