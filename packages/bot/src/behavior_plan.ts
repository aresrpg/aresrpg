// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { MarketObservation, MarketPriceObservation } from '@aresrpg/protocol'
import {
  characteristic_cost_step,
  characteristic_names,
  is_class_name,
  type CharacteristicName,
  type ClassName,
} from '@aresrpg/immutable'

import type { Journey } from './idle.ts'
import { select_profession } from './behavior_profession.ts'
import { planning_issue, planning_blocker } from './planning_failure.ts'
import { select_owned_item } from './behavior_items.ts'
import { select_purchase, select_sale } from './behavior_market.ts'
import { market_observation_progress } from './actor_market.ts'
import { market_prices_observed } from './market_prices.ts'
import { select_discovery, type WorldSelection } from './behavior_world.ts'
import type { Command, Lane } from './control.ts'
import { hydrate_gameplay_fight, type GameplayContext, owned_character } from './gameplay_context.ts'
import { validate_gameplay } from './gameplay.ts'
import { next_combat_action, type CombatNext } from './combat_plan.ts'
import { nearest_gather, select_group, type SelectedAction } from './behavior_targets.ts'
import { select_dungeon_step, select_join } from './behavior_team.ts'
import { evaluate_behavior, empty_behavior_memory, type BehaviorResult } from './behavior_tree.ts'
import { behavior_condition } from './behavior_facts.ts'
import type { BehaviorAction, BehaviorRun, BehaviorScript } from './behavior_script.ts'
import { observe_dungeon } from './behavior_tally.ts'
import type { ControlTransaction } from './store.ts'
import { ended_run } from './run_ref.ts'
import { identifier, nonempty, object_schema } from './gameplay_schema.ts'
import { spell_upgrade_quote } from './catalog.ts'

/** Authored priorities, never a hidden build. Stat points go to the first listed stat they can
 * raise. Spell points go to the first listed spell that still has a rank to gain and wait until they
 * pay for it, so a later spell never takes what an earlier one is saving for. A hero with nothing to
 * spend fails the leaf, so its selector moves on. */
export type SpendAction = Readonly<{
  type: 'spend_points'
  character_id: string
  stats: readonly CharacteristicName[]
  spells: readonly string[]
}>
export const SPEND_ACTION_SCHEMA = object_schema({
  type: { const: 'spend_points' },
  character_id: identifier,
  stats: { type: 'array', uniqueItems: true, items: { oneOf: characteristic_names.map((stat) => ({ const: stat })) } },
  spells: { type: 'array', uniqueItems: true, items: nonempty },
})
/** Every whole class-cost step the unspent capital pays for in one stat. */
const stat_spending = (classe: ClassName, stat: CharacteristicName, value: number, points: number) => {
  let [spent, gained] = [0, 0]
  for (;;) {
    const step = characteristic_cost_step(classe, stat, value + gained)
    if (step.cost < 1 || spent + step.cost > points) return spent
    spent += step.cost
    gained += step.gain
  }
}
export const select_spending = (action: SpendAction, context: GameplayContext): WorldSelection => {
  const hero = owned_character(context, action.character_id)
  const { classe, id: character_id } = hero
  if (!is_class_name(classe) || hero.custody !== 'kiosk' || hero.active_fight)
    return { status: 'failure', code: 'character_not_available' }
  const points = (stat: CharacteristicName) => stat_spending(classe, stat, hero[stat], hero.available_points)
  const stat = action.stats.find((name) => points(name) > 0)
  if (stat)
    return {
      status: 'action',
      action: { kind: 'raise_stats', payload: { character_id, spending: { [stat]: points(stat) } } },
    }
  const spell = action.spells.find((name) => spell_upgrade_quote(name, hero) !== null)
  return spell && spell_upgrade_quote(spell, hero)!.cost <= hero.available_spell_points
    ? { status: 'action', action: { kind: 'raise_spell', payload: { character_id, spell } } }
    : { status: 'failure', code: 'nothing_to_spend' }
}
type Resolution = Readonly<{
  status: 'action' | 'failure' | 'waiting' | 'success' | 'replan'
  action?: SelectedAction
  fight?: string
  issue?: string
  observation?: MarketObservation
  /** Where a walking leaf sends the hero: the background loop goes there and nothing is signed. */
  journey?: Journey
  prices?: MarketPriceObservation
}>
type CombatLeaf = Pick<Extract<BehaviorAction, { type: 'combat' }>, 'profiles' | 'target_options' | 'allies'> &
  Readonly<{ dungeon?: string }>
