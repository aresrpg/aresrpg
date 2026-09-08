// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Mesh, Scene } from 'three'

import { create_board_occlusion } from '../src/board_occlusion.ts'
import { create_scatter_layer } from '../src/scatter_layer.ts'
import type { ScatterInstance } from '../src/scatter.ts'

const instance: ScatterInstance = {
  kind: 'tuft',
  variant: 0,
  x: 1,
  y: 1,
  z: 1,
  yaw: 0,
  scale: 1,
  color: [0.2, 0.6, 0.1],
  accent: [0.3, 0.8, 0.2],
  climate_tint: 1,
}

test('evicting scatter releases its render bindings without invalidating a neighboring chunk', () => {
  const scene = new Scene()
  const layer = create_scatter_layer({ scene, board_occlusion: create_board_occlusion() })
  layer.add(
    { key: 'first', lod: 'near', origin: [0, 0, 0], coordinate: { x: 0, y: 0, z: 0 }, resolution: 32, cell_size: 1 },
    [instance]
  )
  layer.add(
    { key: 'second', lod: 'near', origin: [32, 0, 0], coordinate: { x: 1, y: 0, z: 0 }, resolution: 32, cell_size: 1 },
    [instance]
  )
  const [first, second] = scene.children[0]!.children as Mesh[]
  const disposed: string[] = []
  const first_material = Array.isArray(first!.material) ? first!.material[0]! : first!.material
  const second_material = Array.isArray(second!.material) ? second!.material[0]! : second!.material
  first_material.addEventListener('dispose', () => disposed.push('first'))
  second_material.addEventListener('dispose', () => disposed.push('second'))
  layer.remove('first')
  expect(disposed).toEqual(['first'])
  expect(scene.children[0]!.children).toEqual([second!])
  layer.dispose()
  expect(disposed).toEqual(['first', 'second'])
  expect(scene.children).toHaveLength(0)
})
