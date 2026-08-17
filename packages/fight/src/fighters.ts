// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign, fp-law/no-mutating-methods -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */
// Fighter access and writes mirror fight.move's single branch and single death door.

import { CHANNELS, CONTRACT_CONSTANTS, EFFECT_KINDS } from './move_contract.gen.ts'
import { add_effect_id, effect_id_at, emit } from './runtime.ts'
import type {
  FightRuntime,
  FightSheet,
  Fighter,
  HydratedFightCheckpoint,
  MobFighter,
  MobSnapshot,
  PlayerFighter,
  PlayerSource,
} from './types.ts'

type FightReadState = Readonly<Pick<HydratedFightCheckpoint, 'contract' | 'sources'>>

const SHIFT = BigInt(CONTRACT_CONSTANTS.item_stat_shift)
const BASE_AP = BigInt(CONTRACT_CONSTANTS.base_ap)
const BASE_MP = BigInt(CONTRACT_CONSTANTS.base_mp)
const BASE_HP = BigInt(CONTRACT_CONSTANTS.base_hp)
const HP_PER_LEVEL = BigInt(CONTRACT_CONSTANTS.hp_per_level)

export const KINDS = Object.fromEntries(
  Object.entries(EFFECT_KINDS).map(([name, value]) => [name, BigInt(value)])
) as Record<keyof typeof EFFECT_KINDS, bigint>
export const STATS = Object.fromEntries(
  Object.entries(CHANNELS).map(([name, value]) => [name, BigInt(value)])
) as Record<keyof typeof CHANNELS, bigint>

export const is_mob = (fighter: Fighter): fighter is MobFighter => fighter.kind.type === 'mob'
export const is_player = (fighter: Fighter): fighter is PlayerFighter => fighter.kind.type === 'player'
export const mob_snapshot = (fighter: MobFighter): MobSnapshot => fighter.kind.snapshot

export const player_source = (runtime: FightReadState, seat: bigint): PlayerSource => {
  const fighter = runtime.contract.fighters[Number(seat)] as PlayerFighter
  return runtime.sources.players[fighter.kind.character]
}

export const saturating_subtract = (left: bigint, right: bigint): bigint => (left > right ? left - right : 0n)
export const effective = (base: bigint, folded: bigint): bigint => saturating_subtract(base + folded, SHIFT)

const sum_rows = (runtime: FightReadState, seat: bigint, kind: bigint, stat: bigint): bigint =>
  runtime.contract.fighters[Number(seat)].effects
    .filter((row) => row.kind === kind && (stat === STATS.any || row.stat === stat))
    .reduce((total, row) => total + row.value, 0n)

const row_adjusted = (runtime: FightReadState, seat: bigint, base: bigint, stat: bigint): bigint =>
  saturating_subtract(
    base + sum_rows(runtime, seat, KINDS.add, stat),
    sum_rows(runtime, seat, KINDS.remove, stat) + sum_rows(runtime, seat, KINDS.steal, stat)
  )

export const sheet_of = (runtime: FightReadState, seat: bigint): FightSheet => {
  const fighter = runtime.contract.fighters[Number(seat)]
  const base = is_mob(fighter)
    ? {
        strength: 0n,
        intelligence: 0n,
        chance: 0n,
        agility: mob_snapshot(fighter).agility,
        wisdom: mob_snapshot(fighter).wisdom,
        raw_damage: 0n,
        critical: 0n,
        range_bonus: 0n,
        level: mob_snapshot(fighter).level,
      }
    : (() => {
        const source = player_source(runtime, seat)
        const folded = source.folded_stats
        return {
          strength: effective(source.strength, folded.strength),
          intelligence: effective(source.intelligence, folded.intelligence),
          chance: effective(source.chance, folded.chance),
          agility: effective(source.agility, folded.agility),
          wisdom: effective(source.wisdom, folded.wisdom),
          raw_damage: effective(0n, folded.raw_damage),
          critical: effective(0n, folded.critical),
          range_bonus: effective(0n, folded.range),
          level: source.level,
        }
      })()
  const power = row_adjusted(runtime, seat, 0n, STATS.power)
  return {
    strength: row_adjusted(runtime, seat, base.strength, STATS.strength) + power,
    intelligence: row_adjusted(runtime, seat, base.intelligence, STATS.intelligence) + power,
    chance: row_adjusted(runtime, seat, base.chance, STATS.chance) + power,
    agility: row_adjusted(runtime, seat, base.agility, STATS.agility) + power,
    wisdom: row_adjusted(runtime, seat, base.wisdom, STATS.wisdom),
    raw_damage: row_adjusted(runtime, seat, base.raw_damage, STATS.raw_damage),
    critical: row_adjusted(runtime, seat, base.critical, STATS.critical),
    range_bonus: row_adjusted(runtime, seat, base.range_bonus, STATS.range),
    level: base.level,
  }
}

