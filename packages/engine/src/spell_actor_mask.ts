// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Color, DoubleSide, NearestFilter, Scene, type Camera, type Object3D } from 'three'
import { MeshBasicNodeMaterial, RenderTarget, type Renderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'

/** Borrow the live actors as a draw list; Three retains geometry, pose and skinning ownership. */
export const create_spell_actor_mask = (renderer: Renderer, camera: Camera) => {
  const scene = new Scene()
  scene.matrixWorldAutoUpdate = false
  scene.background = new Color(0)
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, side: DoubleSide })
  material.name = 'spell_actor_mask'
  material.fragmentNode = vec4(1)
  scene.overrideMaterial = material
  const target = new RenderTarget(1, 1, { depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter })
  const bind = (roots: readonly Object3D[]) => {
    scene.children = [...roots]
  }
  const render = (roots: readonly Object3D[], width: number, height: number): void => {
    bind(roots)
    target.setSize(width, height)
    const previous = renderer.getRenderTarget()
    const auto_clear = renderer.autoClear
    renderer.setRenderTarget(target)
    renderer.autoClear = true
    try {
      renderer.render(scene, camera)
    } finally {
      renderer.setRenderTarget(previous)
      renderer.autoClear = auto_clear
    }
  }
  return {
    target,
    prepare: async (roots: readonly Object3D[]): Promise<void> => {
      bind(roots)
      const previous = renderer.getRenderTarget()
      renderer.setRenderTarget(target)
      const compiled = renderer.compileAsync(scene, camera)
      renderer.setRenderTarget(previous)
      await compiled
    },
    render,
    dispose: (): void => {
      scene.children = []
      material.dispose()
      target.dispose()
    },
  }
}
