// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { characteristic_value_cost } from '@aresrpg/immutable'
import { compile_runtime_world_recipe, structure_voxels } from '@aresrpg/engine'

import { adventure_character } from '../../src/adventure/character.ts'
import { adventure_terrain, ADVENTURE_SPAWN } from '../../src/adventure/terrain.ts'
import { valid_simulator_character } from '../../src/modules/simulator.ts'
import { ADVENTURE_APP_MODULES, DEMO_APP_MODULES, PLAYER_APP_MODULES, create_app } from '../../src/store.ts'

test('the preview boots a legal Strength Senshi without changing the player or lab roster', () => {
  const app = create_app()
  const before = app.store.getState()
  app.dispatch({ type: 'adventure/entered' })
  const state = app.store.getState()
  expect(state.session).toBe(before.session)
  expect(state.simulator).toBe(before.simulator)
  expect(state.adventure.character).toEqual(adventure_character())
  const character = state.adventure.character!
  expect(character.level).toBe(199)
  expect(valid_simulator_character(character)).toBeTrue()
  expect(characteristic_value_cost('senshi', 'strength', character.strength)).toBe(988)
  expect(character.strength).toBe(397)
  expect(character.intelligence).toBe(0)
  app.dispatch({ type: 'adventure/entered' })
  expect(app.store.getState()).toBe(state)
})

test('the public demo has no wallet, game network, editor, or saved simulator observer', () => {
  expect(ADVENTURE_APP_MODULES).toEqual(['adventure', 'analytics', 'settings', 'audio', 'locale', 'fight'])
  expect(PLAYER_APP_MODULES).not.toContain('adventure')
  expect(DEMO_APP_MODULES).not.toContain('adventure')
})

test('the cave uses explicit air over a solid floor at the spawn across a worker recipe clone', () => {
  const world = compile_runtime_world_recipe(structuredClone(adventure_terrain()))
  const { x, y, z } = ADVENTURE_SPAWN
  const voxels = structure_voxels(world, { min_x: x, max_x: x, min_z: z, max_z: z })
  const material_at = (height: number) =>
    voxels.findLast((voxel) => voxel.x === x && voxel.y === height && voxel.z === z)?.material_id
  expect(material_at(y - 1)).toBeGreaterThan(0)
  expect(material_at(y)).toBe(0)
  expect(material_at(y + 1)).toBe(0)
  expect(material_at(y + 5)).toBe(0)
  expect(material_at(y + 6)).toBe(0)
  expect(voxels.some((voxel) => voxel.x === x && voxel.z === z && voxel.y > y + 6 && voxel.material_id > 0)).toBeTrue()
})

test('the route beyond the first encounter is always clear in the terrain', () => {
  const world = compile_runtime_world_recipe(adventure_terrain())
  const voxel = structure_voxels(world, { min_x: 144, max_x: 144, min_z: 151, max_z: 151 }).findLast(
    ({ x, y, z }) => x === 144 && y === 75 && z === 151
  )
  expect(voxel?.material_id ?? 0).toBe(0)
})
