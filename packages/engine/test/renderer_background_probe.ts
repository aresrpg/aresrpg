// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/* eslint-disable fp-law/no-module-scope-effects -- executable lifecycle probe, run in an isolated process. */

import assert from 'node:assert/strict'

import { mock } from 'bun:test'

import { world_terrain } from '../src/world_catalog.ts'

const document = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
let updates = 0
let renders = 0
let requested_frames = 0
let frame: FrameRequestCallback = () => undefined
const backend = new Proxy(
  {
    kind: 'webgpu',
    render: () => {
      renders += 1
    },
  },
  {
    get: (target, key) => (key === 'then' ? undefined : (Reflect.get(target, key) ?? (() => undefined))),
  }
)
mock.module('../src/webgpu_backend.ts', () => ({ create_webgpu_backend: async () => backend }))
Object.defineProperties(globalThis, {
  document: { value: document, configurable: true },
  navigator: { value: { gpu: {} }, configurable: true },
  requestAnimationFrame: {
    value: (callback: FrameRequestCallback) => {
      requested_frames += 1
      frame = callback
      return requested_frames
    },
    configurable: true,
  },
  cancelAnimationFrame: { value: () => undefined, configurable: true },
})
const { create_engine } = await import('../src/renderer.ts')
const engine = create_engine({ canvas: {} as never, world: world_terrain('nauvis') })
await new Promise<void>((resolve) =>
  engine.subscribe_status((status) => {
    if (status.state !== 'initializing') resolve()
  })
)
engine.start(() => {
  updates += 1
}, true)
await Bun.sleep(140)
assert(updates > 0)
assert.equal(renders, updates)
assert.equal(requested_frames, 0)
document.visibilityState = 'visible'
document.dispatchEvent(new Event('visibilitychange'))
assert.equal(requested_frames, 1)
const before = updates
frame(performance.now())
assert.equal(updates, before + 1)
engine.stop()
const stopped = updates
await Bun.sleep(140)
assert.equal(updates, stopped)
engine.dispose()
const disposed_frames = requested_frames
document.dispatchEvent(new Event('visibilitychange'))
assert.equal(requested_frames, disposed_frames)
console.log('renderer background passed')
