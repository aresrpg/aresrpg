// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedItem } from '@aresrpg/sdk/seed'
import type { CharacterAnimationName } from '@aresrpg/engine'

export type PetLocomotion = NonNullable<SeedItem['pet_movement']>

const HOVER_HEIGHT = 1.5
const HOVER_AMPLITUDE = 0.15
const HOVER_PERIOD_SECONDS = 2.6

export const pet_locomotion_of = (item: Pick<SeedItem, 'pet_movement'>): PetLocomotion => item.pet_movement ?? 'walk'

/** Local and nearby companions use the same flight/swim/gait policy. */
export const pet_animation = (
  locomotion: PetLocomotion,
  moving: boolean,
  airborne: CharacterAnimationName | undefined,
  gliding: boolean
): CharacterAnimationName => {
  if (gliding) return 'IDLE'
  if (locomotion === 'swim') return 'SWIM'
  return airborne ?? (moving ? 'RUN' : 'IDLE')
}

/** a WALKING companion stays on the ground and swim/fly companions hover on their own clock —
 *  a pet NEVER mirrors the owner's jump (owner 2026-08-21) */
export const pet_vertical_offset = (locomotion: PetLocomotion, elapsed_seconds: number): number =>
  locomotion === 'walk'
    ? 0
    : HOVER_HEIGHT + Math.sin((elapsed_seconds / HOVER_PERIOD_SECONDS) * Math.PI * 2) * HOVER_AMPLITUDE