/** The fight this leaf plays: its activation, else the one its hero sits in. A room belongs to the
 * dungeon leaf and an ordinary fight to the combat leaf, so the other kind falls through. */
const leaf_fight = (action: CombatLeaf, run: BehaviorRun, context: GameplayContext) => {
  const fights = new Set(
    action.profiles
      .map(({ character_id }) => context.snapshot.characters.find(({ id }) => id === character_id)?.active_fight?.id)
      .filter(Boolean)
  )
  const fight = run.activation?.fight ?? (fights.size === 1 ? [...fights][0]! : null)
  const row = fight ? context.snapshot.fights[fight] : undefined
  const foreign = row && (hydrate_gameplay_fight(row).contract.dungeon ?? undefined) !== action.dungeon
  return foreign ? null : fight
}
const combat_resolution = (
  action: CombatLeaf,
  run: BehaviorRun,
  context: GameplayContext,
  previous: Command | null
): Resolution => {
  const fight = leaf_fight(action, run, context)
  if (!fight) return { status: 'failure', issue: 'fight_unavailable' }
  const next = next_combat_action({ ...action, fight }, context)
  if (
    [
      next.state === 'completed',
      [!run.activation, previous?.kind !== 'fight_settle', previous?.payload.fight !== fight].some(Boolean),
    ].every(Boolean)
  )
    return { status: 'failure', issue: 'custody_changed' }
  const statuses: Record<CombatNext['state'], Resolution['status']> = {
    action: 'action',
    completed: 'success',
    waiting: 'waiting',
    failure: 'failure',
    awaiting_ai: 'replan',
  }
  return { status: statuses[next.state], action: next.action, issue: next.issue, fight }
}
const dungeon_resolution = (
  action: Extract<BehaviorAction, { type: 'dungeon' }>,
  run: BehaviorRun,
  context: GameplayContext,
  previous: Command | null
): Resolution => {
  const { character_id, profile, allies, dungeon } = action
  const hero = context.snapshot.characters.find(({ id }) => id === character_id)
  return (run.activation ?? hero?.active_fight)
    ? combat_resolution({ profiles: [{ character_id, profile }], allies, dungeon }, run, context, previous)
    : world_resolution(select_dungeon_step(action, context), context)
}
const world_resolution = (selection: WorldSelection, context: GameplayContext): Resolution => {
  if (selection.status !== 'action')
    return {
      status: selection.status,
      issue: 'code' in selection ? selection.code : undefined,
      journey: 'journey' in selection ? selection.journey : undefined,
    }
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
      profession: (value) => world_resolution(select_profession(value, context), context),
      discover: (value) => world_resolution(select_discovery(value, context), context),
      equip_owned: (value) => world_resolution(select_owned_item(value, context), context),
      consume_owned: (value) => world_resolution(select_owned_item(value, context), context),
      combat: (value) => combat_resolution(value, run, context, previous),
      dungeon: (value) => dungeon_resolution(value, run, context, previous),
      join: (value) => world_resolution(select_join(value, context), context),
      spend_points: (value) => world_resolution(select_spending(value, context), context),
      buy: (value) => selected(select_purchase(value, context)),
      sell: (value) => selected(select_sale(value, context)),
      call: (value) => selected({ kind: value.kind, payload: value.payload }),
      gather: (value) => selected(nearest_gather(value.character_id, value.item_type, context)),
      engage: (value) =>
        selected(select_group(value.character_id, value.mob_types, context, value.target_options, value)),
    } satisfies { [Action in BehaviorAction as Action['type']]: (value: Action) => Resolution }
    return resolvers[action.type](action as never)
  } catch (error) {
    const known = planning_issue(error)
    if (!known) throw error
    return { status: known.state, issue: known.issue }
  }
}
/** Consume only the command associated with this leaf; retained receipts cannot complete a new traversal.
 * A command that did not complete completes nothing: the tree selects against fresh state again. */
