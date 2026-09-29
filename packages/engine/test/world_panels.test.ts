// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Scene, Mesh, Vector3 } from 'three'

import { create_world_panels } from '../src/world_panels.ts'

test('world panels retain a fixed plane and release resources on replacement and disposal', () => {
  const scene = new Scene(),
    layer = create_world_panels(scene)
  const canvas = { width: 16, height: 8 } as HTMLCanvasElement
  const panel = { canvas, position: [-36, 104, 0] as const, size: [36, 18] as const, yaw: Math.PI / 2, visible: true }
  layer.set('welcome', panel)
  const group = scene.children[0]!,
    mesh = group.children[0] as Mesh
  mesh.updateMatrixWorld(true)
  const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld)
  expect(normal.x).toBeCloseTo(1)
  expect(normal.y).toBeCloseTo(0)
  expect(normal.z).toBeCloseTo(0)
  expect(mesh.position.toArray()).toEqual([-36, 104, 0])
  layer.set('welcome', { ...panel, visible: false })
  expect(group.children).toHaveLength(1)
  expect(group.children[0]).toBe(mesh)
  expect(mesh.visible).toBe(false)
  let disposed = 0
  mesh.geometry.addEventListener('dispose', () => disposed++)
  layer.set('welcome', null)
  expect(disposed).toBe(1)
  expect(group.children).toHaveLength(0)
  layer.dispose()
  expect(scene.children).toHaveLength(0)
})
