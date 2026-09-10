// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { character_checkpoint, position_checkpoint, type CharacterRow } from '@aresrpg/protocol'

import type { Embodied, TrackedCharacter } from './player.ts'

export const refreshed_world_anchor = (
  existing: Readonly<TrackedCharacter> | undefined,
  character: Readonly<Embodied>,
  at_ms: number
): Pick<TrackedCharacter, 'presence' | 'move_anchor' | 'checkpoint'> => {
  const checkpoint = position_checkpoint(character.world, { x: character.x, z: character.z, at_ms })
  if (existing?.checkpoint !== checkpoint)
    return Object.freeze({
      checkpoint,
      presence: character,
      move_anchor: { x: character.x, z: character.z, at_ms, blocks: 0 },
    })
  return Object.freeze({
    checkpoint,
    presence: Object.freeze({
      ...character,
      x: existing.presence.x,
      y: existing.presence.y,
      z: existing.presence.z,
      riding: existing.presence.riding && character.pet !== null,
    }),
    move_anchor: existing.move_anchor,
  })
}

/** Fold the new anchor before exposing the roster to the client. Equipment rereads may finish later. */
export const refreshed_roster_anchors = (
  tracked: Readonly<Record<string, TrackedCharacter>>,
  characters: readonly CharacterRow[]
): Readonly<Record<string, TrackedCharacter>> =>
  Object.freeze(
    Object.fromEntries(
      characters.flatMap((character) => {
        const existing = tracked[character.id]
        if (!existing) return []
        const checkpoint = character_checkpoint(character)
        if (!checkpoint || checkpoint === existing.checkpoint) return [[character.id, existing]]
        return [
          [
            character.id,
            {
              ...existing,
              ...refreshed_world_anchor(
                existing,
                {
                  ...existing.presence,
                  world: character.world!,
                  x: character.x!,
                  y: 0,
                  z: character.z!,
                },
                character.at_ms ?? 0
              ),
            },
          ],
        ]
      })
    )
  )