const consume_completion = (run: BehaviorRun, previous: Command | null): BehaviorRun => {
  if (!previous || !run.pending_node || previous.id === run.consumed_command_id) return run
  if (previous.status !== 'completed') return { ...run, consumed_command_id: previous.id }
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
// Only an authored replan yields to the author. A failed tree waits for the facts to change.
const states = {
  success: 'waiting',
  failure: 'waiting',
  waiting: 'waiting',
  complete: 'completed',
  replan: 'awaiting_ai',
  action: 'action',
} as const
/** Called only after the live command and its receipt projection have reconciled. */
const evaluate_behavior_action = (run: BehaviorRun, previous: Command | null, context: GameplayContext) => {
  const hero = context.snapshot.characters.find(({ id }) => id === run.character_id)
  const completed = observe_dungeon(consume_completion(run, previous), hero)
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
    (condition) => behavior_condition(condition, context, consumed),
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
    journey: selected.journey,
  }
}

export const next_behavior_action = (run: BehaviorRun, previous: Command | null, context: GameplayContext) => {
  try {
    return { ...evaluate_behavior_action(run, previous, context), diagnostic: undefined as Error | undefined }
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Persist a safe blocker; caller reports the diagnostic only after commit.
  } catch (error) {
    return { ...planning_blocker(error, run), action: undefined, node: undefined, journey: undefined }
  }
}
const action_characters = (action: BehaviorAction): readonly string[] => {
  if ('character_id' in action) return [action.character_id]
  if (action.type === 'combat') return action.profiles.map(({ character_id }) => character_id)
  if (action.type !== 'call') return []
  return typeof action.payload.character_id === 'string' ? [action.payload.character_id] : []
}
const nodes = (script: BehaviorScript) => {
  const pending = [script.tree]
  const visited: BehaviorScript['tree'][] = []
  while (pending.length) {
    const node = pending.pop()!
    visited.push(node)
    if ('children' in node) pending.push(...node.children)
    if ('child' in node) pending.push(node.child)
  }
  return visited
}
const acting_ids = (script: BehaviorScript) =>
  nodes(script).flatMap((node) => (node.type === 'action' ? action_characters(node.action) : []))
/** A tree acts for exactly one hero, the key of its run. Conditions may still read teammates. */
export const behavior_actor = (script: BehaviorScript): string => {
  const ids = new Set(acting_ids(script))
  if (ids.size !== 1) throw new Error('behavior_needs_one_character')
  return [...ids][0]!
}
/** Accepted, unprepared drafts may refresh targets within the same tree leaf. A changed branch
 * retires that draft; it can never inherit its command ID or be counted as successful execution. */
export const retain_behavior_draft = async (
  tx: ControlTransaction,
  run: BehaviorRun,
  current: Command,
  lane: Lane,
  context: GameplayContext
): Promise<Command | null | Error> => {
  const next = next_behavior_action(run, null, context)
  const { node } = current.behavior_binding!
  if ([next.state === 'waiting', next.record.activation?.node === node].every(Boolean)) return null
  if ([next.state === 'action', next.node === node].every(Boolean)) {
    const refreshed: Command = {
      ...current,
      ...next.action!,
      observation_revision: lane.observation_revision,
      action_baseline: undefined,
      fight_baseline: undefined,
    }
    await tx.put(`command:${current.id}`, refreshed)
    await tx.put(`behavior:${run.id}`, next.record)
    return refreshed
  }
  const status = next.state === 'action' ? 'active' : next.state
  await tx.put(`behavior:${run.id}`, {
    ...next.record,
    status,
    last_command_id: null,
    pending_node: null,
    activation: null,
    issue: next.issue,
  })
  await tx.put(`command:${current.id}`, {
    ...current,
    status: 'cancelled',
    error: 'behavior_changed_before_preparation',
  })
  await tx.put(current.lane_key, {
    ...lane,
    active_command: null,
    ...ended_run(lane, run.id, { status, issue: next.issue }),
  })
  return next.diagnostic ?? null
}
