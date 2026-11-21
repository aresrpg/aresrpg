// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_job_slug } from '@aresrpg/immutable'
import {
  parse_market_observation,
  type HostedObjective,
  type MarketObservation,
  type MarketPriceObservation,
} from '@aresrpg/protocol'

import type { ProfessionSelection } from './behavior_profession.ts'
import { parse_target_options, parse_world_area, type TargetOptions } from './target_constraints.ts'
import type { EquipOwnedAction, ConsumeOwnedAction } from './behavior_items.ts'
import type { DungeonAction, JoinAction } from './behavior_team.ts'
import type { SpendAction } from './behavior_growth.ts'
import type { GroupOrder } from './behavior_targets.ts'
import { OBJECTIVE_SCHEMA } from './objective.ts'
import { matches, nonempty } from './gameplay_schema.ts'
import { parse_gameplay_action, type GameplayActionName } from './gameplay.ts'
import { parse_combat_profile, type CombatProfile } from './combat_profile.ts'
import { BEHAVIOR_ACTION_SCHEMA, BEHAVIOR_CONDITION_SCHEMA } from './behavior_schema.ts'
import type { BehaviorMemory, BehaviorNode } from './behavior_tree.ts'
import type { DiscoverAction, WorldAvailability } from './behavior_world.ts'
import type { MarketPriceCondition } from './market_prices.ts'
import type { BuySelection, SellSelection } from './behavior_market.ts'
import type { RunTally } from './behavior_tally.ts'

export type BehaviorAction =
  | BuySelection
  | SellSelection
  | DiscoverAction
  | ProfessionSelection
  | EquipOwnedAction
  | ConsumeOwnedAction
  | JoinAction
  | DungeonAction
  | SpendAction
  | Readonly<{ type: 'observe_prices'; observation: MarketPriceObservation }>
  | Readonly<{ type: 'observe_market'; observation: Extract<MarketObservation, { kind: 'offers' }> }>
  | Readonly<{ type: 'call'; kind: GameplayActionName; payload: Readonly<Record<string, unknown>> }>
  | Readonly<{ type: 'gather'; character_id: string; item_type: string; order: 'nearest' }>
  | (Readonly<{
      type: 'engage'
      character_id: string
      mob_types: readonly string[]
      target_options?: TargetOptions
    }> &
      GroupOrder)
  | Readonly<{
      type: 'combat'
      target_options?: TargetOptions
      /** Teammates given the placement window to join before this hero readies. */
      allies?: readonly string[]
      profiles: readonly Readonly<{ character_id: string; profile: CombatProfile }>[]
    }>
export type BehaviorFact = Readonly<{
  type:
    'level' | 'job_level' | 'quantity' | 'hp' | 'max_hp' | 'hp_percent' | 'custody' | 'ambush' | 'fight' | 'dungeon_run'
  character_id: string
  key?: string
}>
export type StateCondition = Readonly<{
  fact: BehaviorFact
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
  value: string | number | boolean
}>
/** A fact of the run itself, never of the game: what it tallied since its tree was accepted. */
export type TallyCondition =
  | Readonly<{ type: 'fees_spent'; op: StateCondition['op']; value: string }>
  | Readonly<{ type: 'dungeon_runs'; op: StateCondition['op']; value: number }>
export type BehaviorCondition =
  | StateCondition
  | TallyCondition
  | Readonly<{ type: 'sui_balance'; op: StateCondition['op']; value: string }>
  | (MarketPriceCondition & Readonly<{ type: 'market_price' }>)
  | Readonly<{ type: 'world'; fact: WorldAvailability; op: 'eq' | 'ne'; value: boolean }>
