// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from '@aresrpg/engine'

type MenuCamera = Readonly<{
  focus: readonly number[]
  radius: number
  height: number
  yaw: number
  sweep: number
  period: number
}>

/** One authored subject anchors streaming, water and shadows while the camera orbits it. */
export const menu_camera_at = (camera: MenuCamera, seconds: number, reduced_motion: boolean) => {
  const phase = reduced_motion ? 0 : (seconds * Math.PI * 2) / camera.period
  const yaw = camera.yaw + Math.sin(phase) * camera.sweep
  const position: Vec3 = [
    camera.focus[0]! + Math.sin(yaw) * camera.radius,
    camera.height,
    camera.focus[2]! + Math.cos(yaw) * camera.radius,
  ]
  return { position, target: camera.focus as Vec3 }
}
