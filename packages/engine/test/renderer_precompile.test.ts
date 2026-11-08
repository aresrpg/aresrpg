// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import SourceRenderer from 'three/src/renderers/common/Renderer.js'
import { mrt } from 'three/tsl'
import { Mesh, PerspectiveCamera, Renderer, RenderTarget, Scene } from 'three/webgpu'

// Exercise the actual compileAsync owner; only GPU/cache boundaries are replaced.
const create_compile_renderer = (prototype: Renderer, build = () => Promise.resolve()) => {
  const update = () => {}
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const mesh = new Mesh()
  const context = { clippingContext: { updateGlobal: update } }
  const renderer = Object.assign(Object.create(prototype), {
    _initialized: true,
    _callDepth: 0,
    _precompilationState: null,
    _currentRenderContext: null,
    _compilationPromises: null,
    opaque: true,
    transparent: true,
    shadowMap: {},
    xr: { isPresenting: false },
    drawingPipeline: {
      prepareAsync: update,
      begin: update,
      beginRenderList: update,
      project: () =>
        Reflect.apply(Reflect.get(renderer, '_createObjectPipeline'), renderer, [
          mesh,
          mesh.material,
          scene,
          camera,
          null,
          null,
          context.clippingContext,
        ]),
      finishRenderList: update,
    },
    _renderContexts: { get: () => context },
    _renderLists: { get: () => ({ opaque: [], transparent: [] }) },
    _textures: { updateRenderTarget: update, get: () => ({ textures: [], depthTexture: null }) },
    _nodes: {
      nodeFrame: { renderId: 0, update },
      getForRenderAsync: build,
      updateBefore: update,
      updateForRender: update,
      updateAfter: update,
    },
    _objects: { get: () => ({}) },
    _geometries: { updateForRender: update },
    _bindings: { updateForRender: update },
    _pipelines: { getForRender: update },
    _background: { update },
    _updateCamera: () => camera,
  }) as Renderer
  Object.defineProperty(renderer, 'needsFrameBufferTarget', { value: false })
  renderer.setRenderTarget(null)
  renderer.setMRT(null)
  return { renderer, scene, camera }
}

