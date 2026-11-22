// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CONTRACT_CONSTANTS, seated_player_health } from '@aresrpg/fight'
import { stat_names } from '@aresrpg/immutable'
import { character_max_hp, projected_hp, item_stat_offset } from '@aresrpg/protocol/character-stats'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { gameplay_observed_ms, gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { hydrate_gameplay_fight } from './gameplay.ts'

const fight_health = (character: CharacterRow, context: GameplayContext, chain_ms: number) => {
  const active = character.active_fight!
  const row = context.snapshot.fights[active.id]
  if (!row || character.custody !== 'fight') return null
  const health = seated_player_health(hydrate_gameplay_fight(row), {
    character: character.id,
    owner: context.address,
    seat: active.seat,
  })
  if (!health) return null
  return {
    current: Number(health.current),
    maximum: Number(health.maximum),
    source: 'fight' as const,
    chain_ms,
    regen_ms_per_hp: null,
  }
}
const persistent_health_known = (character: CharacterRow, chain_ms: number) => {
  if (character.hp === undefined && character.hp_ms === undefined) return true // Uninitialized HP is full in Move.
  return [
    /^\d+$/.test(character.hp ?? ''),
    Number.isSafeInteger(Number(character.hp)),
    Number.isSafeInteger(character.hp_ms),
    Number(character.hp_ms) >= 0,
    Number(character.hp_ms) <= chain_ms,
  ].every(Boolean)
}
export const character_health = (character: CharacterRow, context: GameplayContext) => {
  if (!gameplay_observation_ready(context)) return null
  const chain_ms = Number(gameplay_observed_ms(context))
  if (character.active_fight) return fight_health(character, context, chain_ms)
  if (character.custody !== 'kiosk' || !persistent_health_known(character, chain_ms)) return null
  return {
    current: projected_hp(character, chain_ms),
    maximum: character_max_hp(character),
    source: 'lazy_regeneration' as const,
    chain_ms,
    regen_ms_per_hp: Number(CONTRACT_CONSTANTS.regen_ms_per_hp),
  }
}
export const item_bonuses = (item: Pick<ItemRow, 'category' | 'stats' | 'pet_power'>) =>
  item.stats ? Object.fromEntries(stat_names.map((stat) => [stat, item_stat_offset(item, stat)])) : null

export const observed_balance = (context: GameplayContext) => {
  const { balance } = context
  if (!gameplay_observation_ready(context)) return null
  if (!balance || balance.address !== context.address || !/^\d+$/.test(balance.balance_mist)) return null
  if (!(balance.sampled_at <= context.now && context.now < balance.expires_at)) return null
  return { ...balance, unit: 'MIST' as const, mist_per_sui: '1000000000', clock: 'monotonic_ms' as const }
}
export const character_observability = (context: GameplayContext) => ({
  health: Object.fromEntries(
    context.snapshot.characters.map((character) => [character.id, character_health(character, context)])
  ),
  equipment_bonuses: Object.fromEntries(
    context.snapshot.characters.map((character) => [
      character.id,
      Object.fromEntries(character.equipment.map((item) => [item.id, item_bonuses(item)])),
    ])
  ),
  balance: observed_balance(context),
})
