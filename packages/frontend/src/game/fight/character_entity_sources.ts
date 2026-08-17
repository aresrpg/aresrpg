// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EntityVisualEffect, FightSide } from '@aresrpg/engine'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import type { CharacterRenderSource } from '../character_entities.ts'

export type FightCharacterRenderSource = CharacterRenderSource &
  Readonly<{
    cell: number
    side: FightSide
    visual_effect?: EntityVisualEffect
  }>

export type FightCharacterAppearance = CharacterRenderSource

export const character_entity_sources = (
  characters: readonly FightCharacterAppearance[],
  placements: Readonly<Record<number, string>>,
  side: FightSide
): readonly FightCharacterRenderSource[] => {
  const by_id = new Map(characters.map((character) => [character.id, character]))
  return Object.freeze(
    Object.entries(placements).flatMap(([cell, character_id]) => {
      const character = by_id.get(character_id)
      return character ? [Object.freeze({ ...character, cell: Number(cell), side })] : []
    })
  )
}

const DEFAULT_COLORS = Object.freeze(['#ffffff', '#d9af57', '#8b6539'] as const)

export const fight_character_entity_sources = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  appearances: readonly FightCharacterAppearance[],
  viewer_team: bigint | null = null
): readonly FightCharacterRenderSource[] => {
  const by_id = new Map(appearances.map((appearance) => [appearance.id, appearance]))
  return Object.freeze(
    checkpoint.contract.fighters.flatMap((fighter, seat) => {
      if (fighter.kind.type !== 'player') return []
      const known = by_id.get(fighter.kind.character)
      const source = checkpoint.sources.players[fighter.kind.character]
      const appearance =
        known ??
        Object.freeze({
          id: fighter.kind.character,
          classe: source?.classe ?? 'senshi',
          male: true,
          colors: DEFAULT_COLORS,
          loadout: Object.freeze({}),
        })
      return [
        Object.freeze({
          ...appearance,
          cell: Number(fighter.cell),
          side: fighter.team === 0n ? ('a' as const) : ('b' as const),
          id: `fight_character_${seat}`,
          ...(viewer_team === fighter.team && fighter.effects.some(({ kind }) => kind === EFFECT_KINDS.invis)
            ? { visual_effect: Object.freeze({ kind: 'invisibility' as const }) }
            : {}),
        }),
      ]
    })
  )
}
