// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  CARDINAL_DIRECTIONS,
  step_cell,
  fight_path_to,
  preview_spell_cast,
  preview_weapon_strike,
  type FightInput,
  type HydratedFightCheckpoint,
  type SpellCastPreview,
} from '@aresrpg/fight'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'

import { simple_spell } from './roster.ts'

const useful_self_cast = (preview: SpellCastPreview, seat: bigint): boolean =>
  !preview.error &&
  preview.targets.some(
    (target) =>
      target.fighter === seat &&
      (target.hp_after > target.hp_before || target.effects.length > 0 || target.ap_delta > 0n || target.mp_delta > 0n)
  )

const harms_enemy = (preview: SpellCastPreview, seat: bigint): boolean =>
  !preview.error && preview.targets.some((target) => target.fighter !== seat && target.hp_after < target.hp_before)

const rush = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint, enemy_cell: bigint): FightInput | null => {
  const fighter = checkpoint.contract.fighters[Number(seat)]!
  if (fighter.mp <= 0n || CARDINAL_DIRECTIONS.some((direction) => step_cell(enemy_cell, direction) === fighter.cell))
    return null
  // Plan to an adjacent cell across the whole board, then walk only this turn's legal prefix.
  const planning = {
    ...checkpoint,
    contract: {
      ...checkpoint.contract,
      fighters: checkpoint.contract.fighters.map((row, index) =>
        index === Number(seat) ? { ...row, mp: CONTRACT_CONSTANTS.grid_cells } : row
      ),
    },
  }
  const paths = CARDINAL_DIRECTIONS.map((direction) => step_cell(enemy_cell, direction))
    .filter((cell): cell is bigint => cell !== null)
    .map((cell) => fight_path_to(planning, seat, cell))
    .filter((path): path is readonly bigint[] => path !== null)
    .sort((a, b) => a.length - b.length)
  const path = paths[0]?.slice(0, Number(fighter.mp))
  return path?.length ? { type: 'move_to', fighter: seat, path } : null
}

/** A bounded policy emits ordinary player commands; the combat runtime retains every rule. */
export const practice_bot_input = (checkpoint: Readonly<HydratedFightCheckpoint>): FightInput | null => {
  const { contract, sources } = checkpoint
  const seat = contract.queue[Number(contract.turn_ptr)]
  const fighter = contract.fighters[Number(seat)]
  if (contract.ended || fighter?.kind.type !== 'player' || fighter.kind.owner !== 'practice_bot') return null
  const source = sources.players[fighter.kind.character]!
  const enemy = contract.fighters.find((row) => !row.dead && row.team !== fighter.team)
  const end: FightInput = {
    type: 'end_turn',
    fighter: seat!,
    observed_ms: contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms,
  }
  if (!enemy || fighter.dead || contract.turn_casts.length >= 12) return end
  const spells = Object.entries(sources.spells).filter(
    ([name, spell]) =>
      name in source.spell_levels &&
      spell.classe === source.classe &&
      spell.unlock_level <= source.level &&
      simple_spell(spell)
  )
  const self = spells.find(
    ([name]) =>
      !contract.turn_casts.some((cast) => cast.target === seat) &&
      useful_self_cast(preview_spell_cast(checkpoint, seat!, name, fighter.cell), seat!)
  )
  if (self) return { type: 'cast_spell', fighter: seat!, spell: self[0], target_cell: fighter.cell }
  const attack = spells.find(([name]) => harms_enemy(preview_spell_cast(checkpoint, seat!, name, enemy.cell), seat!))
  if (attack) return { type: 'cast_spell', fighter: seat!, spell: attack[0], target_cell: enemy.cell }
  if (harms_enemy(preview_weapon_strike(checkpoint, seat!, enemy.cell), seat!))
    return { type: 'weapon_strike', fighter: seat!, target_cell: enemy.cell }
  return rush(checkpoint, seat!, enemy.cell) ?? end
}
