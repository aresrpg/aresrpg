// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * A pending voxel singleton is reusable only for the exact same mount identity. Character identity belongs
 * beside world/mode/follow because the session closes over the avatar GLB, controller, position cache, and
 * position broadcaster at creation time.
 * @param {{ mode:string, world_id:string|null, character_id:string|null, follow:boolean }} pending
 * @param {{ mode:string, world_id:string|null, character_id:string|null, follow:boolean }} incoming
 */
export function should_reuse_pending_session(pending, incoming) {
  return (
    pending.mode === incoming.mode &&
    pending.world_id === incoming.world_id &&
    pending.character_id === incoming.character_id &&
    pending.follow === incoming.follow
  )
}
