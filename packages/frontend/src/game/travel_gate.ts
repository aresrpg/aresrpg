// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { travel_proof_ready, type CharacterRow } from '@aresrpg/protocol'

/** Every overworld action proves the same checkpoint leg, including its future gathering root. */
export const character_travel_ready = (
  character: Readonly<CharacterRow>,
  target: Readonly<{ x: number; z: number }>,
  now_ms: number
): boolean => {
  const { checkpoint_world, world, x, z, at_ms } = character
  if (checkpoint_world !== world || x === undefined || z === undefined || at_ms === undefined) return false
  return travel_proof_ready({
    from_x: x,
    from_z: z,
    from_ms: at_ms,
    pet_at_start: character.pet === true,
    to_x: Math.round(target.x),
    to_z: Math.round(target.z),
    now_ms,
    pet_now: character.equipment.some(({ slot }) => slot === 'pet'),
  })
}
