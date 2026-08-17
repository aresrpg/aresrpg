// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure fight-event -> engine-cue projection. This is the only game-side presentation mapping;
// it reads canonical results and never re-resolves combat.
/* eslint-disable functional/immutable-data -- The reducer mutates only its fresh local cue accumulator, then freezes it. */

import { player_max_hp, type FightEvent, type HydratedFightCheckpoint, type SpellEffect } from '@aresrpg/fight'
import type { FightPresentationCue } from '@aresrpg/engine'

type CastEvent = Extract<FightEvent, Readonly<{ type: 'spell_cast' }>>

const entity_id = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint): string =>
  checkpoint.contract.fighters[Number(seat)]?.kind.type === 'mob' ? `fight_mob_${seat}` : `fight_character_${seat}`

const max_hp = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint): bigint | null => {
  const fighter = checkpoint.contract.fighters[Number(seat)]
  if (!fighter) return null
  return fighter.kind.type === 'mob'
    ? fighter.kind.snapshot.max_hp
    : player_max_hp(checkpoint.sources.players[fighter.kind.character])
}

const cast_rows = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<CastEvent>
): readonly SpellEffect[] => {
  const fighter = checkpoint.contract.fighters[Number(event.payload.caster)]
  if (!fighter) return Object.freeze([])
  if (fighter.kind.type === 'mob') {
    const level = fighter.kind.snapshot.kit.find(({ name }) => name === event.payload.spell)?.level
    if (!level) return Object.freeze([])
    return event.payload.critical && level.crit_effects.length > 0 ? level.crit_effects : level.effects
  }
  const source = checkpoint.sources.players[fighter.kind.character]
  const spell = checkpoint.sources.spells[event.payload.spell]
  const invested = source?.spell_levels[event.payload.spell] ?? 1n
  const level = spell?.levels[Number(invested - 1n)]
  if (!level) return Object.freeze([])
  return event.payload.critical && level.crit_effects.length > 0 ? level.crit_effects : level.effects
}

const authored_element = (checkpoint: Readonly<HydratedFightCheckpoint>, event: Readonly<CastEvent>): string =>
  cast_rows(checkpoint, event).find(({ element }) => element.length > 0)?.element ?? 'neutral'

const cast_segment = (events: readonly FightEvent[], index: number): readonly FightEvent[] => {
  const tail = events.slice(index + 1)
  const boundary = tail.findIndex(({ type }) => type === 'spell_cast' || type === 'turn_switched')
  return Object.freeze(boundary < 0 ? tail : tail.slice(0, boundary))
}

const affected_seats = (events: readonly FightEvent[]): readonly bigint[] =>
  Object.freeze([
    ...new Set(
      events.flatMap((event) => {
        if (event.type === 'damage_number' || event.type === 'damage_reduced' || event.type === 'heal_number')
          return [event.payload.target]
        return []
      })
    ),
  ])

const cue_id = (fight: string, batch: number, index: number): string => `${fight}:${batch}:${index}`

