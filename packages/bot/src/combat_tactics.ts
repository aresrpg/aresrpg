// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_fight,
  fight_path_to,
  reachable_fight_cells,
  spell_target_cells,
  weapon_target_cells,
  player_max_hp,
  manhattan,
  type FightCommandInput,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'

import type { FightTurnPayload } from './gameplay.ts'
import type { CombatCondition, CombatProfile, CombatStep } from './combat_profile.ts'

type Action = FightTurnPayload['actions'][number]
type Candidate = Readonly<{ action: Action; state: HydratedFightCheckpoint }>
type Context = Readonly<{ checkpoint: HydratedFightCheckpoint; seat: bigint; observed_ms: bigint }>
const compare = (left: bigint, right: bigint) => (left < right ? -1 : Number(left > right))
const enemies = ({ checkpoint, seat }: Context) => {
  const { team } = checkpoint.contract.fighters[Number(seat)]!
  return checkpoint.contract.fighters
    .map((fighter, index) => ({ fighter, seat: index }))
    .filter(({ fighter }) => !fighter.dead && !fighter.forfeited && fighter.team !== team)
}
const enemy_order = (context: Context, lowest_hp = false) => {
  const { cell } = context.checkpoint.contract.fighters[Number(context.seat)]!
  return enemies(context).sort(
    (left, right) =>
      (lowest_hp ? compare(left.fighter.hp, right.fighter.hp) : 0) ||
      compare(manhattan(cell, left.fighter.cell), manhattan(cell, right.fighter.cell)) ||
      left.seat - right.seat
  )
}
const command_input = (action: Action, fighter: bigint): FightCommandInput => {
  switch (action.type) {
    case 'cast':
      return { type: 'cast_spell', fighter, spell: action.spell, target_cell: BigInt(action.target_cell) }
    case 'strike':
      return { type: 'weapon_strike', fighter, target_cell: BigInt(action.target_cell) }
    case 'move':
      return { type: 'move_to', fighter, path: action.path.map(BigInt) }
  }
}
const simulate = (context: Context, action: Action): Candidate | null => {
  const runtime = create_fight({ state: context.checkpoint, mode: 'remote' })
  const result = runtime.apply({ ...command_input(action, context.seat), observed_ms: context.observed_ms })
  return result.error ? null : { action, state: result.state }
}
const target_cells = (context: Context, step: Exclude<CombatStep, { type: 'move' }>): readonly bigint[] => {
  const { checkpoint, seat } = context
  const legal =
    step.type === 'cast'
      ? spell_target_cells(checkpoint, seat, step.spell).targetable
      : weapon_target_cells(checkpoint, seat).targetable
  if (step.target === 'self') return legal.filter((cell) => cell === checkpoint.contract.fighters[Number(seat)]!.cell)
  const opponents = enemy_order(context, step.target === 'lowest_hp_enemy')
  if (step.target !== 'trap_near_enemy')
    return opponents.map(({ fighter }) => fighter.cell).filter((cell) => legal.includes(cell))
  const target = opponents[0]?.fighter.cell
  if (target === undefined) return []
  const occupied = checkpoint.contract.fighters.filter((fighter) => !fighter.dead).map(({ cell }) => cell)
  return legal
    .filter((cell) => !occupied.includes(cell))
    .toSorted((left, right) => compare(manhattan(left, target), manhattan(right, target)) || compare(left, right))
}
const cast_candidate = (context: Context, step: Exclude<CombatStep, { type: 'move' }>): Candidate | null => {
  for (const cell of target_cells(context, step)) {
    const action: Action =
      step.type === 'cast'
        ? { type: 'cast', spell: step.spell, target_cell: String(cell) }
        : { type: 'strike', target_cell: String(cell) }
    const candidate = simulate(context, action)
    if (candidate) return candidate
  }
  return null
}
const enemy_distance = (context: Context, state: HydratedFightCheckpoint): bigint => {
  const { cell } = state.contract.fighters[Number(context.seat)]!
  return (
    enemies({ ...context, checkpoint: state }).reduce<bigint | null>((nearest, { fighter }) => {
      const distance = manhattan(cell, fighter.cell)
      return nearest === null || distance < nearest ? distance : nearest
    }, null) ?? 0n
  )
}
const movement_candidate = (context: Context, direction: 'retreat' | 'approach'): Candidate | null => {
  if (!enemies(context).length) return null
  const { checkpoint, seat } = context
  const before = checkpoint.contract.fighters[Number(seat)]!
  const baseline = enemy_distance(context, checkpoint)
  const candidates = reachable_fight_cells(checkpoint, seat).flatMap((cell) => {
    const path = fight_path_to(checkpoint, seat, cell)
    if (!path) return []
    const candidate = simulate(context, { type: 'move', path: path.map(String) })
    if (!candidate) return []
    const after = candidate.state.contract.fighters[Number(seat)]!
    const distance = enemy_distance(context, candidate.state)
    const improves = direction === 'retreat' ? distance > baseline : distance < baseline
    return !after.dead && after.cell !== before.cell && improves
      ? [{ ...candidate, distance, hp: after.hp, cell: after.cell }]
      : []
  })
  candidates.sort(
    (left, right) =>
      compare(right.hp, left.hp) ||
      (direction === 'retreat' ? compare(right.distance, left.distance) : compare(left.distance, right.distance)) ||
      compare(left.cell, right.cell)
  )
  return candidates[0] ?? null
}
const condition_matches = (context: Context, condition: CombatCondition): boolean => {
  switch (condition.type) {
    case 'always':
      return true
    case 'enemy_within':
      return enemies(context).length > 0 && enemy_distance(context, context.checkpoint) <= BigInt(condition.cells)
    case 'hp_below': {
      const fighter = context.checkpoint.contract.fighters[Number(context.seat)]!
      if (fighter.kind.type !== 'player') return false
      const source = context.checkpoint.sources.players[fighter.kind.character]
      return !!source && fighter.hp * 100n < player_max_hp(source) * BigInt(condition.percent)
    }
  }
}

