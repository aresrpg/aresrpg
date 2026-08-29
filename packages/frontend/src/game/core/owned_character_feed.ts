// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this external presentation feed owns its private live-position cache. */

import type { CharacterRow, PresenceRow } from '@aresrpg/protocol'

export type OwnedCharacterPosition = Readonly<{ character_id: string; world: string; x: number; y: number; z: number }>

const feed: {
  positions: Map<string, OwnedCharacterPosition>
  snapshot: Readonly<Record<string, OwnedCharacterPosition>>
  listeners: Set<() => void>
} = { positions: new Map(), snapshot: Object.freeze({}), listeners: new Set() }

const equipment_type = (character: Readonly<CharacterRow>, slot: string): string | null =>
  character.equipment.find((item) => item.slot === slot)?.item_type ?? null

const fallback_position = (
  character: Readonly<CharacterRow>,
  ground_height: (x: number, z: number) => number
): OwnedCharacterPosition | null =>
  character.world === character.checkpoint_world && Number.isFinite(character.x) && Number.isFinite(character.z)
    ? Object.freeze({
        character_id: character.id,
        world: character.world!,
        x: character.x!,
        y: ground_height(character.x!, character.z!),
        z: character.z!,
      })
    : null

const presence_position = (
  character: Readonly<CharacterRow>,
  world: string,
  ground_height: (x: number, z: number) => number
): OwnedCharacterPosition | null => {
  if (character.world !== world || character.custody === 'fight' || character.active_fight || character.dungeon_run)
    return null
  return feed.positions.get(character.id) ?? fallback_position(character, ground_height)
}

export const owned_character_presence_rows = (
  characters: readonly Readonly<CharacterRow>[],
  owner: string,
  world: string | null,
  ground_height: (x: number, z: number) => number
): Readonly<Record<string, PresenceRow>> =>
  world
    ? Object.freeze(
        Object.fromEntries(
          characters.flatMap((character) => {
            const position = presence_position(character, world, ground_height)
            if (!position) return []
            return [
              [
                character.id,
                Object.freeze({
                  character_id: character.id,
                  world,
                  owner,
                  name: character.name,
                  classe: character.classe,
                  sex: character.sex,
                  level: character.level,
                  color_1: character.color_1,
                  color_2: character.color_2,
                  color_3: character.color_3,
                  hat: equipment_type(character, 'hat'),
                  cloak: equipment_type(character, 'cloak'),
                  title: equipment_type(character, 'title'),
                  pet: equipment_type(character, 'pet'),
                  riding: false,
                  x: position.x,
                  y: position.y,
                  z: position.z,
                }) satisfies PresenceRow,
              ],
            ]
          })
        )
      )
    : Object.freeze({})

export const record_owned_character_position = (
  character_id: string,
  world: string,
  position: Readonly<{ x: number; y: number; z: number }>
): void => {
  const previous = feed.positions.get(character_id)
  if (previous?.world === world && previous.x === position.x && previous.y === position.y && previous.z === position.z)
    return
  const row = Object.freeze({ character_id, world, ...position })
  feed.positions.set(character_id, row)
  feed.snapshot = Object.freeze(Object.fromEntries(feed.positions))
  feed.listeners.forEach((listener) => listener())
}

export const owned_character_position = (character_id: string, world: string): OwnedCharacterPosition | null => {
  const row = feed.positions.get(character_id)
  return row?.world === world ? row : null
}

export const read_owned_character_positions = (): Readonly<Record<string, OwnedCharacterPosition>> => feed.snapshot
export const subscribe_owned_character_positions = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const clear_owned_character_positions = (): void => {
  feed.positions.clear()
  feed.snapshot = Object.freeze({})
  feed.listeners.forEach((listener) => listener())
}

export const reset_owned_character_positions_for_testing = clear_owned_character_positions
