// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedItem } from '@aresrpg/sdk/seed'

export type PetLocomotion = NonNullable<SeedItem['pet_movement']>

const HOVER_HEIGHT = 1.5
const HOVER_AMPLITUDE = 0.15
const HOVER_PERIOD_SECONDS = 2.6
const SEAT_HEIGHT_RATIO = 0.8

export const pet_locomotion_of = (item: Pick<SeedItem, 'pet_movement'>): PetLocomotion => item.pet_movement ?? 'walk'

/** a WALKING companion stays on the ground and swim/fly companions hover on their own clock —
 *  a pet NEVER mirrors the owner's jump (owner 2026-08-21) */
export const pet_vertical_offset = (locomotion: PetLocomotion, elapsed_seconds: number): number =>
  locomotion === 'walk'
    ? 0
    : HOVER_HEIGHT + Math.sin((elapsed_seconds / HOVER_PERIOD_SECONDS) * Math.PI * 2) * HOVER_AMPLITUDE

export const pet_seat_height = (rendered_height: number | null): number =>
  rendered_height === null ? 0 : rendered_height * SEAT_HEIGHT_RATIO
