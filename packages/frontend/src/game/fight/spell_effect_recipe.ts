// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Preserve the author's preset; bind actual spell-level geometry and costs at the game boundary.
import {
  spell_effect_area_cells,
  type FightEvent,
  type HydratedFightCheckpoint,
  type SpellEffect,
  type SpellLevel,
} from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import type { SpellEffectRecipe } from '@aresrpg/engine/data'
import { create_authored_spell_source as create_source, type ClaudeSpell } from '@aresrpg/engine/data'
import { spell_effect_atlases } from '../../content/spell_effect_assets.ts'

type CastEvent = Extract<FightEvent, { type: 'spell_cast' }>
const STATS = new Map<bigint, string>(Object.entries(CHANNELS).map(([name, value]) => [value, name]))

export const cast_spell_level = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<CastEvent>
): SpellLevel | undefined => {
  const fighter = checkpoint.contract.fighters[Number(event.payload.caster)]
  if (!fighter) return undefined
  if (fighter.kind.type === 'mob')
    return fighter.kind.snapshot.kit.find(({ name }) => name === event.payload.spell)?.level
  const invested = checkpoint.sources.players[fighter.kind.character]?.spell_levels[event.payload.spell] ?? 1n
  return checkpoint.sources.spells[event.payload.spell]?.levels[Number(invested - 1n)]
}
export const cast_effect_rows = (level: Readonly<SpellLevel> | undefined, critical: boolean): readonly SpellEffect[] =>
  level ? (critical && level.crit_effects.length > 0 ? level.crit_effects : level.effects) : []
export const spell_effect_element = (rows: readonly SpellEffect[]): string =>
  rows.find((row) => row.element)?.element || 'neutral'
export const spell_impact_area = (row: Readonly<SpellEffect>, cells: readonly bigint[], element: string) =>
  Object.freeze({
    kind: String(row.kind),
    element: row.element || element,
    stat: STATS.get(row.stat) ?? 'any',
    value: Number(row.value),
    cells: cells.map(Number),
  })

export const authored_spell_preset = (
  classe: string,
  name: string,
  overrides: Readonly<Partial<ClaudeSpell>> = {}
): ClaudeSpell | null => {
  const source = create_source()
  if (!source.catalog[classe]?.some((row) => row.name === name)) return null
  return source.select(classe, name, overrides)
}

export const resolve_spell_effect = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<CastEvent>
): SpellEffectRecipe | null => {
  const fighter = checkpoint.contract.fighters[Number(event.payload.caster)]
  if (fighter?.kind.type !== 'player' || event.payload.weapon) return null
  const spell = checkpoint.sources.spells[event.payload.spell],
    level = cast_spell_level(checkpoint, event)
  if (!spell || !level) return null
  const rows = cast_effect_rows(level, event.payload.critical)
  const preset = authored_spell_preset(spell.classe, event.payload.spell, { ap: Number(event.payload.ap_cost) })
  if (!preset) return null
  const element = spell_effect_element(rows)
  // Combat owns which real cells receive the effect. The author's shader owns their appearance.
  const marker = rows.find((row) => row.kind === EFFECT_KINDS.trap)
  const areas = rows
    .filter((row) => row.kind !== EFFECT_KINDS.trap && row.kind !== EFFECT_KINDS.glyph)
    .map((row) =>
      spell_impact_area(
        row,
        spell_effect_area_cells(
          checkpoint,
          event.payload.caster,
          event.payload.target_cell,
          marker ? { ...row, area_shape: marker.area_shape, area_size: marker.area_size } : row
        ),
        element
      )
    )
  return { preset, areas, atlas_urls: spell_effect_atlases(), triggered: false }
}

export const advance_effect_geometry = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<FightEvent>
): HydratedFightCheckpoint => {
  if (event.type !== 'fighter_moved' && event.type !== 'fighter_placed') return checkpoint
  return {
    ...checkpoint,
    contract: {
      ...checkpoint.contract,
      fighters: checkpoint.contract.fighters.map((fighter, seat) =>
        BigInt(seat) === event.payload.fighter ? { ...fighter, cell: event.payload.to } : fighter
      ),
    },
  }
}
