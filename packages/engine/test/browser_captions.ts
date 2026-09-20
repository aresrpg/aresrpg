// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AgXToneMapping, Color, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { RenderPipeline, Renderer, StandardNodeLibrary, WebGPUBackend } from 'three/webgpu'
import { pass } from 'three/tsl'

import { create_caption_layer } from '../src/caption_layer.ts'
import type { WorldCaption } from '../src/caption_types.ts'

export const probe_captions = async (canvas: HTMLCanvasElement, kind: 'grid' | 'webgpu') => {
  canvas.style.width = '320px'
  canvas.style.height = '180px'
  const renderer =
    kind === 'webgpu'
      ? new Renderer(new WebGPUBackend({ canvas }), {})
      : new WebGLRenderer({ canvas, preserveDrawingBuffer: true })
  if (renderer instanceof Renderer) {
    renderer.library = new StandardNodeLibrary()
    await renderer.init()
  }
  renderer.setSize(320, 180, false)
  renderer.toneMapping = AgXToneMapping
  renderer.outputColorSpace = SRGBColorSpace
  const scene = new Scene()
  scene.background = new Color('#254872')
  const camera = new PerspectiveCamera(60, 320 / 180, 0.1, 100)
  camera.position.z = 10
  camera.updateMatrixWorld()
  const pipeline =
    renderer instanceof Renderer ? new RenderPipeline(renderer, pass(scene, camera).getTextureNode()) : null
  // Both concrete renderers expose the same overlay operations; retain their native target type.
  const captions =
    renderer instanceof Renderer
      ? create_caption_layer({ renderer, canvas, camera, webgpu: true })
      : create_caption_layer({ renderer, canvas, camera, webgpu: false })
  const read = document.createElement('canvas')
  read.width = 320
  read.height = 180
  const context = read.getContext('2d')!
  const pixels = () => {
    context.drawImage(canvas, 0, 0)
    return context.getImageData(0, 0, 320, 180).data
  }
  const pixel = (data: Uint8ClampedArray, x: number, y: number) => [
    ...data.slice((y * 320 + x) * 4, (y * 320 + x) * 4 + 4),
  ]
  const frame = async () => {
    await new Promise(requestAnimationFrame)
    if (pipeline) pipeline.render()
    else renderer.render(scene, camera)
    captions.render()
  }
  const settle = async () => {
    for (let index = 0; index < 6; index++) await frame()
  }
  try {
    await settle()
    const background = pixel(pixels(), 8, 8)
    const anchor = new Vector3()
    const caption: WorldCaption = {
      name: 'CAPTION HEALTH',
      speech: '<script> 中文 한국어 tiếng Việt 👨‍👩‍👧‍👦',
      health: { fraction: 1, color: '#00ff00' },
    }
    captions.set('test', caption, () => anchor)
    await settle()
    const full = pixels()
    const before = captions.stats()
    const image = canvas.toDataURL('image/png')
    const semantics = [...canvas.parentElement!.querySelectorAll('[role="listitem"]')].map(
      (element) => element.textContent
    )
    captions.set('test', { ...caption, health: { fraction: 0.25, color: '#00ff00' } }, () => anchor)
    await settle()
    const reduced = pixels()
    let recovered_health: number[] | null = null
    if (renderer instanceof WebGLRenderer) {
      const extension = renderer.getContext().getExtension('WEBGL_lose_context')!
      const lost = new Promise<void>((resolve) =>
        canvas.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault()
            resolve()
          },
          { once: true }
        )
      )
      extension.loseContext()
      await lost
      await new Promise((resolve) => setTimeout(resolve, 100))
      const restored = new Promise<void>((resolve) =>
        canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
      )
      extension.restoreContext()
      await restored
      captions.set('test', caption, () => anchor)
      await settle()
      recovered_health = pixel(pixels(), 200, 71)
    }
    const after = captions.stats()
    captions.set('test', null, () => null)
    await settle()
    const clean = pixel(pixels(), 160, 71)
    return {
      recovered_health,
      background,
      retained: pixel(full, 8, 8),
      full_health: pixel(full, 200, 71),
      reduced_health: pixel(reduced, 200, 71),
      clean,
      before,
      after,
      disposed_labels: captions.stats(),
      semantics,
      scripts: canvas.parentElement!.querySelectorAll('script').length,
      image,
      restored:
        renderer.autoClear && renderer.toneMapping === AgXToneMapping && renderer.outputColorSpace === SRGBColorSpace,
    }
  } finally {
    captions.dispose()
    pipeline?.dispose()
    renderer.dispose()
  }
}
