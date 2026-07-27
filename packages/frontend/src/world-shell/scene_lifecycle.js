// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const noop = () => {}

const load_lobby = () => import('../p2p/lobby-room.js')
const load_courier = () => import('../courier/world.js')

/**
 * Destroy an existing world scene, then leave its module-global P2P room once the lazy lobby chunk is ready.
 * The caller-supplied guard prevents a stale import resolution from tearing down a newer scene's room.
 * A null scene is the cold-login path: it deliberately performs no import and therefore cannot boot P2P.
 *
 * @param {{ destroy: () => void } | null} scene
 * @param {() => boolean} can_leave
 * @param {(error: unknown) => void} [on_error]
 * @param {() => Promise<{ leave_lobby: () => void }>} [load]
 * @returns {boolean} whether a live scene was released
 */
export function destroy_scene_and_leave_lobby(scene, can_leave, on_error = noop, load = load_lobby) {
  if (!scene) return false
  scene.destroy()
  void load()
    .then(({ leave_lobby }) => {
      if (can_leave()) {
        leave_lobby()
        void load_courier()
          .then(({ leave_courier }) => leave_courier())
          .catch(on_error)
      }
    })
    .catch(on_error)
  return true
}
