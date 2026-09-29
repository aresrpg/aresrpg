// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { compile_world_recipe, parse_world_recipe, sample_world_column } from '@aresrpg/engine'

import scene from '../../../../seed/scenes/main_menu.json'
import { structure_voxels } from '../../../engine/src/structure_placement.ts'
import { menu_patrol } from '../../src/menu/residents.ts'

test('residents pause and walk at the authored speed without discontinuities at route wraps', () => {
  const pose = menu_patrol({
    path: [
      [0, 2, 0],
      [4, 2, 0],
    ],
    speed: 1,
    pause: 2,
    phase: 0,
  })
  expect(pose(1).animation?.name).toBe('IDLE')
  expect(pose(4).anchor).toEqual({ kind: 'world', position: [2, 2, 0] })
  expect(pose(4).animation?.name).toBe('WALK')
  expect(pose(12).anchor).toEqual(pose(0).anchor)
  expect(pose(10).anchor).toEqual({ kind: 'world', position: [2, 2, 0] })
})

test('authored strolls have ground support and two blocks of clearance', () => {
  const world = compile_world_recipe(scene.world)
  for (const resident of scene.residents) {
    const [start, end] = resident.path
    for (let step = 0; step <= 20; step++) {
      const [x, y, z] = start!.map((value, axis) => value + ((end![axis]! - value) * step) / 20) as [
        number,
        number,
        number,
      ]
      const ground = sample_world_column(world, x, z).surface_y
      const voxels = structure_voxels(world, {
        min_x: Math.floor(x),
        max_x: Math.floor(x),
        min_z: Math.floor(z),
        max_z: Math.floor(z),
      })
      expect(ground <= y).toBe(true)
      expect(voxels.some((voxel) => voxel.material_id > 0 && voxel.y >= y && voxel.y < y + 2)).toBe(false)
      expect(ground === y || voxels.some((voxel) => voxel.material_id > 0 && voxel.y === y - 1)).toBe(true)
    }
  }
})
