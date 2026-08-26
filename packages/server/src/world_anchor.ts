// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Embodied, MoveAnchor, TrackedCharacter } from './player.ts'

export const refreshed_world_anchor = (
  existing: Readonly<TrackedCharacter> | undefined,
  character: Readonly<Embodied>,
  at_ms: number
): Readonly<{ presence: Embodied; move_anchor: MoveAnchor }> => {
  if (existing?.presence.world !== character.world)
    return Object.freeze({ presence: character, move_anchor: { x: character.x, z: character.z, at_ms, blocks: 0 } })
  return Object.freeze({
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
