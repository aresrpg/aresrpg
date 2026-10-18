// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'

import { mock } from 'bun:test'

import type { EngineQuality } from '../src/types.ts'
import { compile_runtime_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

let renders = 0
let ticks = 0
let frame: FrameRequestCallback = () => undefined
const backend = new Proxy(
  {
    kind: 'webgpu',
    tick: () => {
      ticks += 1
    },
    render: () => {
      renders += 1
    },
  },
  { get: (target, key) => (key === 'then' ? undefined : (Reflect.get(target, key) ?? (() => undefined))) }
)
mock.module('../src/webgpu_backend.ts', () => ({ create_webgpu_backend: async () => backend }))
Object.defineProperties(globalThis, {
  navigator: { value: { gpu: {} }, configurable: true },
  requestAnimationFrame: {
    value: (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    },
    configurable: true,
  },
  cancelAnimationFrame: { value: () => undefined, configurable: true },
})
const { create_engine } = await import('../src/renderer.ts')
const world = compile_runtime_world_recipe(world_terrain('nauvis'))
for (const quality of ['low', 'medium', 'high'] as const) {
  for (const refresh_rate of [24, 59.94, 60, 119.88, 120, 144, 240]) {
    const engine = create_engine({ canvas: {} as never, world, quality })
    await new Promise<void>((resolve) =>
      engine.subscribe_status((status) => {
        if (status.state !== 'initializing') resolve()
      })
    )
    renders = 0
    ticks = 0
    let elapsed = 0
    engine.start(({ delta_seconds }) => {
      elapsed += delta_seconds
    })
    const start = performance.now()
    for (let index = 0; index < refresh_rate * 2; index += 1) frame(start + (index * 1000) / refresh_rate)
    const expected = Math.min(refresh_rate, quality === 'low' ? 30 : 60) * 2
    assert(
      Math.abs(renders - expected) <= 1,
      `${quality} at ${refresh_rate} Hz rendered ${renders}, expected ${expected}`
    )
    assert.equal(ticks, renders)
    assert.equal(engine.frame_count(), renders, 'FPS counts presented engine frames, not display callbacks')
    assert(elapsed > 1.9 && elapsed < 2.01, `simulation elapsed ${elapsed}`)
    engine.dispose()
  }
}

// Quality switches and long suspension cannot strand a future deadline or replay missed frames.
const engine = create_engine({ canvas: {} as never, world, quality: 'low' })
await new Promise<void>((resolve) =>
  engine.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
)
engine.start()
let now = performance.now()
const measure = (quality: EngineQuality): number => {
  engine.set_quality(quality)
  const before = renders
  for (let index = 0; index < 120; index += 1) {
    frame(now)
    now += 1000 / 120
  }
  return renders - before
}
assert(Math.abs(measure('low') - 30) <= 1)
assert(Math.abs(measure('high') - 60) <= 1)
assert(Math.abs(measure('medium') - 60) <= 1)
assert(Math.abs(measure('low') - 30) <= 1)
now += 60_000
const before = renders
frame(now)
frame(now + 1)
assert.equal(renders, before + 1)
engine.stop()
frame(now + 100)
assert.equal(renders, before + 1)
engine.start()
frame(now + 200)
assert.equal(renders, before + 2)
engine.dispose()
console.log('renderer cadence passed')
