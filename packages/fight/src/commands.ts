// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign, fp-law/no-mutating-methods -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */

import { resolve_spell } from './effects.ts'
import { is_mob, is_player, kill_fighter, living_count } from './fighters.ts'
import { CONTRACT_CONSTANTS } from './move_contract.gen.ts'
import { walk_path } from './movement.ts'
import { emit, fail } from './runtime.ts'
import { run_until_player, weave } from './turns.ts'
import { tick_cooldowns } from './turn_effects.ts'
import { drop_owned_zones, on_enter } from './zones.ts'
import { resolve_rows } from './effects.ts'
import { strike_of } from './weapon.ts'
import type {
  BoundaryAction,
  CastAction,
  CommandOptions,
  FightCommand,
  FightRuntime,
  ForfeitAction,
  JoinAction,
  MoveAction,
  PlaceAction,
  PlayerFighter,
  ReadyAction,
  StrikeAction,
} from './types.ts'

const placement_open = (runtime: FightRuntime): boolean => runtime.contract.round === 0n && !runtime.contract.ended
const assert_actor = (runtime: FightRuntime, fighter: bigint): boolean => {
  if (runtime.contract.round < 1n || runtime.contract.ended) return false
  const actor = runtime.contract.queue[Number(runtime.contract.turn_ptr)]
  return (
    actor === fighter &&
    is_player(runtime.contract.fighters[Number(fighter)]) &&
    !runtime.contract.fighters[Number(fighter)].dead
  )
}

const free_start_cell = (runtime: FightRuntime, team: bigint): bigint | null => {
  const cells = team === 0n ? runtime.contract.board.start_cells_a : runtime.contract.board.start_cells_b
  return (
    cells.find((cell) => !runtime.contract.fighters.some((fighter) => !fighter.settled && fighter.cell === cell)) ??
    null
  )
}

const join = (runtime: FightRuntime, action: JoinAction): FightRuntime => {
  if (!placement_open(runtime)) return fail(runtime, 'not_placement')
  if (![0n, 1n].includes(action.team)) return fail(runtime, 'bad_team')
  if (runtime.contract.fighters.some((fighter) => fighter.team === action.team && is_mob(fighter)))
    return fail(runtime, 'mob_side')
  if (runtime.contract.fighters.some((fighter) => is_player(fighter) && fighter.kind.character === action.character))
    return fail(runtime, 'already_seated')
  const cell = free_start_cell(runtime, action.team)
  if (cell === null) return fail(runtime, 'team_full')
  const player_count = runtime.contract.fighters.filter(
    (fighter) => fighter.team === action.team && is_player(fighter) && !fighter.settled
  ).length
  if (player_count === 0) {
    if (action.access === undefined || ![0n, 1n].includes(action.access)) return fail(runtime, 'bad_access')
    if (action.team === 0n) {
      runtime.contract.access_a = action.access
      runtime.contract.opener_a = action.character
    } else {
      runtime.contract.access_b = action.access
      runtime.contract.opener_b = action.character
    }
  } else {
    const access = action.team === 0n ? runtime.contract.access_a : runtime.contract.access_b
    if (access === 1n) {
      const opener = action.team === 0n ? runtime.contract.opener_a : runtime.contract.opener_b
      if (!opener || !action.party_members?.includes(opener) || !action.party_members.includes(action.character))
        return fail(runtime, 'group_only')
    }
  }
  runtime.sources = {
    ...runtime.sources,
    players: { ...runtime.sources.players, [action.character]: action.source },
  }
  runtime.contract.fighters.push({
    team: action.team,
    kind: { type: 'player', character: action.character, owner: action.owner },
    cell,
    ready: false,
    dead: false,
    settled: false,
    forfeited: false,
    hp: action.hp,
    ap: 0n,
    mp: 0n,
    drops: [],
    effects: [],
    cooldowns: [],
  })
  emit(runtime, 'fighter_joined', {
    fighter: BigInt(runtime.contract.fighters.length - 1),
    team: action.team,
    cell,
  })
  return runtime
}

const place = (runtime: FightRuntime, action: PlaceAction): FightRuntime => {
  if (!placement_open(runtime)) return fail(runtime, 'not_placement')
  const fighter = runtime.contract.fighters[Number(action.fighter)]
  if (!fighter || !is_player(fighter)) return fail(runtime, 'not_your_fighter')
  const starts = fighter.team === 0n ? runtime.contract.board.start_cells_a : runtime.contract.board.start_cells_b
  if (!starts.includes(action.cell)) return fail(runtime, 'bad_cell')
  if (
    runtime.contract.fighters.some(
      (candidate, index) => BigInt(index) !== action.fighter && candidate.cell === action.cell
    )
  )
    return fail(runtime, 'bad_cell')
  const from = fighter.cell
  fighter.cell = action.cell
  emit(runtime, 'fighter_placed', { fighter: action.fighter, from, to: action.cell })
  return runtime
}

const ready = (runtime: FightRuntime, action: ReadyAction): FightRuntime => {
  if (!placement_open(runtime)) return fail(runtime, 'not_placement')
  const fighter = runtime.contract.fighters[Number(action.fighter)]
  if (!fighter || !is_player(fighter) || fighter.dead) return fail(runtime, 'not_your_fighter')
  if (!fighter.ready) {
    fighter.ready = true
    emit(runtime, 'fighter_ready', { fighter: action.fighter })
  }
  return runtime
}

const all_players_ready = (runtime: FightRuntime): boolean =>
  runtime.contract.fighters.every((fighter) => !is_player(fighter) || fighter.dead || fighter.ready)

