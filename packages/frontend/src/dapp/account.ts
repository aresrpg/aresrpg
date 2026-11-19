// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { hydrate_fight_checkpoint, seated_player_health } from '@aresrpg/fight'
import type { CharacterRow, FightStateRow, ItemRow } from '@aresrpg/protocol'
import { character_max_hp, projected_hp } from '@aresrpg/protocol/character-stats'
import type { RaidBag } from '@aresrpg/protocol/strategies'

import type { AgentInventoryView } from '../agents/inventory_state.ts'
import { catalog_spell_sources } from '../content/fight_sources.ts'

/**
 * The hosted bot's own account, as the game server pushes it to its owner: heroes, bag, listings,
 * trades and balance. It is the session's read-only account fold; the dapp keeps no copy of it.
 */
export type DappAccount = AgentInventoryView

/** Units held by item type, summed across stack fragments. */
export const held_items = (rows: readonly ItemRow[]): Readonly<Record<string, number>> =>
  rows.reduce<Record<string, number>>(
    (totals, row) => ({ ...totals, [row.item_type]: (totals[row.item_type] ?? 0) + row.amount }),
    {}
  )

/** The bag with what locks its items, for the shared raid-key rule. Null until all of it is read. */
export const account_bag = ({ phase, inventory, catalogue, trades }: DappAccount): RaidBag | null =>
  phase === 'ready' ? { items: inventory, listings: catalogue.own_listings, trades } : null

export const hero_experience = ({ experience }: Readonly<Pick<CharacterRow, 'experience'>>): bigint =>
  BigInt(experience)
export const job_experience = ({ jobs }: Readonly<Pick<CharacterRow, 'jobs'>>): bigint =>
  Object.values(jobs).reduce((total, xp) => total + BigInt(xp), 0n)

/** Strongest first: by level, then experience, then id, so equal heroes always rank the same way. */
export const strongest_first = (heroes: readonly CharacterRow[]): readonly CharacterRow[] =>
  heroes.toSorted((left, right) => {
    const [ours, theirs] = [hero_experience(left), hero_experience(right)]
    return right.level - left.level || Number(theirs > ours) - Number(theirs < ours) || left.id.localeCompare(right.id)
  })

/** The other heroes of this wallet seated in the same fight. */
export const fight_mates = (heroes: readonly CharacterRow[], hero_id: string): readonly CharacterRow[] => {
  const fight_id = heroes.find(({ id }) => id === hero_id)?.active_fight?.id
  return fight_id ? heroes.filter((hero) => hero.active_fight?.id === fight_id && hero.id !== hero_id) : []
}

/** A pushed fight row is read through the fight package's own normalization; no fight is built for it. */
const seated_health = (hero: Readonly<CharacterRow>, row: Readonly<FightStateRow>, owner: string) => {
  const state = { contract: row.contract, sources: { players: row.players, spells: catalog_spell_sources() } }
  const checkpoint = hydrate_fight_checkpoint(state)
  const health = seated_player_health(checkpoint, { character: hero.id, owner, seat: hero.active_fight!.seat })
  return health && { current: Number(health.current), maximum: Number(health.maximum) }
}

/**
 * A hero's health: in a fight it is its fighter's, from the pushed fight state; standing in its kiosk
 * it is the chain's own regeneration rule. Unknown until the fight state or the owner is known.
 */
export const hero_health = (
  hero: Readonly<CharacterRow>,
  { fights }: Readonly<Pick<DappAccount, 'fights'>>,
  owner: string | null,
  now: number
): Readonly<{ current: number; maximum: number }> | null => {
  if (hero.active_fight) {
    const row = fights[hero.active_fight.id]
    return row && owner ? seated_health(hero, row, owner) : null
  }
  return hero.custody === 'kiosk' ? { current: projected_hp(hero, now), maximum: character_max_hp(hero) } : null
}
