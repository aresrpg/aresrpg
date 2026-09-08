// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Browser-only fault probe: actual GPU adapter and production backend, no quality/performance assertions.

import { WebGPUBackend, type Renderer } from 'three/webgpu'

import { create_webgpu_backend } from '../src/webgpu_backend.ts'
import type { EngineIssue, RenderChunkRequest } from '../src/types.ts'
import { BIOME_SLOTS, type WorldRecipe } from '../src/world_recipe.ts'

export const LIFECYCLE_WORLD: WorldRecipe = {
  seed: 'lifecycle-probe',
  sea_level: 0,
  materials: { stone: { color: '#777777', preset: 'stone' } },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'plain'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'plain',
      landscape: [
        { x: 0, y: 1, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
        { x: 1, y: 1 },
      ],
    },
  ],
}

export const probe_backend_lifetime = async (canvas: HTMLCanvasElement) => {
  const maps: Map<unknown, unknown>[] = []
  const native_map = globalThis.Map
  const original_init = WebGPUBackend.prototype.init
  let renderer: Renderer | null = null
  const issues: EngineIssue[] = []
  globalThis.Map = new Proxy(native_map, {
    construct: (target, args) => {
      const map = Reflect.construct(target, args) as Map<unknown, unknown>
      maps.push(map)
      return map
    },
  })
  WebGPUBackend.prototype.init = new Proxy(original_init, {
    apply: (target, receiver, args) => {
      renderer = args[0] as Renderer
      return Reflect.apply(target, receiver, args)
    },
  })
  const backend = await create_webgpu_backend(canvas, 'low', LIFECYCLE_WORLD, (issue) => {
    if (issue) issues.push(issue)
  }).finally(() => {
    globalThis.Map = native_map
    WebGPUBackend.prototype.init = original_init
  })
  const request = (key: string): RenderChunkRequest => ({ key, coordinate: { x: 0, y: 0, z: 0 }, lod: 'far' })
  try {
    const removed = Array.from({ length: 2_000 }, (_, index) => {
      const key = `lifetime-probe-${index}`
      const pending = backend.render_chunk(request(key))
      backend.remove_chunk(key)
      return pending
    })
    const outcomes = await Promise.all(removed)
    const retained = maps.reduce(
      (count, map) =>
        count + [...map.keys()].filter((key) => typeof key === 'string' && key.startsWith('lifetime-probe-')).length,
      0
    )
    const first = backend.render_chunk(request('lifetime-probe-recreated'))
    backend.remove_chunk('lifetime-probe-recreated')
    let recreated: string | null = null
    const latest = backend.render_chunk(request('lifetime-probe-recreated')).then((value) => {
      recreated = value
    })
    const deadline = performance.now() + 15_000
    while (!recreated && performance.now() < deadline) {
      backend.render(performance.now())
      await new Promise(requestAnimationFrame)
    }
    if (!recreated) throw new Error('Recreated chunk did not settle')
    await latest
    const active_renderer = renderer as Renderer | null
    if (!active_renderer) throw new Error('Renderer was not captured at its backend boundary')
    active_renderer.onDeviceLost({
      api: 'WebGPU',
      message: 'injected device loss',
      reason: 'unknown',
      originalEvent: null,
    } as never)
    return {
      removed: outcomes.every((outcome) => outcome === 'removed'),
      retained,
      previous: await first,
      recreated,
      bookkeeping: Reflect.get(active_renderer, '_isDeviceLost') === true,
      reported_loss: issues.some(({ code }) => code === 'webgpu_device_lost'),
    }
  } finally {
    backend.dispose()
  }
}