type Draft = Readonly<{ context: Context; actions: readonly Action[]; skipped: readonly string[] }>
const turn_finished = ({ checkpoint, seat }: Context) =>
  checkpoint.contract.ended || checkpoint.contract.fighters[Number(seat)]?.dead !== false

const apply_combo = (draft: Draft, combo: CombatProfile['combos'][number]): Draft => {
  let result = draft
  for (const step of combo.steps) {
    if (turn_finished(result.context)) break
    const candidate =
      step.type === 'move' ? movement_candidate(result.context, step.direction) : cast_candidate(result.context, step)
    if (!candidate) return { ...result, skipped: [...result.skipped, `${combo.name}:${step.type}`] }
    result = {
      context: { ...result.context, checkpoint: candidate.state },
      actions: [...result.actions, candidate.action],
      skipped: result.skipped,
    }
  }
  return result
}

/** One finite pass. Each candidate uses the real remote twin; there is no approximate combat model.
 * This fails if a requested movement endpoint is mistaken for its tackle/trap-adjusted result. */
export const plan_combat_turn = (
  profile: CombatProfile,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  seat: bigint,
  observed_ms: bigint
): Readonly<{ actions: FightTurnPayload['actions']; skipped: readonly string[]; issue?: string }> => {
  const initial: Draft = {
    context: { checkpoint: checkpoint as HydratedFightCheckpoint, seat, observed_ms },
    actions: [],
    skipped: [],
  }
  if (turn_finished(initial.context) || checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)] !== seat)
    return { actions: [], skipped: [], issue: 'not_active_turn' }
  const { actions, skipped } = profile.rules.reduce((draft, rule) => {
    if (!condition_matches(draft.context, rule.when)) return draft
    return apply_combo(
      draft,
      profile.combos.find(({ name }) => name === rule.combo)!
    )
  }, initial)
  return {
    actions,
    skipped,
    ...(actions.length === 0 && profile.fallback === 'awaiting_ai' ? { issue: 'no_legal_tactic' } : {}),
  }
}
