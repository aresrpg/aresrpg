// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const noop = () => {}

/**
 * Destroy an existing world scene, then leave its room once the lazy transport chunk is ready. The
 * caller-supplied guard prevents a stale import from tearing down a NEWER scene's link.
 * A null scene is the cold-login path: it deliberately performs no import and therefore cannot open the link.
 *
 * @param {{ destroy: () => void } | null} scene
 * @param {() => boolean} can_leave
 * @param {(error: unknown) => void} [on_error]
 * @param {() => Promise<{ leave_room: () => void }>} [load]
 * @returns {boolean} whether a live scene was released
 */
export function destroy_scene_and_leave_room(
  scene,
  can_leave,
  on_error = noop,
  load = () => import('../p2p/lobby-room.js')
) {
  if (!scene) return false
  scene.destroy()
  void load()
    .then(({ leave_room }) => {
      if (can_leave()) leave_room()
    })
    .catch(on_error)
  return true
}