export const effective_stat = (runtime: FightRuntime, seat: bigint, stat: bigint): bigint => {
  const sheet = sheet_of(runtime, seat)
  if (stat === STATS.strength) return sheet.strength
  if (stat === STATS.intelligence) return sheet.intelligence
  if (stat === STATS.chance) return sheet.chance
  if (stat === STATS.agility) return sheet.agility
  return sheet.wisdom
}

export const max_hp_of = (runtime: FightRuntime, seat: bigint): bigint => {
  const fighter = runtime.contract.fighters[Number(seat)]
  if (is_mob(fighter)) return mob_snapshot(fighter).max_hp
  const source = player_source(runtime, seat)
  const base = BASE_HP + HP_PER_LEVEL * source.level + source.vitality
  const folded = source.folded_stats.vitality
  if (folded >= SHIFT) return base + folded - SHIFT
  const malus = SHIFT - folded
  return malus >= base ? 1n : base - malus
}

export const base_ap_of = (runtime: FightRuntime, seat: bigint): bigint => {
  const fighter = runtime.contract.fighters[Number(seat)]
  return is_mob(fighter)
    ? mob_snapshot(fighter).ap
    : effective(BASE_AP, player_source(runtime, seat).folded_stats.action)
}

export const base_mp_of = (runtime: FightReadState, seat: bigint): bigint => {
  const fighter = runtime.contract.fighters[Number(seat)]
  return is_mob(fighter)
    ? mob_snapshot(fighter).mp
    : effective(BASE_MP, player_source(runtime, seat).folded_stats.movement)
}

export const movement_points_of = (runtime: FightReadState, seat: bigint): bigint =>
  row_adjusted(runtime, seat, base_mp_of(runtime, seat), STATS.mp)

const mob_resistance = (snapshot: MobSnapshot, element: string): bigint => {
  if (element === 'earth') return snapshot.earth_res
  if (element === 'fire') return snapshot.fire_res
  if (element === 'water') return snapshot.water_res
  if (element === 'air') return snapshot.air_res
  return SHIFT
}

const player_resistance = (source: PlayerSource, element: string): bigint => {
  if (element === 'earth') return source.folded_stats.earth_resistance
  if (element === 'fire') return source.folded_stats.fire_resistance
  if (element === 'water') return source.folded_stats.water_resistance
  if (element === 'air') return source.folded_stats.air_resistance
  return SHIFT
}

export const resistance_of = (runtime: FightRuntime, seat: bigint, element: string): bigint => {
  const fighter = runtime.contract.fighters[Number(seat)]
  const base = is_mob(fighter)
    ? mob_resistance(mob_snapshot(fighter), element)
    : player_resistance(player_source(runtime, seat), element)
  const rows = fighter.effects.filter(
    (row) => row.stat === STATS.resist && (row.element.length === 0 || row.element === element)
  )
  const bonus = rows.filter((row) => row.kind === KINDS.add).reduce((total, row) => total + row.value, 0n)
  const malus = rows
    .filter((row) => row.kind === KINDS.remove || row.kind === KINDS.steal)
    .reduce((total, row) => total + row.value, 0n)
  return saturating_subtract(base + bonus, malus)
}

const pool_change = (
  runtime: FightRuntime,
  seat: bigint,
  next_ap: bigint,
  next_mp: bigint,
  reason: string,
  source: bigint
): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  const ap_before = fighter.ap
  const mp_before = fighter.mp
  fighter.ap = next_ap
  fighter.mp = next_mp
  if (ap_before !== next_ap || mp_before !== next_mp) {
    emit(runtime, 'ap_mp_change', {
      fighter: seat,
      ap_before,
      ap_after: next_ap,
      mp_before,
      mp_after: next_mp,
      reason,
      source,
    })
  }
}

export const set_pools = (
  runtime: FightRuntime,
  seat: bigint,
  ap: bigint,
  mp: bigint,
  reason: string,
  source = seat
): void => pool_change(runtime, seat, ap, mp, reason, source)

