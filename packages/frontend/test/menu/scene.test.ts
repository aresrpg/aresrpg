// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { validate_world_recipe, compile_world_recipe, parse_world_recipe, sample_world_column } from '@aresrpg/engine'

import { menu_camera_at } from '../../src/menu/camera.ts'
import { sample_far_height } from '../../../engine/src/far_surface.ts'
import { QUALITY_OPTIONS } from '../../../engine/src/quality.ts'
import scene from '../../../../seed/scenes/main_menu.json'

test('the camera targets the harbor subject used by streaming, water and sunlight shadows', () => {
  expect([...menu_camera_at(scene.camera, 0, true).target]).toEqual(scene.camera.focus)
  expect(validate_world_recipe(scene.world).ok).toBe(true)
})

test('aerial camera motion is bounded and reduced motion pins the view', () => {
  const initial = menu_camera_at(scene.camera, 0, true)
  expect(menu_camera_at(scene.camera, 100, true)).toEqual(initial)
  for (const seconds of [0, 30, 60, 120, 180, 240]) {
    const view = menu_camera_at(scene.camera, seconds, false)
    expect(
      Math.hypot(view.position[0] - scene.camera.focus[0]!, view.position[2] - scene.camera.focus[2]!)
    ).toBeCloseTo(scene.camera.radius, 8)
    expect([...view.target]).toEqual(scene.camera.focus)
  }
})

test('the entire camera orbit stays clear of terrain', () => {
  const world = compile_world_recipe(scene.world)
  for (let seconds = 0; seconds <= scene.camera.period; seconds += 10) {
    const { position } = menu_camera_at(scene.camera, seconds, false)
    expect(position[1] - sample_world_column(world, position[0], position[2]).surface_y).toBeGreaterThanOrEqual(8)
  }
})

test('the inner harbor view is not occluded by the foreground terrain', () => {
  const world = compile_world_recipe(scene.world)
  for (const seconds of [0, 60, 120, 180]) {
    const { position, target } = menu_camera_at(scene.camera, seconds, false)
    const dx = target[0] - position[0],
      dz = target[2] - position[2]
    const distance = Math.hypot(dx, dz)
    const half_width = Math.tan((scene.camera.fov * Math.PI) / 360) * distance * 1.6
    for (const side of [-0.45, 0, 0.45])
      for (let step = 0; step <= 20; step++) {
        const fraction = step / 20
        const x = position[0] + (dx - (dz / distance) * half_width * side) * fraction
        const z = position[2] + (dz + (dx / distance) * half_width * side) * fraction
        const y = position[1] + (target[1] - position[1]) * fraction
        expect(sample_world_column(world, x, z).surface_y).toBeLessThan(y)
      }
  }
})

test('distant conifers remain grounded on every quality tier horizon mesh', () => {
  const recipe = parse_world_recipe(scene.world)
  const world = compile_world_recipe(recipe)
  for (const plant of recipe.scenery!.plants!.filter((row) => row.kind === 'pine')) {
    for (const quality of QUALITY_OPTIONS)
      expect(plant.center[1]).toBeLessThanOrEqual(sample_far_height(world, quality, plant.center[0], plant.center[2]))
  }
})