const start = (runtime: FightRuntime, options: CommandOptions): FightRuntime => {
  if (!placement_open(runtime)) return fail(runtime, 'not_placement')
  const now = options.observed_ms!
  if (!all_players_ready(runtime) && now < runtime.contract.placement_ms + CONTRACT_CONSTANTS.placement_force_ms)
    return fail(runtime, 'not_ready')
  if (living_count(runtime.contract.fighters, 0n) < 1n || living_count(runtime.contract.fighters, 1n) < 1n)
    return fail(runtime, 'empty_side')
  runtime.contract.queue = weave(runtime.contract)
  runtime.contract.round = 1n
  emit(runtime, 'fight_started', { queue: runtime.contract.queue, round: 1n })
  let pointer = 0n
  while (runtime.contract.fighters[Number(runtime.contract.queue[Number(pointer)])].dead) pointer += 1n
  runtime.contract.turn_ptr = pointer
  return run_until_player({
    runtime,
    seed_for: options.seed_for!,
    on_mob_turn: options.on_mob_turn,
    now,
    opening: true,
    reason: 'fight_start',
  })
}

const cast = (runtime: FightRuntime, action: CastAction): FightRuntime => {
  if (!assert_actor(runtime, action.fighter)) return fail(runtime, 'not_your_fighter')
  const fighter = runtime.contract.fighters[Number(action.fighter)] as PlayerFighter
  const source = runtime.sources.players[fighter.kind.character]
  const spell = runtime.sources.spells[action.spell]
  if (!spell || source.classe !== spell.classe || source.level < spell.unlock_level)
    return fail(runtime, 'not_your_spell')
  const invested = source.spell_levels[action.spell] ?? 1n
  const level = spell.levels[Number(invested - 1n)]
  if (!level) return fail(runtime, 'not_your_spell')
  return resolve_spell({
    runtime,
    caster: action.fighter,
    level,
    name: action.spell,
    target_cell: action.target_cell,
    cast_level: invested,
  })
}

const strike = (runtime: FightRuntime, action: StrikeAction): FightRuntime => {
  if (!assert_actor(runtime, action.fighter)) return fail(runtime, 'not_your_fighter')
  const fighter = runtime.contract.fighters[Number(action.fighter)] as PlayerFighter
  const source = runtime.sources.players[fighter.kind.character]
  return resolve_spell({
    runtime,
    caster: action.fighter,
    level: strike_of(source.classe, source.weapon),
    name: 'strike',
    target_cell: action.target_cell,
    cast_level: 0n,
    weapon: true,
  })
}

const move = (runtime: FightRuntime, action: MoveAction): FightRuntime => {
  const actor = runtime.contract.queue[Number(runtime.contract.turn_ptr)]
  if (actor !== action.fighter || !assert_actor(runtime, action.fighter)) return fail(runtime, 'not_your_fighter')
  return walk_path(runtime, actor, action.path, (next_runtime, fighter, from) =>
    on_enter(next_runtime, fighter, from, resolve_rows)
  )
}

const boundary = (runtime: FightRuntime, action: BoundaryAction, options: CommandOptions): FightRuntime => {
  if (runtime.contract.round < 1n || runtime.contract.ended) return fail(runtime, 'not_active')
  const actor = runtime.contract.queue[Number(runtime.contract.turn_ptr)]
  if (action.type === 'end_turn') {
    if (actor !== action.fighter || !assert_actor(runtime, action.fighter)) return fail(runtime, 'not_your_fighter')
    if (options.observed_ms! < runtime.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms)
      return fail(runtime, 'too_soon')
    tick_cooldowns(runtime, actor)
  } else if (!runtime.contract.fighters[Number(actor)].dead) {
    if (options.observed_ms! < runtime.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms)
      return fail(runtime, 'too_soon')
    tick_cooldowns(runtime, actor)
  }
  return run_until_player({
    runtime,
    seed_for: options.seed_for!,
    on_mob_turn: options.on_mob_turn,
    now: options.observed_ms!,
    opening: false,
    reason: action.type,
  })
}

const forfeit = (runtime: FightRuntime, action: ForfeitAction): FightRuntime => {
  if (runtime.contract.ended) return fail(runtime, 'already_ended')
  const fighter = runtime.contract.fighters[Number(action.fighter)]
  if (!fighter || !is_player(fighter) || fighter.settled) return fail(runtime, 'already_settled')
  const persistent_hp = runtime.contract.fighters.some(is_mob) ? 1n : null
  drop_owned_zones(runtime, action.fighter, 'owner_left')
  fighter.settled = true
  fighter.forfeited = true
  emit(runtime, 'fighter_forfeited', { fighter: action.fighter, team: fighter.team })
  kill_fighter(runtime, action.fighter, action.fighter, 'forfeit')
  emit(runtime, 'fighter_settled', {
    fighter: action.fighter,
    won: false,
    survived: false,
    xp: 0n,
    persistent_hp,
  })
  return runtime
}

export const apply_command = (
  runtime: FightRuntime,
  action: FightCommand,
  options: CommandOptions = {}
): FightRuntime => {
  if (action.type === 'join') return join(runtime, action)
  if (action.type === 'place') return place(runtime, action)
  if (action.type === 'ready') return ready(runtime, action)
  if (action.type === 'start') return start(runtime, options)
  if (action.type === 'move_to') return move(runtime, action)
  if (action.type === 'cast_spell') return cast(runtime, action)
  if (action.type === 'weapon_strike') return strike(runtime, action)
  if (action.type === 'end_turn' || action.type === 'crank') return boundary(runtime, action, options)
  if (action.type === 'forfeit') return forfeit(runtime, action)
  return fail(runtime, 'unknown_command', { type: (action as { type: string }).type })
}