export const project_fight_cues = ({
  checkpoint,
  events,
  batch,
}: Readonly<{
  checkpoint: HydratedFightCheckpoint
  events: readonly FightEvent[]
  batch: number
}>): readonly FightPresentationCue[] => {
  const cues: FightPresentationCue[] = []
  let cast_critical = false
  events.forEach((event, index) => {
    const id = cue_id(checkpoint.contract.id, batch, index)
    if (event.type === 'spell_cast') {
      cast_critical = event.payload.critical
      const segment = cast_segment(events, index)
      const damage = segment.flatMap((row) => (row.type === 'damage_number' ? [row.payload] : []))
      const heals = segment.flatMap((row) => (row.type === 'heal_number' ? [row.payload] : []))
      const targets = affected_seats(segment)
      const primary = damage.reduce<(typeof damage)[number] | null>(
        (found, row) => (!found || row.amount > found.amount ? row : found),
        null
      )
      const element = event.payload.weapon
        ? 'weapon'
        : (damage.find(({ element: value }) => value.length > 0)?.element ??
          (heals.length > 0 ? 'heal' : authored_element(checkpoint, event)))
      cues.push(
        Object.freeze({
          id,
          type: 'cast',
          caster_id: entity_id(checkpoint, event.payload.caster),
          spell: event.payload.spell,
          cast_level: Number(event.payload.cast_level),
          target_cell: Number(event.payload.target_cell),
          element,
          critical: event.payload.critical,
          weapon: event.payload.weapon,
          amount: Number([...damage, ...heals].reduce((total, row) => total + row.amount, 0n)),
          target_max_hp: primary ? Number(max_hp(checkpoint, primary.target)) : null,
          affected_cells: Object.freeze(
            targets.flatMap((seat) => {
              const fighter = checkpoint.contract.fighters[Number(seat)]
              return fighter ? [Number(fighter.cell)] : []
            })
          ),
          killed: damage.some(({ hp_after }) => hp_after === 0n),
        })
      )
      return
    }
    if (event.type === 'fighter_placed') {
      cues.push(
        Object.freeze({
          id,
          type: 'movement',
          entity_id: entity_id(checkpoint, event.payload.fighter),
          cells: Object.freeze([Number(event.payload.to)]),
          mode: 'place',
          source_id: entity_id(checkpoint, event.payload.fighter),
        })
      )
      return
    }
    if (event.type === 'fighter_moved') {
      const projected = Object.freeze({
        id,
        type: 'movement' as const,
        entity_id: entity_id(checkpoint, event.payload.fighter),
        cells: Object.freeze([Number(event.payload.to)]),
        mode: event.payload.mode,
        source_id: entity_id(checkpoint, event.payload.source),
      })
      const previous = cues.at(-1)
      if (
        previous?.type === 'movement' &&
        previous.entity_id === projected.entity_id &&
        previous.mode === projected.mode &&
        previous.source_id === projected.source_id
      )
        cues[cues.length - 1] = Object.freeze({
          ...previous,
          cells: Object.freeze([...previous.cells, ...projected.cells]),
        })
      else cues.push(projected)
      return
    }
    if (event.type === 'damage_number') {
      cues.push(
        Object.freeze({
          id,
          type: 'damage',
          source_id: entity_id(checkpoint, event.payload.source),
          target_id: entity_id(checkpoint, event.payload.target),
          amount: Number(event.payload.amount),
          hp_before: Number(event.payload.hp_before),
          hp_after: Number(event.payload.hp_after),
          element: event.payload.element || 'neutral',
          cause: event.payload.cause,
          critical: cast_critical,
        })
      )
      return
    }
    if (event.type === 'damage_reduced') {
      cues.push(
        Object.freeze({
          id,
          type: 'absorb',
          source_id: entity_id(checkpoint, event.payload.source),
          target_id: entity_id(checkpoint, event.payload.target),
          prevented: Number(event.payload.prevented),
          remaining: Number(event.payload.remaining),
        })
      )
      return
    }
    if (event.type === 'heal_number') {
      cues.push(
        Object.freeze({
          id,
          type: 'heal',
          source_id: entity_id(checkpoint, event.payload.source),
          target_id: entity_id(checkpoint, event.payload.target),
          amount: Number(event.payload.amount),
          hp_before: Number(event.payload.hp_before),
          hp_after: Number(event.payload.hp_after),
          cause: event.payload.cause,
        })
      )
      return
    }
    if (event.type === 'fighter_died') {
      cues.push(
        Object.freeze({
          id,
          type: 'death',
          entity_id: entity_id(checkpoint, event.payload.fighter),
          source_id: entity_id(checkpoint, event.payload.source),
          cell: Number(event.payload.cell),
          cause: event.payload.cause,
        })
      )
      return
    }
    if (event.type === 'trap_triggered' || event.type === 'glyph_triggered') {
      cues.push(
        Object.freeze({
          id,
          type: 'zone',
          action: event.type,
          zone_id: event.payload.zone_id,
          owner_id: entity_id(checkpoint, event.payload.owner),
          target_id: entity_id(checkpoint, event.payload.fighter),
          cell: Number(event.payload.cell),
        })
      )
      return
    }
    if (event.type === 'turn_switched') {
      cast_critical = false
      cues.push(Object.freeze({ id, type: 'turn', entity_id: entity_id(checkpoint, event.payload.to) }))
    }
  })
  return Object.freeze(cues)
}
