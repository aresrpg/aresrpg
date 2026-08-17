// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared spell selection for casting, range projection, deterministic previews, and HUD hints.

import { crit_at, crit_denominator, spell_crit_roll } from './fight_math.ts'
import { sheet_of } from './fighters.ts'
import type { HydratedFightCheckpoint, SpellEffect, SpellLevel } from './types.ts'

export type FightReadState = Readonly<Pick<HydratedFightCheckpoint, 'contract' | 'sources'>>

export const spell_level_of = (runtime: FightReadState, caster: bigint, name: string): SpellLevel | null => {
  const fighter = runtime.contract.fighters[Number(caster)]
  if (!fighter || fighter.kind.type !== 'player') return null
  const player = runtime.sources.players[fighter.kind.character]
  const spell = runtime.sources.spells[name]
  const invested = player?.spell_levels[name] ?? 1n
  const level = spell?.levels[Number(invested - 1n)]
  return player && spell && player.classe === spell.classe && player.level >= spell.unlock_level && level ? level : null
}

export const spell_turn_rows = (
  runtime: FightReadState,
  caster: bigint,
  name: string,
  level: Readonly<SpellLevel>
): Readonly<{ critical: boolean; crit_1_in: bigint; rows: readonly SpellEffect[] }> => {
  const sheet = sheet_of(runtime, caster)
  const crit_1_in = crit_denominator(level.crit_1_in, sheet.critical, sheet.agility)
  const critical = crit_at(
    spell_crit_roll(runtime.contract.turn_seed, name),
    level.crit_1_in,
    sheet.critical,
    sheet.agility
  )
  const rows = critical && level.crit_effects.length > 0 ? level.crit_effects : level.effects
  return Object.freeze({ critical, crit_1_in, rows: Object.freeze([...rows]) })
}
