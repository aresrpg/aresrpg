// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD FRAME FERRY (#2180) — the one handoff from the cached live World doc to the spawns reducer. There is
// intentionally no world-id memo here: `world_bound` can reset the reducer while the character re-enters the
// SAME world, and the cached doc must then be folded again to restore zone_size + world-centre offsets.

/**
 * @param {string} world_id
 * @param {{ current_world_id: () => string|null, read_world_doc: (world_id:string) => Promise<any>,
 *   input: (message:any) => void }} edge
 */
export async function fold_current_world_frame(world_id, { current_world_id, read_world_doc, input }) {
  const doc = await read_world_doc(world_id)
  if (current_world_id() !== world_id) return false
  input({ type: 'world_doc', doc })
  return !!doc
}
