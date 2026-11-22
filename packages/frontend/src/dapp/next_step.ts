// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the page proposes: derived from the state, the pushed account and the catalogue, never stored.
// A proposal fills nothing by itself and sends nothing: the player picks, then starts.
import type { CharacterRow } from '@aresrpg/protocol'
import { raid_keys } from '@aresrpg/protocol/strategies'

import { content_catalog } from '../content/catalog.ts'

import { account_bag, strongest_first, type DappAccount } from './account.ts'
import { bot_ready, free_heroes, idle_heroes, raid_seats, type DappState } from './state.ts'
import { raid_able, RAID_TEAM, type StartSpec } from './strategies.ts'

/**
 * Usable keys by dungeon, across the kiosks the heroes hold: a key follows the heroes of its own kiosk
 * only. Empty until the bag is fully read.
 */
export const dungeon_keys = (account: DappAccount): Readonly<Record<string, number>> => {
  const bag = account_bag(account)
  const kiosks = [...new Set(account.characters.map(({ kiosk }) => kiosk))]
  const units = (key: string) =>
    kiosks.flatMap((kiosk) => raid_keys(bag!, key, kiosk)).reduce((total, { amount }) => total + amount, 0)
  return bag ? Object.fromEntries(content_catalog.dungeons.map(({ dungeon, key }) => [dungeon, units(key)])) : {}
}

/** Usable keys of every dungeon, in all; null until the bag is fully read. */
export const keys_held = (account: DappAccount): number | null =>
  account_bag(account) ? Object.values(dungeon_keys(account)).reduce((total, keys) => total + keys, 0) : null
/** The dungeon the Raid tab shows: the player's choice, else the first whose key is held, else the first. */
export const proposed_dungeon = (state: DappState, account: DappAccount): string | null => {
  const chosen = content_catalog.dungeon(state.raid.dungeon ?? '')
  const keys = dungeon_keys(account)
  const keyed = content_catalog.dungeons.find(({ dungeon }) => (keys[dungeon] ?? 0) > 0)
  return (chosen ?? keyed ?? content_catalog.dungeons[0])?.dungeon ?? null
}
/** The strongest free heroes that could enter a dungeon now, a full fight side at most. */
export const proposed_team = (state: DappState, account: DappAccount, dungeon: string): readonly CharacterRow[] =>
  raid_able(dungeon, strongest_first(free_heroes(state, account)), account_bag(account)).slice(0, RAID_TEAM)
/** What the Raid tab would start with the player's choices as they stand; null when no dungeon exists. */
export const raid_spec = (state: DappState, account: DappAccount): StartSpec | null => {
  const dungeon = proposed_dungeon(state, account)
  const { runs, fee_cap_mist } = state.raid
  const hero_ids = raid_seats(state, account).map(({ id }) => id)
  return dungeon ? { activity: 'raid', hero_ids, dungeon, runs, fee_cap_mist } : null
}

/** The one thing Home suggests next, most pressing first. */
export type NextStep = Readonly<
  /** A hero stopped because the bot cannot pay network fees. */
  | { kind: 'funds' }
  /** A key of this dungeon is held and a free hero can enter it. */
  | { kind: 'raid'; dungeon: string; keys: number }
  | { kind: 'quest'; hero_id: string }
  /** Every hero is out. */
  | { kind: 'out' }
>
const out_of_funds = ({ positions }: DappState): boolean =>
  positions.some(({ finished_ms, notice }) => finished_ms === null && notice === 'funding')
const open_raid = (state: DappState, account: DappAccount): NextStep | null => {
  const raid = content_catalog.dungeons.find(({ dungeon }) => proposed_team(state, account, dungeon).length > 0)
  return raid ? { kind: 'raid', dungeon: raid.dungeon, keys: dungeon_keys(account)[raid.dungeon] ?? 0 } : null
}
/** Null until the bot answered and the account holds a hero: an empty account shows its first steps instead. */
export const next_step = (state: DappState, account: DappAccount): NextStep | null => {
  if (!bot_ready(state) || !account.characters.length) return null
  if (out_of_funds(state)) return { kind: 'funds' }
  const [free] = idle_heroes(state, account)
  return open_raid(state, account) ?? (free ? { kind: 'quest', hero_id: free.id } : { kind: 'out' })
}
