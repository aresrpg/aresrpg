// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { mock } from 'bun:test'
import * as gpu from 'three/webgpu'

import { world_terrain } from '../src/world_catalog.ts'
import { parse_world_recipe } from '../src/world_recipe.ts'

const released: string[] = []
let device_destroyed = 0
let original_loss = 0
let initialization_fails = false
const renderer = {
  onDeviceLost: () => {
    original_loss++
  },
  init: async () => {
    if (initialization_fails) throw new Error('adapter unavailable')
  },
  dispose: () => {
    released.push('renderer')
  },
}
mock.module('three/webgpu', () => ({
  ...gpu,
  Renderer: new Proxy(gpu.Renderer, { construct: () => renderer }),
  WebGPUBackend: new Proxy(gpu.WebGPUBackend, {
    construct: () => ({
      device: {
        destroy: () => {
          device_destroyed++
        },
      },
    }),
  }),
}))
const cleanup_errors: unknown[] = []
console.error = (...args: unknown[]) => {
  cleanup_errors.push(args)
}
const resource = (name: string) => ({
  dispose: () => {
    released.push(name)
    if (name === 'clouds') throw new Error('cloud cleanup failed')
  },
})
mock.module('../src/fight_board.ts', () => ({ create_fight_board_layer: () => resource('fight-board') }))
mock.module('../src/entities.ts', () => ({ create_entity_layer: () => resource('entities') }))
mock.module('../src/character_crowd.ts', () => ({
  create_character_crowd_layer: () => resource('crowd'),
  is_character_crowd_spec: () => false,
}))
mock.module('../src/entity_labels.ts', () => ({ create_entity_label_layer: () => resource('labels') }))
mock.module('../src/transient_effects.ts', () => ({ create_transient_effects: () => resource('effects') }))
mock.module('../src/clouds.ts', () => ({ create_clouds: () => resource('clouds') }))
mock.module('../src/terrain_pool.ts', () => ({
  create_terrain_pool: () => {
    throw new Error('late construction failure')
  },
}))
const { create_webgpu_backend } = await import('../src/webgpu_backend.ts')
await assert.rejects(
  create_webgpu_backend({} as never, 'low', parse_world_recipe(world_terrain('nauvis'))),
  /late construction failure/
)
assert.deepEqual(released, ['clouds', 'effects', 'labels', 'crowd', 'entities', 'fight-board', 'renderer'])
assert.equal(cleanup_errors.length, 1)
renderer.onDeviceLost()
assert.equal(original_loss, 1)
initialization_fails = true
await assert.rejects(
  create_webgpu_backend({} as never, 'low', parse_world_recipe(world_terrain('nauvis'))),
  /adapter unavailable/
)
assert.equal(released.filter((name) => name === 'renderer').length, 1)
assert.equal(device_destroyed, 1)
console.log('webgpu partial cleanup passed')
