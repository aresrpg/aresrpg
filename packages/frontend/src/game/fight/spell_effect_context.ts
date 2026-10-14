// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Event-local geometry and zone identity preserve the state at the cast, not the batch's final positions.

import {
  spell_effect_area_cells,
  split_placements,
  type BoardZone,
  type FightEvent,
  type HydratedFightCheckpoint,
  type SpellEffect,
} from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import type { SpellEffectRecipe } from '@aresrpg/engine/data'

import {
  advance_effect_geometry,
  authored_spell_preset,
  cast_effect_rows,
  cast_spell_level,
  spell_impact_area,
} from './spell_effect_recipe.ts'
import { spell_effect_atlases } from '../../content/spell_effect_assets.ts'

type Context = Readonly<{
  checkpoint: HydratedFightCheckpoint
  zones: ReadonlyMap<string, Readonly<BoardZone & { spell?: string }>>
  spell?: string
  rows: readonly SpellEffect[]
}>

export const create_spell_effect_context = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  ids: readonly string[]
): Context => ({
  checkpoint,
  rows: [],
  zones: new Map(checkpoint.contract.zones.map((zone, index) => [ids[index] ?? `initial:zone:${index}`, zone])),
})

export const advance_spell_effect_context = (context: Context, event: Readonly<FightEvent>): Context => {
  switch (event.type) {
    case 'spell_cast':
      return {
        ...context,
        spell: event.payload.spell,
        rows: cast_effect_rows(cast_spell_level(context.checkpoint, event), event.payload.critical),
      }
    case 'fighter_moved':
    case 'fighter_placed':
      return { ...context, checkpoint: advance_effect_geometry(context.checkpoint, event) }
    case 'trap_placed':
    case 'glyph_placed': {
      const zone: BoardZone & { spell?: string } = {
        spell: context.spell,
        owner_fighter: event.payload.owner,
        trap: event.type === 'trap_placed',
        shape: event.payload.shape,
        size: event.payload.size,
        anchor: event.payload.anchor,
        turns_left: event.type === 'glyph_placed' ? event.payload.turns : 0n,
        effects: split_placements(context.rows).payload,
      }
      return { ...context, zones: new Map([...context.zones, [event.payload.zone_id, zone]]) }
    }
    // Keep removed zones until the batch ends: a trigger can follow its removal event.
    default:
      return context
  }
}

const effect_key = (rows: readonly SpellEffect[]): string =>
  JSON.stringify(
    rows.map((row) =>
      Object.entries(row)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, String(value)])
    )
  )
const matches_zone = (zone: Readonly<BoardZone>, rows: readonly SpellEffect[]): boolean => {
  const split = split_placements(rows)
  return (
    split.placements.some(
      (row) =>
        row.kind === (zone.trap ? EFFECT_KINDS.trap : EFFECT_KINDS.glyph) &&
        row.area_shape === zone.shape &&
        row.area_size === zone.size
    ) && effect_key(split.payload) === effect_key(zone.effects)
  )
}

export const resolve_zone_effect = (
  context: Context,
  event: Readonly<Extract<FightEvent, { type: 'trap_triggered' | 'glyph_triggered' }>>,
  element: string
): SpellEffectRecipe | null => {
  const fighter = context.checkpoint.contract.fighters[Number(event.payload.owner)]
  if (fighter?.kind.type !== 'player') return null
  const classe = context.checkpoint.sources.players[fighter.kind.character]?.classe
  const zone = context.zones.get(event.payload.zone_id)
  if (!zone) return null
  const areas = zone.effects.map((row) => {
    const area = zone.trap ? { ...row, area_shape: zone.shape, area_size: zone.size } : row
    const cells = spell_effect_area_cells(
      context.checkpoint,
      event.payload.owner,
      zone.trap ? zone.anchor : event.payload.cell,
      area
    )
    return spell_impact_area(row, cells, element)
  })
  const candidates = Object.entries(context.checkpoint.sources.spells).filter(
    ([, spell]) =>
      spell.classe === classe &&
      spell.levels.some((level) => matches_zone(zone, level.effects) || matches_zone(zone, level.crit_effects))
  )
  const name = zone.spell ?? (candidates.length === 1 ? candidates[0]![0] : null)
  const preset = name ? authored_spell_preset(classe!, name) : null
  return preset
    ? {
        preset,
        areas,
        atlas_urls: spell_effect_atlases(),
        triggered: true,
        zone_anchor: Number(zone.trap ? zone.anchor : event.payload.cell),
      }
    : null
}
