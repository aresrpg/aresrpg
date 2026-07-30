// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared receipt edge for both atomic character creation and manual world switching.

import { read_world_joined } from '../game/core/world_joined.js'

import { invalidate_world_position } from './spawns_adapter.js'
import { seed_checkpoint_spawn } from './world_checkpoint.js'

/**
 * Ferry a proven `WorldJoined` position into the boot cache. A receipt without the event still proves a travel
 * boundary, so invalidate any previous local pose and let the chain-direct checkpoint read refill it.
 * @param {string} character_id @param {string} world_id @param {any} result
 */
export async function seed_world_join_receipt(character_id, world_id, result) {
  const joined = read_world_joined(result)
  if (!joined) return invalidate_world_position(character_id, world_id)
  await seed_checkpoint_spawn(character_id, world_id, {
    x: joined.x,
    z: joined.z,
    first_join: joined.first_join,
  })
}
