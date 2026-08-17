// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Vector3, type Camera } from 'three'

import type { EntityScreenAnchor } from './types.ts'

type ClientRect = Readonly<{ left: number; top: number; width: number; height: number }>

export const project_screen_anchor = (
  point: Readonly<Vector3>,
  camera: Readonly<Camera>,
  rect: ClientRect
): EntityScreenAnchor | null => {
  if (rect.width <= 0 || rect.height <= 0) return null
  const direction = camera.getWorldDirection(new Vector3())
  if (new Vector3().subVectors(point, camera.position).dot(direction) <= 0) return null
  const projected = point.clone().project(camera)
  if (![projected.x, projected.y].every(Number.isFinite)) return null
  return Object.freeze({
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projected.y) / 2) * rect.height,
  })
}
