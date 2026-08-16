// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The cursor is a reduction-local mirror of Move's &mut PRNG state. */

import { CONTRACT_CONSTANTS } from './move_contract.gen.ts'
import { apply_centered_resistance, amplify_damage, primary_stat, remove_points, roll_in_range } from './fight_math.ts'
import {
  KINDS,
  STATS,
  base_ap_of,
  base_mp_of,
  effective_stat,
  heal_seat,
  hit,
  resistance_of,
  sum_effect_rows,
} from './fighters.ts'
import { draw } from './prng.ts'
import { effect_id_at, emit } from './runtime.ts'
import type { FightRuntime, FightSheet, PrngCursor, SpellEffect } from './types.ts'

const SHIFT = BigInt(CONTRACT_CONSTANTS.item_stat_shift)

export const full_damage = (
  runtime: FightRuntime,
  sheet: FightSheet,
  target: bigint,
  element: string,
  base: bigint,
  _critical?: boolean
): bigint =>
  apply_centered_resistance(
    amplify_damage(base, primary_stat(element, sheet), sheet.raw_damage),
    resistance_of(runtime, target, element),
    SHIFT
  )

export const resist = (runtime: FightRuntime, target: bigint, element: string, damage: bigint): bigint =>
  apply_centered_resistance(damage, resistance_of(runtime, target, element), SHIFT)

const returns_at = (runtime: FightRuntime, target: bigint, cast_level: bigint): boolean =>
  cast_level > 0n &&
  cast_level < 6n &&
  runtime.contract.fighters[Number(target)].effects.some((row) => row.kind === KINDS.return && row.value >= cast_level)

const redirect_source = (runtime: FightRuntime, target: bigint): bigint | null => {
  const row = runtime.contract.fighters[Number(target)].effects.find(
    (effect) => effect.kind === KINDS.redirect && !runtime.contract.fighters[Number(effect.source)].dead
  )
  return row ? row.source : null
}

type DealInput = {
  runtime: FightRuntime
  caster: bigint
  sheet: FightSheet
  target: bigint
  element: string
  base: bigint
  cast_level: bigint
  cause: string
}

export const deal = ({ runtime, caster, sheet, target, element, base, cast_level, cause }: DealInput): bigint => {
  if (runtime.contract.ended || runtime.contract.fighters[Number(target)].dead) return 0n
  const raw_damage = full_damage(runtime, sheet, target, element, base)
  const shield = sum_effect_rows(runtime, target, KINDS.reduce, STATS.any)
  const damage = raw_damage > shield ? raw_damage - shield : 0n
  if (shield > 0n) {
    emit(runtime, 'damage_reduced', {
      source: caster,
      target,
      prevented: raw_damage - damage,
      remaining: damage,
      effect_ids: runtime.contract.fighters[Number(target)].effects
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.kind === KINDS.reduce)
        .map(({ index }) => effect_id_at(runtime, target, index)),
    })
  }
  if (damage === 0n) return 0n
  let final_target = target
  const redirect = redirect_source(runtime, target)
  if (redirect !== null) {
    final_target = redirect
    emit(runtime, 'damage_redirected', {
      source: caster,
      original_target: target,
      final_target,
      amount: damage,
    })
  } else if (caster !== target && returns_at(runtime, target, cast_level)) {
    final_target = caster
    emit(runtime, 'spell_returned', { caster, target, amount: damage, cast_level })
  }
  const hp_before = runtime.contract.fighters[Number(final_target)].hp
  const landed = hit(runtime, { target: final_target, amount: damage, source: caster, cause, element })
  if (final_target === target) {
    const reflect = sum_effect_rows(runtime, target, KINDS.reflect, STATS.any)
    if (reflect > 0n && caster !== target && !runtime.contract.ended) {
      emit(runtime, 'damage_reflected', { source: target, target: caster, amount: reflect })
      hit(runtime, { target: caster, amount: reflect, source: target, cause: 'reflect', element: '' })
    }
  }
  return final_target === target ? (damage > hp_before ? hp_before : landed) : 0n
}

export const roll_value = (row: SpellEffect, cursor: PrngCursor): bigint => {
  if (row.value_max <= row.value) return row.value
  return roll_in_range(row.value, row.value_max, draw(cursor) % 10_000n)
}

export const contest_points = (
  runtime: FightRuntime,
  sheet: FightSheet,
  target: bigint,
  row: SpellEffect,
  cursor: PrngCursor
): bigint => {
  const is_ap = row.stat === STATS.ap
  const fighter = runtime.contract.fighters[Number(target)]
  const result = remove_points({
    rng: draw(cursor),
    value: row.value,
    dodge: true,
    caster_wisdom: sheet.wisdom,
    target_wisdom: effective_stat(runtime, target, STATS.wisdom),
    current: is_ap ? fighter.ap : fighter.mp,
    maximum: is_ap ? base_ap_of(runtime, target) : base_mp_of(runtime, target),
  })
  cursor.state = result.state
  return result.removed
}

export const life_steal = ({
  runtime,
  caster,
  sheet,
  target,
  element,
  base,
  cast_level,
}: Omit<DealInput, 'cause'>): void => {
  const landed = deal({
    runtime,
    caster,
    sheet,
    target,
    element,
    base,
    cast_level,
    cause: 'life_steal',
  })
  heal_seat(runtime, { target: caster, amount: landed, source: caster, cause: 'life_steal' })
}
