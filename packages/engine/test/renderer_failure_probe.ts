// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { mock } from 'bun:test'

import { world_terrain } from '../src/world_catalog.ts'
import type { EngineIssue } from '../src/types.ts'

let report: (issue?: EngineIssue) => void = () => undefined
let disposed = 0
let renders = 0
let cancelled = 0
let boots = 0
let frame: FrameRequestCallback = () => undefined
let render_error = false
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
    report = callback
    return backend
  },
}))
mock.module('../src/grid_fallback.ts', () => ({
  create_grid_fallback: () =>
    new Proxy(backend, { get: (target, key) => (key === 'kind' ? 'grid' : Reflect.get(target, key)) }),
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
const engine = create_engine({ canvas: {} as never, world: world_terrain('nauvis') })
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

const fallback_issue = { code: 'graphics_unavailable' as const }
const grid = create_engine({ canvas: {} as never, world: world_terrain('nauvis'), force_grid: true })
assert.equal(grid.backend(), 'grid', 'terrain planning must stop before the fallback attaches')
await new Promise<void>((resolve) => {
  grid.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
})
assert.equal(boots, 1, 'forced grid must never attempt WebGPU again')
assert.deepEqual(grid.status(), { state: 'degraded', backend: 'grid', issue: fallback_issue })
grid.start()
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
assert.equal(grid.status().state, 'failed')
assert.equal(grid.status().backend, 'grid')
assert.equal(disposed, 2)
grid.dispose()
assert.equal(disposed, 2)
console.log('renderer terminal failure passed')