// Three r187 leaks compileAsync state across its first await and concurrent calls, then
// restores a stale target on resume. Spell warmup leaves the world in a depthless 2×2 target.
// Keep the patch until upstream passes these regressions and the renderer/spell browser
// checks without it. Cover both source imports and the distribution consumed by gameplay.
describe.each([
  ['source', SourceRenderer.prototype],
  ['webgpu distribution', Renderer.prototype],
] as const)('%s precompilation', (_, prototype) => {
  test('the caller can restore its target immediately after compileAsync starts', async () => {
    const { renderer, scene, camera } = create_compile_renderer(prototype)
    const mask = new RenderTarget(2, 2, { depthBuffer: false })
    renderer.setRenderTarget(mask)
    const pending = renderer.compileAsync(scene, camera)
    renderer.setRenderTarget(null)
    await pending
    expect(renderer.getRenderTarget()).toBeNull()
    expect(Reflect.get(renderer, '_callDepth')).toBe(0)
    mask.dispose()
  })

  test('concurrent compilations do not overwrite each other’s active state', async () => {
    const { renderer, scene, camera } = create_compile_renderer(prototype)
    await Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(scene, camera)])
    expect(renderer.getRenderTarget()).toBeNull()
    expect(Reflect.get(renderer, '_callDepth')).toBe(0)
    expect(Reflect.get(renderer, '_precompilationState')).toBeNull()
  })

  test('nested scene collection preserves an active compiler state', async () => {
    let following: Promise<void> | undefined
    let attempts = 0
    const { renderer, scene, camera } = create_compile_renderer(prototype, () => {
      if (++attempts === 1) following = renderer.compileAsync(scene, camera)
      return Promise.resolve()
    })
    await renderer.compileAsync(scene, camera)
    expect(following).toBeDefined()
    await following
    expect(Reflect.get(renderer, '_callDepth')).toBe(0)
    expect(Reflect.get(renderer, '_precompilationState')).toBeNull()
  })

  test('queued CPU work does not wait for another compilation’s GPU pipelines', async () => {
    const gpu = Promise.withResolvers<void>()
    const second_started = Promise.withResolvers<void>()
    let builds = 0
    let pipelines = 0
    const { renderer, scene, camera } = create_compile_renderer(prototype, () => {
      if (++builds === 2) second_started.resolve()
      return Promise.resolve()
    })
    Reflect.set(renderer, '_pipelines', {
      getForRender: (_object: unknown, promises: Promise<void>[]) => {
        if (++pipelines === 1) promises.push(gpu.promise)
      },
    })
    const first = renderer.compileAsync(scene, camera)
    const second = renderer.compileAsync(scene, camera)
    try {
      await second_started.promise
      expect(builds).toBe(2)
    } finally {
      gpu.resolve()
      await Promise.all([first, second])
    }
    expect(Reflect.get(renderer, '_callDepth')).toBe(0)
  })

  test('a rejected build restores state and releases the following compilation', async () => {
    let attempts = 0
    const { renderer, scene, camera } = create_compile_renderer(prototype, () =>
      ++attempts === 1 ? Promise.reject(new Error('build failed')) : Promise.resolve()
    )
    const mask = new RenderTarget(2, 2, { depthBuffer: false })
    renderer.setRenderTarget(mask)
    const failed = renderer.compileAsync(scene, camera)
    renderer.setRenderTarget(null)
    const following = renderer.compileAsync(scene, camera)
    await expect(failed).rejects.toThrow('build failed')
    await following
    expect(renderer.getRenderTarget()).toBeNull()
    expect(Reflect.get(renderer, '_callDepth')).toBe(0)
    expect(Reflect.get(renderer, '_precompilationState')).toBeNull()
    mask.dispose()
  })

  test('each resumed compile slice restores the caller target, attachment and context state', async () => {
    // Only renderer state is needed: use the real methods without opening a GPU device.
    const renderer = Object.create(prototype) as Renderer
    const mask = new RenderTarget(2, 2, { depthBuffer: false })
    const other_target = new RenderTarget(8, 8)
    const compile_context = {}
    const state = {
      useFrameBufferTarget: true,
      renderTarget: mask,
      outputRenderTarget: mask,
      activeCubeFace: 0,
      activeMipmapLevel: 0,
      mrt: null,
      outputMRT: null,
      renderContext: compile_context,
      item: null,
    }
    Reflect.set(renderer, '_callDepth', 0)
    Reflect.set(renderer, '_precompilationState', null)
    for (const target of [null, other_target, null]) {
      // The caller restored its target after starting compilation or while it yielded.
      const outside_context = {}
      const outside_mrt = target === null ? null : mrt({})
      const face = target === null ? 0 : 3
      const mip = target === null ? 0 : 2
      renderer.setRenderTarget(target, face, mip)
      renderer.setMRT(outside_mrt)
      Reflect.set(renderer, '_currentRenderContext', outside_context)
      await Promise.resolve()
      Reflect.apply(Reflect.get(renderer, '_beginPreCompile'), renderer, [state])
      expect(renderer.getRenderTarget()).toBe(mask)
      expect(renderer.getMRT()).toBeNull()
      expect(Reflect.get(renderer, '_currentRenderContext')).toBe(compile_context)
      expect(Reflect.get(renderer, '_callDepth')).toBe(1)
      Reflect.apply(Reflect.get(renderer, '_finishPreCompile'), renderer, [])
      expect(renderer.getRenderTarget()).toBe(target)
      expect(renderer.getActiveCubeFace()).toBe(face)
      expect(renderer.getActiveMipmapLevel()).toBe(mip)
      expect(outside_mrt).toBe(renderer.getMRT())
      expect(Reflect.get(renderer, '_currentRenderContext')).toBe(outside_context)
      expect(Reflect.get(renderer, '_callDepth')).toBe(0)
      expect(Reflect.get(renderer, '_precompilationState')).toBeNull()
    }
    mask.dispose()
    other_target.dispose()
  })
})
