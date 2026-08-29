// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EntityVisualEffect, FightSide } from '@aresrpg/engine'
import type { HydratedFightCheckpoint, PlayerSource } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import { character_color_hex, type CharacterRenderSource } from '../character_entities.ts'

export type FightCharacterRenderSource = CharacterRenderSource &
  Readonly<{
    cell: number
    side: FightSide
    visual_effect?: EntityVisualEffect
  }>

export type FightCharacterAppearance = CharacterRenderSource

type CheckpointAppearance = Readonly<
  Pick<PlayerSource, 'classe' | 'sex' | 'color_1' | 'color_2' | 'color_3' | 'hat' | 'cloak'>
>
const DEFAULT_APPEARANCE: CheckpointAppearance = Object.freeze({
  classe: 'senshi',
  sex: 'male',
  color_1: 0xffffff,
  color_2: 0xd9af57,
  color_3: 0x8b6539,
  hat: null,
  cloak: null,
})

export const fight_character_roster_key = (checkpoint: Readonly<HydratedFightCheckpoint> | null): string =>
  checkpoint
    ? checkpoint.contract.fighters
        .flatMap((fighter, seat) => (fighter.kind.type === 'player' ? [`${seat}:${fighter.kind.character}`] : []))
        .join('|')
    : ''

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

const checkpoint_appearance = (character_id: string, source: Readonly<PlayerSource> | undefined) => {
  const appearance = source ?? DEFAULT_APPEARANCE
  return Object.freeze({
    id: character_id,
    classe: appearance.classe,
    male: appearance.sex !== 'female',
    colors: Object.freeze([
      character_color_hex(appearance.color_1),
      character_color_hex(appearance.color_2),
      character_color_hex(appearance.color_3),
    ] as const),
    loadout: Object.freeze({
      ...(appearance.hat ? { hat: appearance.hat } : {}),
      ...(appearance.cloak ? { cloak: appearance.cloak } : {}),
    }),
  })
}

export const fight_character_entity_sources = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  appearances: readonly FightCharacterAppearance[],
  viewer_team: bigint | null = null
): readonly FightCharacterRenderSource[] => {
  const by_id = new Map(appearances.map((appearance) => [appearance.id, appearance]))
  return Object.freeze(
    checkpoint.contract.fighters.flatMap((fighter, seat) => {
      if (fighter.kind.type !== 'player' || fighter.dead) return []
      const invisible = fighter.effects.some(({ kind }) => kind === EFFECT_KINDS.invis)
      if (invisible && viewer_team !== fighter.team) return []
      const known = by_id.get(fighter.kind.character)
      const source = checkpoint.sources.players[fighter.kind.character]
      const appearance = known ?? checkpoint_appearance(fighter.kind.character, source)
      return [
        Object.freeze({
          ...appearance,
          cell: Number(fighter.cell),
          side: fighter.team === 0n ? ('a' as const) : ('b' as const),
          id: `fight_character_${seat}`,
          ...(invisible ? { visual_effect: Object.freeze({ kind: 'invisibility' as const }) } : {}),
        }),
      ]
    })
  )
}
