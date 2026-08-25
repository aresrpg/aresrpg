// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */

import {
  CARDINAL_DIRECTIONS,
  away_dir,
  bfs_distance_field,
  in_grid,
  manhattan,
  mask_add_cells,
  mask_get,
  path_is_walkable,
  step_cell,
  toward_dir,
} from './combat_grid.ts'
import { draw } from './prng.ts'
import { push_collision_damage, tackle_contest, tackle_losses, tackle_seed } from './fight_math.ts'
import { STATS, effective_stat, hit, spend_ap, spend_mp } from './fighters.ts'
import { emit, fail } from './runtime.ts'
import type { FightRuntime, FightSheet, HydratedFightCheckpoint } from './types.ts'

export type EnterHandler = (runtime: FightRuntime, fighter: bigint, from: bigint) => boolean

type FightContractState = Readonly<Pick<HydratedFightCheckpoint, 'contract'>>

export const living_cells = (runtime: FightContractState, exclude: bigint): bigint[] =>
  runtime.contract.fighters
    .map((fighter, index) => ({ fighter, seat: BigInt(index) }))
    .filter(({ fighter, seat }) => seat !== exclude && !fighter.dead)
    .map(({ fighter }) => fighter.cell)

export const fighter_at = (runtime: FightContractState, cell: bigint): bigint | null => {
  const seat = runtime.contract.fighters.findIndex((fighter) => !fighter.dead && fighter.cell === cell)
  return seat < 0 ? null : BigInt(seat)
}

export const wall_mask = (runtime: FightContractState, fighter: bigint): bigint[] =>
  mask_add_cells(runtime.contract.closed, living_cells(runtime, fighter))

export const reachable_fight_cells = (
  runtime: FightContractState,
  fighter: bigint,
  budget?: bigint
): readonly bigint[] => {
  const subject = runtime.contract.fighters[Number(fighter)]
  const available = budget ?? subject?.mp ?? 0n
  if (!subject || subject.dead || available <= 0n) return Object.freeze([])
  const field = bfs_distance_field(subject.cell, wall_mask(runtime, fighter), available)
  return Object.freeze(
    field.flatMap((distance, cell) => (distance > 0n && distance <= available ? [BigInt(cell)] : []))
  )
}

export const fight_path_to = (
  runtime: FightContractState,
  fighter: bigint,
  target: bigint
): readonly bigint[] | null => {
  const subject = runtime.contract.fighters[Number(fighter)]
  if (!subject || subject.dead || subject.mp <= 0n || subject.cell === target) return null
  const walls = wall_mask(runtime, fighter)
  const field = bfs_distance_field(target, walls, subject.mp)
  if (field[Number(subject.cell)] > subject.mp) return null
  const path: bigint[] = []
  let current = subject.cell
  while (current !== target) {
    const next = best_step(current, field)
    if (next === null) return null
    path.push(next)
    current = next
  }
  return Object.freeze(path)
}

const fresh_lockers = (runtime: FightRuntime, runner: bigint, cell: bigint, beaten: bigint[]) => {
  const { team } = runtime.contract.fighters[Number(runner)]
  return runtime.contract.fighters
    .map((fighter, index) => ({ fighter, seat: BigInt(index) }))
    .filter(
      ({ fighter, seat }) =>
        seat !== runner &&
        !fighter.dead &&
        fighter.team !== team &&
        !beaten.includes(seat) &&
        manhattan(fighter.cell, cell) === 1n
    )
    .map(({ seat }) => ({ seat, agility: effective_stat(runtime, seat, STATS.agility) }))
}

const best_step = (current: bigint, field: bigint[]): bigint | null => {
  const here = field[Number(current)]
  let best = null
  let best_value = here
  for (const direction of CARDINAL_DIRECTIONS) {
    const cell = step_cell(current, direction)
    if (cell === null) continue
    const value = field[Number(cell)]
    if (value < best_value || (value === best_value && best !== null && cell < best)) {
      best = cell
      best_value = value
    }
  }
  return best
}

const tackle_departure = (runtime: FightRuntime, runner: bigint, cell: bigint, beaten: bigint[]): bigint[] => {
  const lockers = fresh_lockers(runtime, runner, cell, beaten)
  if (lockers.length === 0) return beaten
  const next_beaten = [...beaten, ...lockers.map(({ seat }) => seat)]
  const fighter = runtime.contract.fighters[Number(runner)]
  const contest = tackle_contest(
    effective_stat(runtime, runner, STATS.agility),
    lockers.map(({ agility }) => agility)
  )
  let escaped = true
  let ap_loss = 0n
  let mp_loss = 0n
  if (contest.numerator < contest.denominator) {
    const cursor = { state: tackle_seed(runtime.contract.turn_seed, fighter.mp) }
    escaped = draw(cursor) % contest.denominator < contest.numerator
    if (!escaped) {
      const losses = tackle_losses(fighter.ap, fighter.mp, contest.numerator, contest.denominator)
      ;({ ap_loss, mp_loss } = losses)
      spend_ap(runtime, runner, ap_loss, 'tackle_toll', lockers[0].seat)
      spend_mp(runtime, runner, mp_loss, 'tackle_toll', lockers[0].seat)
    }
  }
  emit(runtime, 'tackle_resolved', {
    runner,
    cell,
    lockers: lockers.map(({ seat }) => seat),
    escaped,
    ap_lost: ap_loss,
    mp_lost: mp_loss,
  })
  return next_beaten
}

