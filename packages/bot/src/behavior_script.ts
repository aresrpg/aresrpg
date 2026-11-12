// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_job_slug } from '@aresrpg/immutable'
import {
  parse_market_observation,
  type HostedObjective,
  type MarketObservation,
  type MarketPriceObservation,
} from '@aresrpg/protocol'

import type { EquipOwnedAction, ConsumeOwnedAction } from './behavior_items.ts'
import { OBJECTIVE_SCHEMA } from './objective.ts'
import { matches, nonempty } from './gameplay_schema.ts'
import { parse_gameplay_action, type GameplayActionName } from './gameplay.ts'
import { parse_combat_profile, type CombatProfile } from './combat_profile.ts'
import { BEHAVIOR_ACTION_SCHEMA, BEHAVIOR_CONDITION_SCHEMA } from './behavior_schema.ts'
import type { BehaviorMemory, BehaviorNode } from './behavior_tree.ts'
import type { DiscoverAction, WorldAvailability } from './behavior_world.ts'
import type { MarketPriceCondition } from './market_prices.ts'
import type { BuySelection, SellSelection } from './behavior_market.ts'

export type BehaviorAction =
  | BuySelection
  | SellSelection
  | DiscoverAction
  | EquipOwnedAction
  | ConsumeOwnedAction
  | Readonly<{ type: 'observe_prices'; observation: MarketPriceObservation }>
  | Readonly<{ type: 'observe_market'; observation: Extract<MarketObservation, { kind: 'offers' }> }>
  | Readonly<{ type: 'call'; kind: GameplayActionName; payload: Readonly<Record<string, unknown>> }>
  | Readonly<{ type: 'gather'; character_id: string; item_type: string; order: 'nearest' }>
  | Readonly<{ type: 'engage'; character_id: string; mob_types: readonly string[]; order: 'nearest' }>
  | Readonly<{ type: 'combat'; profiles: readonly Readonly<{ character_id: string; profile: CombatProfile }>[] }>
export type BehaviorFact = Readonly<{
  type: 'level' | 'job_level' | 'quantity' | 'custody' | 'ambush' | 'fight'
  character_id: string
  key?: string
}>
export type StateCondition = Readonly<{
  fact: BehaviorFact
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
  value: string | number | boolean
}>
export type BehaviorCondition =
  | StateCondition
  | (MarketPriceCondition & Readonly<{ type: 'market_price' }>)
  | Readonly<{ type: 'world'; fact: WorldAvailability; op: 'eq' | 'ne'; value: boolean }>
export type BehaviorScript = Readonly<{
  version: '1'
  objective: HostedObjective
  tree: BehaviorNode<BehaviorAction, BehaviorCondition>
}>
export type BehaviorRun = Readonly<{
  id: string
  bot_id: string
  grant_id: string
  lane_key: string
  fingerprint: string
  observation?: MarketObservation
  prices?: MarketPriceObservation
  script: BehaviorScript
  revision: number
  memory: BehaviorMemory
  pending_node: string | null
  activation: Readonly<{ node: string; fight: string }> | null
  consumed_command_id: string | null
  status: 'active' | 'waiting' | 'awaiting_ai' | 'paused' | 'completed' | 'stopped' | 'failed'
  actions_started: number
  last_command_id: string | null
  issue?: string
  created_at: number
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
const parse_action = (value: unknown) => {
  if (!matches(BEHAVIOR_ACTION_SCHEMA, value)) throw new Error('invalid_behavior_action')
  const action = value as BehaviorAction
  if (action.type === 'call') parse_gameplay_action(action.kind, action.payload)
  if (action.type === 'observe_market') parse_market_observation(action.observation)
  if (action.type === 'buy' && action.min_amount > action.max_amount) throw new Error('invalid_behavior_action')
  if (action.type !== 'combat') return
  const ids = action.profiles.map(({ character_id }) => character_id)
  if (new Set(ids).size !== ids.length) throw new Error('invalid_behavior_action')
  action.profiles.forEach(({ profile }) => parse_combat_profile(profile))
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
  complete: leaf(null, () => undefined),
}
/** Iterative validation avoids a call-stack depth limit; the existing HTTP body limit bounds input. */
export const parse_behavior_script = (value: unknown): BehaviorScript => {
  const script = strict_object(value, ['version', 'objective', 'tree'])
  if (![script.version === '1', matches(OBJECTIVE_SCHEMA, script.objective)].every(Boolean))
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
