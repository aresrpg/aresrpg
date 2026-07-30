// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const noop = () => {}

const load_courier = () => import('../courier/world.js')

/**
 * Destroy an existing world scene, then close its module-global social links once the lazy chunk is ready.
 * The caller-supplied guard prevents a stale import resolution from tearing down a newer scene's links.
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
  void load()
    .then(({ leave_courier }) => {
      if (can_leave()) leave_courier()
    })
    .catch(on_error)
  return true
}
