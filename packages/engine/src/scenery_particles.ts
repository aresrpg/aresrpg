// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Box3, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, Sphere, Vector3 } from 'three'

export type Particle = Readonly<{ center: readonly number[]; size: number; phase: number }>

export const particle_geometry = (rows: readonly Particle[], drift: number): InstancedBufferGeometry => {
  const plane = new PlaneGeometry(1, 1)
  const geometry = new InstancedBufferGeometry()
  geometry.index = plane.index
  geometry.attributes = plane.attributes
  geometry.instanceCount = rows.length
  geometry.setAttribute(
    'scenery_center',
    new InstancedBufferAttribute(new Float32Array(rows.flatMap(({ center }) => [...center])), 3)
  )
  geometry.setAttribute('scenery_size', new InstancedBufferAttribute(new Float32Array(rows.map(({ size }) => size)), 1))
  geometry.setAttribute(
    'scenery_phase',
    new InstancedBufferAttribute(new Float32Array(rows.map(({ phase }) => phase)), 1)
  )
  const bounds = new Box3()
  rows.forEach(({ center, size }) => {
    const point = new Vector3(center[0], center[1], center[2])
    bounds.expandByPoint(point.clone().addScalar(size + drift))
    bounds.expandByPoint(point.subScalar(size + drift))
  })
  geometry.boundingBox = bounds
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())
  plane.dispose()
  return geometry
}
