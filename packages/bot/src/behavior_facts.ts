// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { job_level_from_xp } from '@aresrpg/immutable'

import type { BehaviorCondition, BehaviorFact } from './behavior_script.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { market_price_condition } from './market_prices.ts'
import { world_available } from './behavior_world.ts'
import { profession_inventory } from './actor_inventory.ts'

const fact_value = (fact: BehaviorFact, context: GameplayContext): string | number | boolean | null => {
  const character = context.snapshot.characters.find(({ id }) => id === fact.character_id)
  if (!character) return null
  const readers: Record<BehaviorFact['type'], () => string | number | boolean | null> = {
    level: () => character.level,
    job_level: () => job_level_from_xp(Number(character.jobs[fact.key!] ?? '0')),
    custody: () => character.custody ?? null,
    ambush: () => Boolean(character.ambush),
    fight: () => Boolean(character.active_fight),
    quantity: () =>
      profession_inventory(context.snapshot.inventory, character.kiosk)
        .filter(({ item_type }) => item_type === fact.key)
        .reduce((total, item) => total + item.amount, 0),
  }
  return readers[fact.type]()
}
const special_condition = (
  condition: Exclude<BehaviorCondition, import('./behavior_script.ts').StateCondition>,
  context: GameplayContext
) => {
  if (condition.type === 'market_price') return market_price_condition(condition, context)
  const value = world_available(condition.fact, context)
  if (value === null) return null
  return condition.op === 'eq' ? value === condition.value : value !== condition.value
}
export const behavior_condition = (condition: BehaviorCondition, context: GameplayContext): boolean | null => {
  if ('type' in condition) return special_condition(condition, context)
  let value: ReturnType<typeof fact_value>
  try {
    value = fact_value(condition.fact, context)
  } catch (error) {
    if (error instanceof Error && error.message === 'inventory_unavailable') return null
    throw error
  }
  if (value === null) return null
  const comparisons: Record<BehaviorCondition['op'], () => boolean> = {
    eq: () => value === condition.value,
    ne: () => value !== condition.value,
    lt: () => value! < condition.value,
    lte: () => value! <= condition.value,
    gt: () => value! > condition.value,
    gte: () => value! >= condition.value,
  }
  return comparisons[condition.op]()
}