export const walk_path = (
  runtime: FightRuntime,
  runner: bigint,
  path: readonly bigint[],
  on_enter: EnterHandler
): FightRuntime => {
  const start = runtime.contract.fighters[Number(runner)].cell
  if (!path_is_walkable(start, path, wall_mask(runtime, runner), runtime.contract.fighters[Number(runner)].mp))
    return fail(runtime, 'no_path', { runner, path })
  let beaten: bigint[] = []
  let expected = start
  for (const next of path) {
    const fighter = runtime.contract.fighters[Number(runner)]
    if (fighter.cell !== expected || fighter.mp === 0n) return runtime
    beaten = tackle_departure(runtime, runner, expected, beaten)
    if (fighter.mp === 0n) return runtime
    // Bodies are walls, and the pre-validated mask is stale the moment a trap payload moves
    // someone: a body now standing on the declared next cell stops the remaining route.
    if (fighter_at(runtime, next) !== null) return runtime
    fighter.cell = next
    spend_mp(runtime, runner, 1n, 'walk', runner)
    emit(runtime, 'fighter_moved', {
      fighter: runner,
      from: expected,
      to: next,
      mode: 'walk',
      source: runner,
      mp_spent: 1n,
    })
    on_enter(runtime, runner, expected)
    if (runtime.contract.ended || fighter.dead) return runtime
    expected = next
  }
  return runtime
}

export const walk_toward = (
  runtime: FightRuntime,
  runner: bigint,
  target: bigint,
  on_enter: EnterHandler
): FightRuntime => {
  const walls = wall_mask(runtime, runner)
  const start = runtime.contract.fighters[Number(runner)].cell
  if (start === target) return runtime
  // callers guarantee the target is reachable within MP — the flood never fills the board
  const field = bfs_distance_field(target, walls, runtime.contract.fighters[Number(runner)].mp)
  if (field[Number(start)] > runtime.contract.fighters[Number(runner)].mp)
    return fail(runtime, 'no_path', { runner, target })
  return walk_down(runtime, runner, field, on_enter)
}

/** Step DOWN a distance field until it bottoms out (0 = arrived) or the budget ends —
 * tackles, traps, and the staleness law ride every step. Shared by the exact walker
 * (destination field) and the rusher (approach field). Twin of aresrpg_math `wd`. */
export const walk_down = (
  runtime: FightRuntime,
  runner: bigint,
  field: bigint[],
  on_enter: EnterHandler
): FightRuntime => {
  let beaten: bigint[] = []
  while (true) {
    const fighter = runtime.contract.fighters[Number(runner)]
    const current = fighter.cell
    if (field[Number(current)] === 0n || fighter.mp === 0n) return runtime
    beaten = tackle_departure(runtime, runner, current, beaten)
    if (fighter.mp === 0n) return runtime
    const next = best_step(current, field)
    if (next === null) return runtime
    // Same staleness law as walk_path: the field predates any mid-walk displacement — a body
    // now standing on the chosen step stops the walk.
    if (fighter_at(runtime, next) !== null) return runtime
    runtime.contract.fighters[Number(runner)].cell = next
    spend_mp(runtime, runner, 1n, 'walk', runner)
    emit(runtime, 'fighter_moved', {
      fighter: runner,
      from: current,
      to: next,
      mode: 'walk',
      source: runner,
      mp_spent: 1n,
    })
    on_enter(runtime, runner, current)
    if (runtime.contract.ended || runtime.contract.fighters[Number(runner)].dead) return runtime
  }
}

export const displace = ({
  runtime,
  sheet,
  source,
  target,
  cells,
  push,
  origin,
  on_enter,
}: {
  runtime: FightRuntime
  sheet: FightSheet
  source: bigint
  target: bigint
  cells: bigint
  push: boolean
  origin: bigint
  on_enter: EnterHandler
}): void => {
  const direction = push
    ? away_dir(origin, runtime.contract.fighters[Number(target)].cell)
    : toward_dir(origin, runtime.contract.fighters[Number(target)].cell)
  let remaining = cells
  let blocked = false
  let trap_stopped = false
  while (remaining > 0n) {
    const current = runtime.contract.fighters[Number(target)].cell
    if (!push && manhattan(current, origin) <= 1n) break
    const next = step_cell(current, direction)
    if (
      next === null ||
      !in_grid(next) ||
      mask_get(runtime.contract.closed, next) ||
      fighter_at(runtime, next) !== null
    ) {
      blocked = true
      break
    }
    runtime.contract.fighters[Number(target)].cell = next
    remaining -= 1n
    emit(runtime, 'fighter_moved', {
      fighter: target,
      from: current,
      to: next,
      mode: push ? 'push' : 'pull',
      source,
      mp_spent: 0n,
    })
    trap_stopped = on_enter(runtime, target, current)
    if (trap_stopped || runtime.contract.fighters[Number(target)].dead) break
  }
  if (push && blocked && remaining > 0n && !trap_stopped) {
    const damage = push_collision_damage(sheet.level, remaining)
    emit(runtime, 'push_collided', { source, target, blocked_cells: remaining, damage })
    hit(runtime, { target, amount: damage, source, cause: 'push_collision' })
  }
}
