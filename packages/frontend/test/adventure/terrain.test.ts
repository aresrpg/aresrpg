// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { beforeAll, expect, test } from 'bun:test'
import { compile_runtime_world_recipe, sample_world_column, structure_voxels } from '@aresrpg/engine'

import adventure from '../../../../seed/content/adventure.json'
import environment from '../../../../seed/content/adventure_environment.json'
import { adventure_terrain, adventure_movement_area } from '../../src/adventure/terrain.ts'
import { adventure_axis, cavern_floor } from '../../src/adventure/biome.ts'
import { create_world_collision } from '../../src/game/core/world_collision.ts'
import { walking_edge, type WalkPoint } from '../../src/game/core/walkable.ts'

let world: ReturnType<typeof compile_runtime_world_recipe>
let collision: ReturnType<typeof create_world_collision>
beforeAll(() => {
  world = compile_runtime_world_recipe(structuredClone(adventure_terrain()))
  collision = create_world_collision(world, (error) => {
    throw error
  })
})

test('the king stands on an authored floor with clear headroom', () => {
  const { x, y, z } = adventure.encounters.at(-1)!.position
  const column = structure_voxels(world, { min_x: x, max_x: x, min_z: z, max_z: z })
  const material_at = (height: number) => column.findLast((voxel) => voxel.y === height)?.material_id
  expect(material_at(y - 1)).toBeGreaterThan(0)
  expect(material_at(y)).toBe(0)
  expect(material_at(y + 5)).toBe(0)
  expect(sample_world_column(world, x, z).surface_y).toBeGreaterThan(y + environment.descent.arena_vault_height)
})

test('the real body can walk down every stair and back to the wooden bridge without jumping', () => {
  // The old descent dropped 80 → 78 → 76 → 73 in three cells immediately after the bridge.
  const end = adventure.encounters.at(-1)!.position.z
  let point: WalkPoint = [128.5, 80, 228.5]
  for (let z = 229; z <= end; z += 1) {
    const next = walking_edge(collision, point, adventure_axis(z) + 0.5, z + 0.5)
    expect(next, `descent at ${z}`).toBeTruthy()
    point = next!
  }
  for (let z = end - 1; z >= 228; z -= 1) {
    const next = walking_edge(collision, point, adventure_axis(z) + 0.5, z + 0.5)
    expect(next, `ascent at ${z}`).toBeTruthy()
    point = next!
  }
})

test('stone treads fall at most one block and retain at least three blocks of depth', () => {
  let previous_drop = -Infinity
  for (let z = environment.descent.start_z + 1; z <= environment.descent.gate.z; z += 1) {
    const drop = cavern_floor(z - 1) - cavern_floor(z)
    expect([0, 1]).toContain(drop)
    if (drop === 0) continue
    expect(z - previous_drop).toBeGreaterThanOrEqual(3)
    previous_drop = z
  }
})

test('invisible boundaries admit the route and arena, but exclude lava, side cliffs and the rear wall', () => {
  const open = adventure_movement_area(true)
  const locked = adventure_movement_area(false)
  for (let z = 229; z <= adventure.encounters.at(-1)!.position.z; z += 1) {
    expect(open(adventure_axis(z), z)).toBeTrue()
    expect(locked(adventure_axis(z), z)).toBeFalse()
  }
  const { x, y, z } = adventure.encounters.at(-1)!.position
  expect(open(x + 19, z)).toBeTrue()
  expect(collision.solid_at(x + 19, y - 1, z)).toBeTrue()
  expect(open(x + 25, z)).toBeFalse()
  expect(['lava', 'lava_hot']).toContain(
    world.materials.entries[collision.structure_material_at(x + 25, y - 1, z)!]!.name
  )
  expect(open(x, z + environment.descent.arena_radius)).toBeFalse()
  expect(open(adventure_axis(280) + 5, 280)).toBeFalse()
})

test('the open gate has body clearance and every glowing mushroom is grounded', () => {
  const { z } = environment.descent.gate
  const y = cavern_floor(z)
  for (let x = 123; x <= 133; x += 1) {
    expect(collision.solid_at(x, y - 1, z)).toBeTrue()
    expect(collision.solid_at(x, y, z)).toBeFalse()
    expect(collision.solid_at(x, y + 10, z)).toBeFalse()
  }
  for (const {
    center: [x, floor, depth],
  } of environment.scenery.plants) {
    expect(collision.solid_at(x!, floor! - 0.01, depth!)).toBeTrue()
    expect(collision.solid_at(x!, floor!, depth!)).toBeFalse()
    expect(world.materials.entries[collision.structure_material_at(x!, floor! - 1, depth!)!]!.name).toBe('cavern_slate')
  }
})
