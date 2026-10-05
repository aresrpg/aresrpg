// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { mock } from 'bun:test'

import { compile_runtime_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'
import type { EngineIssue } from '../src/types.ts'

let report: (issue?: EngineIssue) => void = () => undefined
let disposed = 0
let renders = 0
let cancelled = 0
let boots = 0
let frame: FrameRequestCallback = () => undefined
let render_error = false
let initialization_error: Error | null = null
const backend = new Proxy(
  {
    kind: 'webgpu',
    dispose: () => {
      disposed++
    },
    render: () => {
      if (render_error) throw new Error('GPU submission failed')
      renders++
    },
    render_chunk: () => new Promise(() => undefined),
  },
  { get: (target, key) => (key === 'then' ? undefined : (Reflect.get(target, key) ?? (() => undefined))) }
)
mock.module('../src/webgpu_backend.ts', () => ({
  create_webgpu_backend: async (_canvas: unknown, _quality: unknown, _world: unknown, callback: typeof report) => {
    boots++
    if (initialization_error) throw initialization_error
    report = callback
    return backend
  },
}))
Object.defineProperties(globalThis, {
  navigator: { value: { gpu: {} }, configurable: true },
  requestAnimationFrame: {
    value: (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    },
    configurable: true,
  },
  cancelAnimationFrame: {
    value: () => {
      cancelled++
    },
    configurable: true,
  },
})
const { create_engine } = await import('../src/renderer.ts')
const engine = create_engine({ canvas: {} as never, world: compile_runtime_world_recipe(world_terrain('nauvis')) })
await new Promise<void>((resolve) => {
  engine.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
})
assert.equal(engine.status().state, 'ready')
engine.start()
const chunk = engine.render_chunk({ key: 'pending', coordinate: { x: 0, y: 0, z: 0 }, lod: 'near' })
report({ code: 'webgpu_device_lost' } as never)
assert.equal(engine.status().state, 'failed')
report()
assert.equal(engine.status().state, 'failed')
assert.equal(await chunk, 'failed')
assert.equal(disposed, 1)
assert.equal(cancelled, 1)
engine.start()
assert.equal(renders, 0)
assert.equal(await engine.render_chunk({ key: 'late', coordinate: { x: 0, y: 0, z: 0 }, lod: 'near' }), 'failed')
engine.dispose()
assert.equal(disposed, 1)

const second = create_engine({ canvas: {} as never, world: compile_runtime_world_recipe(world_terrain('nauvis')) })
await new Promise<void>((resolve) => {
  second.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
})
second.start()
render_error = true
const original_error = console.error
const errors: unknown[][] = []
console.error = (...args) => {
  errors.push(args)
}
try {
  frame(performance.now())
} finally {
  console.error = original_error
}
assert.equal(errors.length, 1)
assert.equal(second.status().state, 'failed')
assert.equal(second.status().backend, 'webgpu')
assert.match(second.status().issue?.stack ?? '', /GPU submission failed/)
assert.equal(disposed, 2)
second.dispose()
assert.equal(disposed, 2)
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
const unsupported = create_engine({ canvas: {} as never, world: compile_runtime_world_recipe(world_terrain('nauvis')) })
await new Promise<void>((resolve) => {
  unsupported.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
})
assert.equal(boots, 2)
assert.deepEqual(unsupported.status(), { state: 'failed', backend: 'none', issue: { code: 'webgpu_unavailable' } })
unsupported.dispose()
Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true })
initialization_error = new Error('adapter initialization rejected')
const failed_boot = create_engine({ canvas: {} as never, world: compile_runtime_world_recipe(world_terrain('nauvis')) })
await new Promise<void>((resolve) => {
  failed_boot.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
})
assert.equal(failed_boot.status().issue?.code, 'webgpu_initialization_failed')
assert.equal(failed_boot.status().issue?.detail, initialization_error.message)
assert.equal(failed_boot.status().issue?.stack, initialization_error.stack)
failed_boot.dispose()
console.log('renderer terminal failure passed')
