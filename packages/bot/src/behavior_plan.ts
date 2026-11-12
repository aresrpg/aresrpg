// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { MarketObservation, MarketPriceObservation } from '@aresrpg/protocol'

import { planning_issue, planning_blocker } from './planning_failure.ts'
import { select_owned_item } from './behavior_items.ts'
import { select_purchase, select_sale } from './behavior_market.ts'
import { market_observation_progress } from './actor_market.ts'
import { market_prices_observed } from './market_prices.ts'
import { select_discovery, type WorldSelection } from './behavior_world.ts'
import type { Command } from './control.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { validate_gameplay } from './gameplay.ts'
import { next_combat_action, type CombatNext } from './combat_plan.ts'
import { nearest_gather, nearest_group, type SelectedAction } from './behavior_targets.ts'
import { evaluate_behavior, empty_behavior_memory, type BehaviorResult } from './behavior_tree.ts'
import { behavior_condition } from './behavior_facts.ts'
import type { BehaviorAction, BehaviorRun } from './behavior_script.ts'

type Resolution = Readonly<{
  status: 'action' | 'failure' | 'waiting' | 'success' | 'replan'
  action?: SelectedAction
  fight?: string
  issue?: string
  observation?: MarketObservation
  prices?: MarketPriceObservation
}>
const combat_resolution = (
  action: Extract<BehaviorAction, { type: 'combat' }>,
  run: BehaviorRun,
  context: GameplayContext,
  previous: Command | null
): Resolution => {
  const fights = new Set(
    action.profiles
      .map(({ character_id }) => context.snapshot.characters.find(({ id }) => id === character_id)?.active_fight?.id)
      .filter(Boolean)
  )
  const fight = run.activation?.fight ?? (fights.size === 1 ? [...fights][0] : null)
  if (!fight) return { status: 'failure', issue: 'fight_unavailable' }
  const next = next_combat_action(
    { fight, profiles: action.profiles.map((row) => ({ ...row, revision: run.revision })) },
    context
  )
  if (
    [
      next.state === 'completed',
      [!run.activation, previous?.kind !== 'fight_settle', previous?.payload.fight !== fight].some(Boolean),
    ].every(Boolean)
  )
    return { status: 'replan', issue: 'custody_changed' }
  const statuses: Record<CombatNext['state'], Resolution['status']> = {
    action: 'action',
    completed: 'success',
    waiting: 'waiting',
    awaiting_ai: 'replan',
  }
  return { status: statuses[next.state], action: next.action, issue: next.issue, fight }
}
const world_resolution = (selection: WorldSelection, context: GameplayContext): Resolution => {
  if (selection.status !== 'action')
    return { status: selection.status, issue: 'code' in selection ? selection.code : undefined }
  validate_gameplay({ ...context, command: { ...context.command, ...selection.action } })
  return selection
}
const observation_resolution = (
  action: Extract<BehaviorAction, { type: 'observe_market' | 'observe_prices' }>,
  context: GameplayContext
): Resolution => {
  if (action.type === 'observe_prices')
    return {
      status: market_prices_observed(action.observation, context) ? 'success' : 'waiting',
      prices: action.observation,
    }
  const progress = market_observation_progress(action.observation, context.snapshot.inventory)
  return { status: progress.complete ? 'success' : 'waiting', observation: progress.observation }
}
const resolve_action = (
  action: BehaviorAction,
  run: BehaviorRun,
  context: GameplayContext,
  previous: Command | null
): Resolution => {
  try {
    const selected = (value: SelectedAction | undefined): Resolution =>
      value
        ? world_resolution({ status: 'action', action: value }, context)
        : { status: 'failure', issue: 'target_unavailable' }
    const resolvers = {
      observe_market: (value) => observation_resolution(value, context),
      observe_prices: (value) => observation_resolution(value, context),
      discover: (value) => world_resolution(select_discovery(value, context), context),
      equip_owned: (value) => world_resolution(select_owned_item(value, context), context),
      consume_owned: (value) => world_resolution(select_owned_item(value, context), context),
      combat: (value) => combat_resolution(value, run, context, previous),
      buy: (value) => selected(select_purchase(value, context)),
      sell: (value) => selected(select_sale(value, context)),
      call: (value) => selected({ kind: value.kind, payload: value.payload }),
      gather: (value) => selected(nearest_gather(value.character_id, value.item_type, context)),
      engage: (value) => selected(nearest_group(value.character_id, value.mob_types, context)),
    } satisfies { [Action in BehaviorAction as Action['type']]: (value: Action) => Resolution }
    return resolvers[action.type](action as never)
  } catch (error) {
    const known = planning_issue(error)
    if (!known) throw error
    return { status: known.state === 'waiting' ? 'waiting' : 'replan', issue: known.issue }
  }
}
/** Consume only the command associated with this leaf; retained receipts cannot complete a new traversal. */
const consume_completion = (run: BehaviorRun, previous: Command | null): BehaviorRun => {
  if (!previous || !run.pending_node || previous.id === run.consumed_command_id) return run
  const memory = run.activation ? run.memory : { ...run.memory, completed: [...run.memory.completed, run.pending_node] }
  return { ...run, memory, consumed_command_id: previous.id }
}
const continuation = (
  run: BehaviorRun,
  result: BehaviorResult<BehaviorAction>,
  selected: Resolution,
  observation: MarketObservation | undefined,
  prices: MarketPriceObservation | undefined
): BehaviorRun => ({
  ...run,
  observation,
  prices,
  memory: result.status === 'success' ? empty_behavior_memory() : result.memory,
  pending_node: result.status === 'action' ? result.node! : null,
  activation: selected.fight ? { node: result.node!, fight: selected.fight } : result.blocked ? run.activation : null,
})
const states = {
  success: 'waiting',
  failure: 'awaiting_ai',
  waiting: 'waiting',
  complete: 'completed',
  replan: 'awaiting_ai',
  action: 'action',
} as const
/** Called only after the durable command and its receipt projection have reconciled. */
const evaluate_behavior_action = (run: BehaviorRun, previous: Command | null, context: GameplayContext) => {
  const completed = consume_completion(run, previous)
  const consumed = completed.observation
    ? {
        ...completed,
        observation: market_observation_progress(completed.observation, context.snapshot.inventory).observation,
      }
    : completed
  const resolved = new Map<string, Resolution>()
  const result = evaluate_behavior(
    run.script.tree,
    consumed.memory,
    (condition) => behavior_condition(condition, context),
    (action, path) => {
      const active = path === run.activation?.node ? consumed : { ...consumed, activation: null }
      const resolution = resolve_action(action, active, context, previous)
      resolved.set(path, resolution)
      return resolution.status
    }
  )
  const selected = resolved.get(String(result.node)) ?? {
    status: 'failure',
    issue: result.status === 'failure' ? 'no_behavior_matched' : undefined,
  }
  const prices = [...resolved.values()].reduce((prior, next) => next.prices ?? prior, consumed.prices)
  const observation = [...resolved.values()].reduce((prior, next) => next.observation ?? prior, consumed.observation)
  return {
    state: states[result.status],
    action: selected.action,
    record: continuation(consumed, result, selected, observation, prices),
    issue: result.blocked ? 'observation_unavailable' : (result.reason ?? selected.issue),
    node: result.node,
  }
}

export const next_behavior_action = (run: BehaviorRun, previous: Command | null, context: GameplayContext) => {
  try {
    return { ...evaluate_behavior_action(run, previous, context), diagnostic: undefined as Error | undefined }
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Persist a safe blocker; caller reports the diagnostic only after commit.
  } catch (error) {
    return { ...planning_blocker(error, 'behavior', run), action: undefined, node: undefined }
  }
}
