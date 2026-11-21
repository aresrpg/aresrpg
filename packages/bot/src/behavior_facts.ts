// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { job_level_from_xp } from '@aresrpg/immutable'

import type { BehaviorCondition, BehaviorFact, BehaviorRun, StateCondition, TallyCondition } from './behavior_script.ts'
import { run_tally } from './behavior_tally.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { market_price_condition } from './market_prices.ts'
import { world_available } from './behavior_world.ts'
import { character_health, observed_balance } from './character_observability.ts'
import { profession_inventory } from './actor_inventory.ts'

const fact_value = (fact: BehaviorFact, context: GameplayContext): string | number | boolean | null => {
  const character = context.snapshot.characters.find(({ id }) => id === fact.character_id)
  if (!character) return null
  const readers: Record<BehaviorFact['type'], () => string | number | boolean | null> = {
    level: () => character.level,
    hp: () => character_health(character, context)?.current ?? null,
    max_hp: () => character_health(character, context)?.maximum ?? null,
    hp_percent: () => {
      const health = character_health(character, context)
      return health ? Math.floor((health.current * 100) / health.maximum) : null
    },
    job_level: () => job_level_from_xp(Number(character.jobs[fact.key!] ?? '0')),
    custody: () => character.custody ?? null,
    ambush: () => Boolean(character.ambush),
    fight: () => Boolean(character.active_fight),
    dungeon_run: () => Boolean(character.dungeon_run),
    quantity: () =>
      profession_inventory(context.snapshot.inventory, character.kiosk)
        .filter(({ item_type }) => item_type === fact.key)
        .reduce((total, item) => total + item.amount, 0),
  }
  return readers[fact.type]()
}
const compare = (op: StateCondition['op'], value: bigint, threshold: bigint): boolean =>
  ({
    eq: value === threshold,
    ne: value !== threshold,
    lt: value < threshold,
    lte: value <= threshold,
    gt: value > threshold,
    gte: value >= threshold,
  })[op]
/** A run's own tally is always known: it never waits for an observation. */
const tally_condition = (condition: TallyCondition, run: Pick<BehaviorRun, 'tally'>): boolean => {
  const { fees_mist, dungeon_runs } = run_tally(run)
  const value = condition.type === 'fees_spent' ? BigInt(fees_mist) : BigInt(dungeon_runs)
  return compare(condition.op, value, BigInt(condition.value))
}
const special_condition = (
  condition: Exclude<BehaviorCondition, StateCondition>,
  context: GameplayContext,
  run: Pick<BehaviorRun, 'tally'>
) => {
  if (condition.type === 'fees_spent' || condition.type === 'dungeon_runs') return tally_condition(condition, run)
  if (condition.type === 'sui_balance') {
    const balance = observed_balance(context)
    return balance ? compare(condition.op, BigInt(balance.balance_mist), BigInt(condition.value)) : null
  }
  if (condition.type === 'market_price') return market_price_condition(condition, context)
  const value = world_available(condition.fact, context)
  if (value === null) return null
  return condition.op === 'eq' ? value === condition.value : value !== condition.value
}
/** `run` is the run whose tree asks: its tally answers the conditions on fees and dungeon runs. */
export const behavior_condition = (
  condition: BehaviorCondition,
  context: GameplayContext,
  run: Pick<BehaviorRun, 'tally'> = {}
): boolean | null => {
  if ('type' in condition) return special_condition(condition, context, run)
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
