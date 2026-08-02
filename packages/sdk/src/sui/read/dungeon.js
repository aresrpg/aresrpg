// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json } from './_object.js'

// DUNGEON READS for `aresrpg_dungeon` — the bound `RunPass` state (which world, which room, the pre-entry teleport
// position). Mirrors the `run` getters. The pass is soulbound; a consumer reads it to render the run + drive `abandon`.

/**
 * A `RunPass` snapshot: world, room, owner, pre-entry position, and the character binding
 * (`null` only for malformed data). Null when the pass is ABSENT; a FAILED read throws (#2054).
 * @param {import("../../../types.js").Context} context
 */
export function get_run_pass(context) {
  const { grpc_client } = context
  return async run_pass_id => {
    const json = await get_object_json(grpc_client, run_pass_id)
    if (!json) return null // ABSENT pass
    return {
      id: json.id,
      world: json.world,
      room: Number(json.room ?? 0),
      owner: json.owner,
      character: json.character ?? null,
      return_x: Number(json.return_x ?? 0),
      return_z: Number(json.return_z ?? 0),
    }
  }
}