export const spend_ap = (runtime: FightRuntime, seat: bigint, amount: bigint, reason: string, source = seat): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  pool_change(runtime, seat, saturating_subtract(fighter.ap, amount), fighter.mp, reason, source)
}

export const spend_mp = (runtime: FightRuntime, seat: bigint, amount: bigint, reason: string, source = seat): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  pool_change(runtime, seat, fighter.ap, saturating_subtract(fighter.mp, amount), reason, source)
}

export const add_ap = (runtime: FightRuntime, seat: bigint, amount: bigint, reason: string, source = seat): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  pool_change(runtime, seat, fighter.ap + amount, fighter.mp, reason, source)
}

export const add_mp = (runtime: FightRuntime, seat: bigint, amount: bigint, reason: string, source = seat): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  pool_change(runtime, seat, fighter.ap, fighter.mp + amount, reason, source)
}

const living_count = (runtime: FightRuntime, team: bigint): bigint =>
  BigInt(runtime.contract.fighters.filter((fighter) => fighter.team === team && !fighter.dead).length)

export const kill_fighter = (runtime: FightRuntime, seat: bigint, source: bigint, cause: string): void => {
  const fighter = runtime.contract.fighters[Number(seat)]
  const was_dead = fighter.dead
  fighter.dead = true
  fighter.hp = 0n
  if (!was_dead) emit(runtime, 'fighter_died', { fighter: seat, source, cause, cell: fighter.cell })
  if (!runtime.contract.ended && living_count(runtime, fighter.team) === 0n) {
    runtime.contract.ended = true
    const team_a = living_count(runtime, 0n) > 0n
    const team_b = living_count(runtime, 1n) > 0n
    runtime.contract.winner = team_a ? 0n : team_b ? 1n : null
    emit(runtime, 'fight_ended', { winner: runtime.contract.winner })
  }
}

export const hit = (
  runtime: FightRuntime,
  {
    target,
    amount,
    source,
    cause,
    element = '',
  }: { target: bigint; amount: bigint; source: bigint; cause: string; element?: string }
): bigint => {
  const fighter = runtime.contract.fighters[Number(target)]
  if (fighter.dead || runtime.contract.ended || amount === 0n) return 0n
  const hp_before = fighter.hp
  const landed = amount > hp_before ? hp_before : amount
  fighter.hp = hp_before - landed
  emit(runtime, 'damage_number', {
    source,
    target,
    amount: landed,
    hp_before,
    hp_after: fighter.hp,
    element,
    cause,
  })
  if (amount >= hp_before) {
    kill_fighter(runtime, target, source, cause)
    return landed
  }
  const stances = fighter.effects.filter((row) => row.kind === KINDS.reaction)
  stances.forEach((row) => {
    const effect = {
      kind: KINDS.add,
      element: row.element,
      value: row.value,
      turns_left: row.turns_left,
      source: row.source,
      stat: row.stat,
    }
    fighter.effects.push(effect)
    const effect_id = add_effect_id(runtime, target)
    emit(runtime, 'reaction_triggered', {
      fighter: target,
      stance_effect_id: effect_id_at(runtime, target, fighter.effects.indexOf(row)),
      added_effect_id: effect_id,
      channel: row.stat,
      value: row.value,
      turns: row.turns_left,
    })
    emit(runtime, 'effect_applied', {
      target,
      effect_id,
      kind: effect.kind,
      channel: effect.stat,
      element: effect.element,
      value: effect.value,
      turns: effect.turns_left,
      source: effect.source,
    })
  })
  return landed
}

export const heal_seat = (
  runtime: FightRuntime,
  { target, amount, source, cause }: { target: bigint; amount: bigint; source: bigint; cause: string }
): bigint => {
  const fighter = runtime.contract.fighters[Number(target)]
  if (fighter.dead) return 0n
  const hp_before = fighter.hp
  const maximum = max_hp_of(runtime, target)
  const hp_after = hp_before + amount > maximum ? maximum : hp_before + amount
  fighter.hp = hp_after
  const healed = hp_after - hp_before
  if (healed > 0n) emit(runtime, 'heal_number', { source, target, amount: healed, hp_before, hp_after, cause })
  return healed
}

export const has_row = (runtime: FightRuntime, seat: bigint, kind: bigint): boolean =>
  runtime.contract.fighters[Number(seat)].effects.some((row) => row.kind === kind)

export const sum_effect_rows = sum_rows
