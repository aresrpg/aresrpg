// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The deterministic next-cast projection. HUD glow, rolled rows, and hover area all read this one result.

import { zone_cells } from './combat_grid.ts'
import { roll_value } from './damage.ts'
import { legal_cell } from './effects.ts'
import { effect_seed } from './fight_math.ts'
import { KINDS, STATS } from './fighters.ts'
import { draw } from './prng.ts'
import { spell_level_of, spell_turn_rows } from './spell_turn.ts'
import type { HydratedFightCheckpoint, PrngCursor, SpellEffect } from './types.ts'

export type SpellTurnEffect = Readonly<SpellEffect & { critical_only: boolean }>

export type SpellTurnProjection = Readonly<{
  critical: boolean
  crit_1_in: bigint
  effects: readonly SpellTurnEffect[]
}>

const rolls_value = (row: Readonly<SpellEffect>): boolean =>
  [KINDS.damage, KINDS.caster_damage, KINDS.punishment].includes(row.kind) ||
  ([KINDS.add, KINDS.remove, KINDS.steal].includes(row.kind) && row.stat === STATS.hp)

export const project_spell_turn = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  caster: bigint,
  name: string
): SpellTurnProjection | null => {
  const level = spell_level_of(checkpoint, caster, name)
  if (!level) return null
  const { critical, crit_1_in, rows } = spell_turn_rows(checkpoint, caster, name, level)
  const cursor: PrngCursor = { state: effect_seed(checkpoint.contract.turn_seed, checkpoint.contract.turn_slot) }
  const effects = rows.flatMap((row, index) => {
    if (row.chance_bp < 10_000n && draw(cursor) % 10_000n >= row.chance_bp) return []
    const critical_only = critical && index >= level.effects.length
    if (!rolls_value(row)) return [Object.freeze({ ...row, critical_only })]
    const value = roll_value(row, cursor)
    return [Object.freeze({ ...row, value, value_max: value, critical_only })]
  })
  return Object.freeze({ critical, crit_1_in, effects: Object.freeze(effects) })
}

export const spell_area_cells = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  caster: bigint,
  name: string,
  target_cell: bigint
): readonly bigint[] => {
  const level = spell_level_of(checkpoint, caster, name)
  const fighter = checkpoint.contract.fighters[Number(caster)]
  if (!level || !fighter) return Object.freeze([])
  const { rows } = spell_turn_rows(checkpoint, caster, name, level)
  const cells = new Set(
    rows
      .flatMap((row) => zone_cells(row.area_shape, row.area_size, target_cell, fighter.cell))
      .filter((cell) => legal_cell(checkpoint, cell))
  )
  return Object.freeze([...cells].sort((left, right) => Number(left - right)))
}