export type BehaviorScript = Readonly<{
  version: '1'
  /** The catalogue entry a client bound this tree from. Reported back with the run; never executed or checked. */
  strategy?: string
  objective: HostedObjective
  tree: BehaviorNode<BehaviorAction, BehaviorCondition>
}>
export type BehaviorRun = Readonly<{
  id: string
  bot_id: string
  grant_id: string
  lane_key: string
  /** The one hero this tree acts for; with the bot it is the run's identity. */
  character_id: string
  fingerprint: string
  observation?: MarketObservation
  prices?: MarketPriceObservation
  script: BehaviorScript
  revision: number
  execution_fence?: number
  memory: BehaviorMemory
  pending_node: string | null
  activation: Readonly<{ node: string; fight: string }> | null
  consumed_command_id: string | null
  status: 'active' | 'waiting' | 'awaiting_ai' | 'paused' | 'completed' | 'stopped' | 'failed'
  actions_started: number
  last_command_id: string | null
  issue?: string
  created_at: number
  /** What this run paid and finished since its tree was accepted; absent until the first entry. */
  tally?: RunTally
}>
const strict_object = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_behavior_script')
  const record = value as Record<string, unknown>
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => ![...required, ...optional].includes(key))
  )
    throw new Error('invalid_behavior_script')
  return record
}
/** What a leaf's schema cannot express. */
const leaf_checks: { [Type in BehaviorAction['type']]?: (leaf: Extract<BehaviorAction, { type: Type }>) => void } = {
  call: (leaf) => parse_gameplay_action(leaf.kind, leaf.payload),
  observe_market: (leaf) => parse_market_observation(leaf.observation),
  dungeon: (leaf) => parse_combat_profile(leaf.profile),
  buy: (leaf) => {
    if (leaf.min_amount > leaf.max_amount) throw new Error('invalid_behavior_action')
  },
  combat: (leaf) => {
    const ids = leaf.profiles.map(({ character_id }) => character_id)
    if (new Set(ids).size !== ids.length) throw new Error('invalid_behavior_action')
    leaf.profiles.forEach(({ profile }) => parse_combat_profile(profile))
  },
}
const parse_action = (value: unknown) => {
  if (!matches(BEHAVIOR_ACTION_SCHEMA, value)) throw new Error('invalid_behavior_action')
  const action = value as BehaviorAction
  parse_target_options((value as { target_options?: unknown }).target_options)
  parse_world_area((value as { area?: unknown }).area)
  ;(leaf_checks[action.type] as ((leaf: BehaviorAction) => void) | undefined)?.(action)
}
const parse_condition = (value: unknown) => {
  if (!matches(BEHAVIOR_CONDITION_SCHEMA, value)) throw new Error('invalid_behavior_condition')
  const condition = value as BehaviorCondition
  if (!('fact' in condition)) return
  const { fact } = condition
  if (fact.type === 'job_level' && !is_job_slug(fact.key!)) throw new Error('invalid_behavior_condition')
}
const children = (node: Record<string, unknown>) => {
  strict_object(node, ['type', 'children'])
  if (!Array.isArray(node.children) || !node.children.length) throw new Error('invalid_behavior_script')
  return node.children
}
const leaf = (field: string | null, validate: (value: unknown) => unknown) => (node: Record<string, unknown>) => {
  strict_object(node, field ? ['type', field] : ['type'])
  if (field) validate(node[field])
  return []
}
const visitors: Readonly<Record<string, (node: Record<string, unknown>) => readonly unknown[]>> = {
  sequence: children,
  selector: children,
  loop: (node) => {
    strict_object(node, ['type', 'child'])
    return [node.child]
  },
  condition: leaf('condition', parse_condition),
  action: leaf('action', parse_action),
  replan: leaf('reason', (value) => {
    if (!matches(nonempty, value)) throw new Error('invalid_behavior_script')
  }),
  wait: leaf(null, () => undefined),
  complete: (node) => {
    strict_object(node, ['type'], ['reason'])
    if (node.reason !== undefined && !matches(nonempty, node.reason)) throw new Error('invalid_behavior_script')
    return []
  },
}
/** Iterative validation avoids a call-stack depth limit; the existing HTTP body limit bounds input. */
export const parse_behavior_script = (value: unknown): BehaviorScript => {
  const script = strict_object(value, ['version', 'objective', 'tree'], ['strategy'])
  const named = script.strategy === undefined || matches(nonempty, script.strategy)
  if (![script.version === '1', named, matches(OBJECTIVE_SCHEMA, script.objective)].every(Boolean))
    throw new Error('invalid_behavior_script')
  const pending = [script.tree]
  const seen = new Set<unknown>()
  while (pending.length) {
    const value = pending.pop()
    if ([!value, typeof value !== 'object', seen.has(value)].some(Boolean)) throw new Error('invalid_behavior_script')
    seen.add(value)
    const node = value as Record<string, unknown>
    const visit = Object.hasOwn(visitors, String(node.type)) ? visitors[String(node.type)] : undefined
    if (!visit) throw new Error('invalid_behavior_script')
    pending.push(...visit(node))
  }
  return structuredClone(script) as BehaviorScript
}
