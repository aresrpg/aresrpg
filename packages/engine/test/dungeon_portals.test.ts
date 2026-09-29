// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { Scene, Mesh } from 'three'

import { create_dungeon_portals, portal_hum_gain } from '../src/dungeon_portals.ts'
import { DUNGEON_GATE, PORTAL_ARCH, dungeon_gate_position, dungeon_gate_source } from '../src/portal_shape.ts'
import { create_portal_geometry } from '../src/portal.ts'
import { compile_world_recipe, sample_world_column } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

test('the upright demonic gate keeps its guide anchor clear and shares the spawn aperture', () => {
  expect(DUNGEON_GATE.offset_z - PORTAL_ARCH.depth / 2).toBeGreaterThan(1)
  expect(dungeon_gate_position(512, 0)).toEqual({ x: 512, z: 5 })
  const source = dungeon_gate_source()
  expect(new Set(source.blocks.map((block) => block[3]))).toEqual(
    new Set(['dungeon_basalt', 'dungeon_masonry', 'dungeon_ember'])
  )
  const geometry = create_portal_geometry()
  geometry.computeBoundingBox()
  expect(geometry.boundingBox!.min.y).toBe(0)
  expect(geometry.boundingBox!.max.y).toBeGreaterThan(8)
  expect(geometry.boundingBox!.min.z).toBe(0)
  expect(geometry.boundingBox!.max.z).toBe(0)
  geometry.dispose()
})

test('dungeon membrane stands vertically at the same position as its terrain frame', () => {
  const world = compile_world_recipe(world_terrain('nauvis'))
  const scene = new Scene()
  const portals = create_dungeon_portals({ scene, world })
  portals.set_markers([{ id: 'test', x: 512, z: 0 }])
  const root = scene.children[0]!
  expect(root.rotation.x).toBe(0)
  expect(root.position.toArray()).toEqual([512, sample_world_column(world, 512, 5).surface_y, 5])
  const membrane = root.children.find((child) => child instanceof Mesh)!
  expect(membrane.rotation.x).toBe(0)
  portals.dispose()
  expect(scene.children).toHaveLength(0)
})

test('dungeon portal hum fades smoothly and stops outside its ambience radius', () => {
  expect(portal_hum_gain(0)).toBeCloseTo(0.055)
  expect(portal_hum_gain(14)).toBeCloseTo(0.0275)
  expect(portal_hum_gain(28)).toBe(0)
  expect(portal_hum_gain(100)).toBe(0)
  expect(portal_hum_gain(0, 0.25)).toBeCloseTo(0.01375)
})
