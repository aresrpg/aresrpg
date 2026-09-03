// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { zone_rank } from './combat_grid.ts'
import { TARGET_FILTERS } from './move_contract.gen.ts'
import type { FightReadState } from './spell_turn.ts'
import type { FightRuntime, SpellEffect } from './types.ts'

export const target_allowed = (runtime: FightReadState, caster: bigint, row: SpellEffect, target: bigint): boolean => {
  const { team } = runtime.contract.fighters[Number(caster)]
  if (row.target_filter === TARGET_FILTERS.not_team) return runtime.contract.fighters[Number(target)].team !== team
  if (row.target_filter === TARGET_FILTERS.not_self) return target !== caster
  if (row.target_filter === TARGET_FILTERS.not_enemy) return runtime.contract.fighters[Number(target)].team === team
  return row.target_filter !== TARGET_FILTERS.only_caster || target === caster
}

export const zone_targets = (
  runtime: FightRuntime,
  caster: bigint,
  row: SpellEffect,
  anchor: bigint,
  origin: bigint
): bigint[] => {
  const caster_fighter = runtime.contract.fighters[Number(caster)]
  if (!caster_fighter || caster_fighter.dead) return []
  if (row.target_filter === TARGET_FILTERS.only_caster) return [caster]
  return runtime.contract.fighters
    .flatMap((fighter, index) => {
      if (fighter.dead) return []
      const rank = zone_rank(row.area_shape, row.area_size, anchor, origin, fighter.cell)
      return rank === null ? [] : [{ rank, seat: BigInt(index) }]
    })
    .filter(({ seat }) => target_allowed(runtime, caster, row, seat))
    .sort((left, right) => Number(left.rank - right.rank || left.seat - right.seat))
    .map(({ seat }) => seat)
}
