// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const noop = () => {}

const load_courier = () => import('../courier/world.js')

/**
 * Start the courier as an additive scene sibling behind its own lazy error boundary. The scene boundary joins
 * its room synchronously before calling here, so a courier module/init failure cannot suppress or mutate it.
 *
 * @param {{
 *   world_id: string|null, character_id?: string|null, address?: string|null,
 * }} identity
 * @param {(error: unknown) => void} [on_error]
 * @param {() => Promise<{ join_courier: (world:string|null, character?:string|null, address?:string|null) => void }>} [load]
 */
export async function start_scene_courier(identity, on_error = noop, load = load_courier) {
  const { world_id, character_id = null, address = null } = identity
  try {
    const { join_courier } = await load()
    join_courier(world_id, character_id, address)
  } catch (error) {
    on_error(error)
  }
}

/**
 * Destroy an existing world scene, leave its room, then close the courier once its lazy chunk is ready. Each
 * transport has its own teardown boundary; the caller-supplied guard prevents a stale courier import from
 * tearing down a newer scene's link.
 * A null scene is the cold-login path: it deliberately performs no import and therefore cannot open the link.
 *
 * @param {{ destroy: () => void } | null} scene
 * @param {() => boolean} can_leave
 * @param {(error: unknown) => void} [on_error]
 * @param {() => Promise<{ leave_courier: () => void }>} [load]
 * @returns {boolean} whether a live scene was released
 */
export function destroy_scene_and_leave_courier(scene, can_leave, on_error = noop, load = load_courier) {
  if (!scene) return false
  scene.destroy()
  void import('../p2p/lobby-room.js')
    .then(({ leave_room }) => {
      if (can_leave()) leave_room()
    })
    .catch(on_error)
  void load()
    .then(({ leave_courier }) => {
      if (can_leave()) leave_courier()
    })
    .catch(on_error)
  return true
}
