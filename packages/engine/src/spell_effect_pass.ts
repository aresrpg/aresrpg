// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  ColorManagement,
  DataTexture,
  FramebufferTexture,
  LinearFilter,
  NearestFilter,
  NoToneMapping,
  TextureLoader,
  type Texture,
} from 'three'
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget, type Renderer } from 'three/webgpu'
import { texture, screenUV, viewportTexture } from 'three/tsl'

import { create_spell_effect_material, type SpellUniforms } from './spell_effect_material.ts'

export type SpellFrame = Readonly<{ uniforms: SpellUniforms; cells: Uint8Array; width: number; height: number }>

/** Same-device scene copy, bounded effect targets, then a full-resolution transparent overlay. */
export const create_spell_effect_pass = (renderer: Renderer) => {
  const original = new FramebufferTexture(1, 1)
  original.minFilter = original.magFilter = LinearFilter
  const snapshot = viewportTexture(screenUV, null, original)
  const capture_material = new MeshBasicNodeMaterial({
    toneMapped: false,
    colorWrite: false,
    depthTest: false,
    depthWrite: false,
  })
  capture_material.name = 'spell_capture'
  capture_material.fragmentNode = snapshot
  const capture = new QuadMesh(capture_material)
  const empty = new DataTexture(new Uint8Array(4), 1, 1)
  empty.minFilter = empty.magFilter = LinearFilter
  empty.needsUpdate = true
  const cells = new DataTexture(new Uint8Array(4), 1, 1)
  cells.minFilter = cells.magFilter = NearestFilter
  cells.needsUpdate = true
  const targets = Array.from({ length: 2 }, () => new RenderTarget(1, 1, { depthBuffer: false }))
  const effect = create_spell_effect_material({
    uSw: empty,
    uIc: empty,
    uRj: empty,
    uPr: empty,
    aresScene: empty,
    aresActors: cells,
    aresCells: cells,
    aresOriginal: original,
  })
  const quad = new QuadMesh(effect.material)
  const overlay = texture(targets[0]!.texture, screenUV)
  const composition = new MeshBasicNodeMaterial({
    toneMapped: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  composition.name = 'spell_overlay'
  composition.fragmentNode = overlay
  const composite = new QuadMesh(composition)
  let atlas: readonly Texture[] = []
  let disposed = false
  const display = <T>(render: () => T): T => {
    const tone_mapping = renderer.toneMapping
    const output_color_space = renderer.outputColorSpace
    const target = renderer.getRenderTarget()
    const auto_clear = renderer.autoClear
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = ColorManagement.workingColorSpace
    try {
      return render()
    } finally {
      renderer.setRenderTarget(target)
      renderer.toneMapping = tone_mapping
      renderer.outputColorSpace = output_color_space
      renderer.autoClear = auto_clear
    }
  }
  const render_frames = (input: Texture, mask: Texture, frames: readonly SpellFrame[]) => {
    effect.set_texture('aresOriginal', input)
    effect.set_texture('aresActors', mask)
    let previous = input
    frames.forEach((frame, index) => {
      if (cells.image.width !== frame.width || cells.image.height !== frame.height) cells.dispose()
      cells.image = { data: frame.cells, width: frame.width, height: frame.height }
      cells.needsUpdate = true
      effect.set_texture('aresScene', previous)
      effect.update({ ...frame.uniforms, aresComposite: Number(index === frames.length - 1) })
      const target = targets[index % 2]!
      renderer.setRenderTarget(target)
      quad.render(renderer)
      previous = target.texture
    })
    return previous
  }
  const render = (mask: Texture, frames: readonly SpellFrame[]): void =>
    display(() => {
      // Three's viewport node copies while the canvas render context is active.
      renderer.autoClear = false
      capture.render(renderer)
      overlay.value = render_frames(snapshot.value, mask, frames)
      renderer.setRenderTarget(null)
      renderer.autoClear = false
      composite.render(renderer)
    })
  return {
    resize: (width: number, height: number): void => {
      targets.forEach((target) => target.setSize(width, height))
    },
    prepare: async (urls: readonly string[], frames: readonly SpellFrame[], mask: Texture): Promise<void> => {
      const loaded = await Promise.all(urls.map((url) => new TextureLoader().loadAsync(url)))
      if (disposed) {
        loaded.forEach((map) => map.dispose())
        return
      }
      atlas = loaded
      atlas.forEach((map, index) => {
        map.generateMipmaps = false
        map.minFilter = map.magFilter = LinearFilter
        effect.set_texture(['uSw', 'uIc', 'uRj', 'uPr'][index]!, map)
      })
      // Distinct semantic inputs must not share Three's initial texture binding.
      effect.set_texture('aresActors', mask)
      effect.update(frames[0]!.uniforms)
      // Compilation and draws use the final target format. Readiness waits on this same device.
      await display(() => {
        renderer.setRenderTarget(targets[0]!)
        return renderer.compileAsync(quad, quad.camera)
      })
      if (disposed) return
      await display(() =>
        Promise.all([
          renderer.compileAsync(capture, capture.camera),
          renderer.compileAsync(composite, composite.camera),
        ])
      )
      if (!disposed) render(mask, frames)
    },
    render,
    dispose: (): void => {
      disposed = true
      atlas.forEach((map) => map.dispose())
      targets.forEach((target) => target.dispose())
      new Set([original, snapshot.value]).forEach((map) => map.dispose())
      capture_material.dispose()
      empty.dispose()
      cells.dispose()
      effect.material.dispose()
      composition.dispose()
    },
  }
}
