// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from '@aresrpg/engine'

import source from '../../../../seed/content/adventure.json'
import type { AdventureState } from '../modules/adventure.ts'
import { actor_facing } from '../game/actor_facing.ts'

export const adventure_actor_facing = (
  state: Readonly<Pick<AdventureState, 'dialogue' | 'companion'>>,
  character_id: string,
  position: Vec3,
  listener: Vec3 | undefined,
  resting_yaw: number
): number => {
  if (character_id !== source.companion.id || state.dialogue === null || state.companion || !listener)
    return resting_yaw
  return actor_facing(position, listener, resting_yaw)
}
