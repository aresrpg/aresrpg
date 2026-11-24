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
  spell_level_of,
  type FightCommandInput,
  type Fighter,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'

import { support_beneficiaries } from './combat_support.ts'
import type { FightTurnPayload } from './gameplay.ts'
import type { CombatCondition, CombatProfile, CombatStep } from './combat_profile.ts'

type Action = FightTurnPayload['actions'][number]
type Candidate = Readonly<{ actions: readonly Action[]; state: HydratedFightCheckpoint }>
/** `hit`: the hero already cost an enemy some health this turn. */
type Context = Readonly<{ checkpoint: HydratedFightCheckpoint; seat: bigint; observed_ms: bigint; hit?: boolean }>
/** A step that names what it casts or strikes with, and whom it aims at. */
type Aimed = Extract<CombatStep, { type: 'cast' | 'strike' }>
type Attack = Extract<CombatStep, { type: 'attack' }>
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
/** Living teammates other than the caster, most wounded first: a hero alone has none. */
const allies = ({ checkpoint, seat }: Context) => {
  const { team } = checkpoint.contract.fighters[Number(seat)]!
  const wounded = (fighter: Fighter) => {
    const source = fighter.kind.type === 'player' ? checkpoint.sources.players[fighter.kind.character] : undefined
    return { hp: fighter.hp, max: source ? player_max_hp(source) : fighter.hp }
  }
  return checkpoint.contract.fighters
    .map((fighter, index) => ({ fighter, seat: index, ...wounded(fighter) }))
    .filter(
      ({ fighter, seat: index }) =>
        !fighter.dead && !fighter.forfeited && fighter.team === team && BigInt(index) !== seat
    )
    .sort((left, right) => compare(left.hp * right.max, right.hp * left.max) || left.seat - right.seat)
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
  return result.error ? null : { actions: [action], state: result.state }
}
const target_cells = (context: Context, step: Aimed): readonly bigint[] => {
  const { checkpoint, seat } = context
  const legal =
    step.type === 'cast'
      ? spell_target_cells(checkpoint, seat, step.spell).targetable
      : weapon_target_cells(checkpoint, seat).targetable
  if (step.target === 'most_allies') return legal
  if (step.target === 'lowest_hp_ally')
    return allies(context)
      .map(({ fighter }) => fighter.cell)
      .filter((cell) => legal.includes(cell))
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
/** Score observed HP loss, not raw damage events: overkill and collision chains share the twin's result. */
const enemy_hp_loss = (context: Context, candidate: Candidate): bigint =>
  enemies(context).reduce(
    (total, { fighter, seat }) => total + fighter.hp - candidate.state.contract.fighters[seat]!.hp,
    0n
  )
const attack_score = (context: Context, step: Aimed, candidate: Candidate) => {
  switch (step.target) {
    case 'highest_damage_enemy':
      return enemy_hp_loss(context, candidate)
    case 'most_allies': {
      const count = support_beneficiaries(context.checkpoint, candidate.state, context.seat)
      return count > 0 ? BigInt(count) : null
    }
    default:
      return undefined
  }
}
const cast_candidate = (context: Context, step: Aimed): Candidate | null => {
  let best: Readonly<{ candidate: Candidate | null; score: bigint | null }> = { candidate: null, score: null }
  for (const cell of target_cells(context, step)) {
    const action: Action =
      step.type === 'cast'
        ? { type: 'cast', spell: step.spell, target_cell: String(cell) }
        : { type: 'strike', target_cell: String(cell) }
    const candidate = simulate(context, action)
    const score = candidate && attack_score(context, step, candidate)
    if (score === null) continue
    if (score === undefined) return candidate
    if (best.score === null || score > best.score) best = { candidate, score }
  }
  return best.candidate
}
const movement_candidates = (context: Context): readonly Candidate[] =>
  reachable_fight_cells(context.checkpoint, context.seat).flatMap((cell) => {
    const path = fight_path_to(context.checkpoint, context.seat, cell)
    const candidate = path && simulate(context, { type: 'move', path: path.map(String) })
    return candidate ? [candidate] : []
  })
const damage_order = (context: Context, left: Candidate, right: Candidate): number => {
  const seat = Number(context.seat)
  const left_fighter = left.state.contract.fighters[seat]!
  const right_fighter = right.state.contract.fighters[seat]!
  return (
    compare(enemy_hp_loss(context, right), enemy_hp_loss(context, left)) ||
    compare(right_fighter.hp, left_fighter.hp) ||
    compare(right_fighter.mp, left_fighter.mp) ||
    left.actions.length - right.actions.length
  )
}
/** One canonical route per reachable cell, never a promised endpoint after tackle or traps. */
const attack_candidate = (
  context: Context,
  step: Aimed,
  movements: () => readonly Candidate[] = () => movement_candidates(context)
): Candidate | null => {
  const stationary = cast_candidate(context, step)
  if (!step.position) return stationary
  const moved = movements().flatMap((movement) => {
    const { state } = movement
    if (state.contract.ended || state.contract.fighters[Number(context.seat)]!.dead) return []
    const attack = cast_candidate({ ...context, checkpoint: state }, step)
    return attack ? [{ ...attack, actions: [...movement.actions, ...attack.actions] }] : []
  })
  return (
    [...(stationary ? [stationary] : []), ...moved].sort((left, right) => damage_order(context, left, right))[0] ?? null
  )
}
/** The spells the fight twin lets this seat cast at all: its class's, unlocked at its level. */
const learned_spells = ({ checkpoint, seat }: Context): readonly string[] =>
  Object.keys(checkpoint.sources.spells)
    .filter((name) => spell_level_of(checkpoint, seat, name) !== null)
    .toSorted()
/**
 * The most damaging legal action among the weapon and every learned spell, each tried on the real twin.
 * An action that costs no enemy any health is not an attack. The reachable cells are walked once and
 * shared by every option.
 */
const best_attack = (context: Context, { target, position }: Attack): Candidate | null => {
  const aim = { target, ...(position ? { position } : {}) }
  const options: readonly Aimed[] = [
    { type: 'strike', ...aim },
    ...learned_spells(context).map((spell): Aimed => ({ type: 'cast', spell, ...aim })),
  ]
  let walked: readonly Candidate[] | null = null
  const movements = () => (walked ??= movement_candidates(context))
  return (
    options
      .flatMap((option) => {
        const candidate = attack_candidate(context, option, movements)
        return candidate && enemy_hp_loss(context, candidate) > 0n ? [candidate] : []
      })
      .sort((left, right) => damage_order(context, left, right))[0] ?? null
  )
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
  const candidates = movement_candidates(context).flatMap((candidate) => {
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
const conditions: {
  [Type in CombatCondition['type']]: (context: Context, when: Extract<CombatCondition, { type: Type }>) => boolean
} = {
  always: () => true,
  no_hit_yet: (context) => !context.hit,
  enemy_within: (context, when) =>
    enemies(context).length > 0 && enemy_distance(context, context.checkpoint) <= BigInt(when.cells),
  ally_present: (context) => allies(context).length > 0,
  ally_hp_below: (context, when) => allies(context).some(({ hp, max }) => hp * 100n < max * BigInt(when.percent)),
  hp_below: (context, when) => {
    const fighter = context.checkpoint.contract.fighters[Number(context.seat)]!
    if (fighter.kind.type !== 'player') return false
    const source = context.checkpoint.sources.players[fighter.kind.character]
    return !!source && fighter.hp * 100n < player_max_hp(source) * BigInt(when.percent)
  },
}
const condition_matches = (context: Context, when: CombatCondition): boolean =>
  (conditions[when.type] as (context: Context, when: CombatCondition) => boolean)(context, when)

type Draft = Readonly<{ context: Context; actions: readonly Action[]; skipped: readonly string[] }>
const turn_finished = ({ checkpoint, seat }: Context) =>
  checkpoint.contract.ended || checkpoint.contract.fighters[Number(seat)]?.dead !== false

/** How many times one step may act in a turn. A repeated attack goes on while it finds something to
 * do; the bound only stops an action that would cost no action point from looping. */
const STEP_REPEATS = 8
const step_runs = (step: CombatStep): number => (step.type === 'attack' && step.repeat ? STEP_REPEATS : 1)
const step_candidate = (context: Context, step: CombatStep): Candidate | null => {
  switch (step.type) {
    case 'move':
      return movement_candidate(context, step.direction)
    case 'attack':
      return best_attack(context, step)
    default:
      return attack_candidate(context, step)
  }
}
const advance = (draft: Draft, candidate: Candidate): Draft => ({
  context: {
    ...draft.context,
    checkpoint: candidate.state,
    hit: draft.context.hit || enemy_hp_loss(draft.context, candidate) > 0n,
  },
  actions: [...draft.actions, ...candidate.actions],
  skipped: draft.skipped,
})
/** Runs one step as often as it may; the number of times it acted. */
const run_step = (draft: Draft, step: CombatStep): Readonly<{ draft: Draft; runs: number }> => {
  let result = draft
  let runs = 0
  while (runs < step_runs(step) && !turn_finished(result.context)) {
    const candidate = step_candidate(result.context, step)
    if (!candidate) break
    result = advance(result, candidate)
    runs += 1
  }
  return { draft: result, runs }
}
const apply_combo = (draft: Draft, combo: CombatProfile['combos'][number]): Draft => {
  let result = draft
  for (const step of combo.steps) {
    if (turn_finished(result.context)) break
    const { draft: next, runs } = run_step(result, step)
    if (runs === 0) return { ...result, skipped: [...result.skipped, `${combo.name}:${step.type}`] }
    result = next
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
