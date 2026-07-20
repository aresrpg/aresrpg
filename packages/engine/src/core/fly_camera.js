// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Minimal fly camera rig for M0 (engine.js helper, kept out of engine.js to hold its LoC
// budget). Owns only position/orientation state + applying it to a three.js camera each frame —
// no input handling (that's the demo app's job; engine.js exposes set_camera_position/
// set_camera_orientation as the public control surface, §engine.js facade).

import { Euler, Quaternion } from 'three'

/**
 * @typedef {object} FlyCamera
 * @property {(position: [number, number, number]) => void} set_position world-space meters
 * @property {(yaw: number, pitch: number) => void} set_orientation radians
 * @property {() => void} apply writes current position/orientation onto the bound three.js camera
 */

/**
 * @param {import('three').Camera} camera
 * @returns {FlyCamera}
 */
export function create_fly_camera(camera) {
  let x = 0
  let y = 0
  let z = 0
  let yaw = 0
  let pitch = 0
  const euler = new Euler(0, 0, 0, 'YXZ')
  const quaternion = new Quaternion()

  return {
    set_position(position) {
      ;[x, y, z] = position
    },
    set_orientation(new_yaw, new_pitch) {
      yaw = new_yaw
      pitch = new_pitch
    },
    apply() {
      camera.position.set(x, y, z)
      euler.set(pitch, yaw, 0)
      quaternion.setFromEuler(euler)
      camera.quaternion.copy(quaternion)
    },
  }
}
