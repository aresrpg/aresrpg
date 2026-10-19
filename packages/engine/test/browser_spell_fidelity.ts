// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  Matrix4,
  NoToneMapping,
  LinearSRGBColorSpace,
  PerspectiveCamera,
  TextureLoader,
} from 'three'
import { WebGPURenderer, QuadMesh, RenderTarget } from 'three/webgpu'

import { create_spell_effect_material } from '../src/spell_effect_material.ts'
import { create_source } from '../src/generated/claude_spell_source.js'

import { create_spell_gl, type SpellUniforms } from './fixtures/spell_gl_reference.ts'
import reference from './fixtures/spell_game_shader.json'

const display_colors = (overlay: Uint8Array, background: Uint8ClampedArray): Float32Array =>
  new Float32Array((overlay.length / 4) * 3).map((_, index) => {
    const pixel = Math.floor(index / 3) * 4
    const channel = index % 3
    const alpha = overlay[pixel + 3]! / 255
    return overlay[pixel + channel]! * alpha + background[pixel + channel]! * (1 - alpha)
  })

const pixel_difference = (left: Float32Array, right: Float32Array) => {
  let total = 0,
    maximum = 0,
    changed = 0
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index]! - right[index]!)
    total += delta
    maximum = Math.max(maximum, delta)
    changed += Number(delta > 8)
  }
  return { mean: total / left.length, maximum, changed }
}

/** Compare the generated gameplay artifact with the captured pre-cleanup integration, not itself. */
export const create_spell_fidelity_probe = async (urls: readonly string[]) => {
  const renderers = [await create_spell_gl(reference.fragment)]
  await Promise.all(renderers.map((renderer) => renderer.prepare(urls)))
  const width = 320,
    height = 224
  const background = document.createElement('canvas')
  background.width = width
  background.height = height
  const context = background.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#384c69')
  gradient.addColorStop(1, '#b6a076')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  const cells = new Uint8Array(15 * 7 * 4).fill(255)
  const masks = renderers.map((renderer) => {
    renderer.resize(width, height)
    const { gl } = renderer
    const mask = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, mask)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      2,
      2,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255])
    )
    return mask
  })
  const pixels = (index: number, uniforms: SpellUniforms) => {
    const renderer = renderers[index]!
    renderer.render(background, masks[index]!, [{ uniforms, cells, width: 15, height: 7 }])
    const bytes = new Uint8Array(width * height * 4)
    renderer.gl.readPixels(0, 0, width, height, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, bytes)
    if (renderer.gl.getError() !== renderer.gl.NO_ERROR) throw new Error('Shader fidelity GL error')
    return bytes
  }
  const renderer = new WebGPURenderer({ antialias: false })
  await renderer.init()
  renderer.toneMapping = NoToneMapping
  renderer.outputColorSpace = LinearSRGBColorSpace
  const target = new RenderTarget(width, height, { depthBuffer: false })
  const atlas = await Promise.all(urls.map((url) => new TextureLoader().loadAsync(url)))
  atlas.forEach((map) => {
    map.generateMipmaps = false
    map.minFilter = map.magFilter = LinearFilter
  })
  const scene = new CanvasTexture(background)
  scene.flipY = false
  scene.generateMipmaps = false
  scene.minFilter = scene.magFilter = LinearFilter
  const board = new DataTexture(cells, 15, 7)
  board.needsUpdate = true
  const mask = new DataTexture(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 2, 2)
  mask.needsUpdate = true
  const native = create_spell_effect_material({
    uSw: atlas[0]!,
    uIc: atlas[1]!,
    uRj: atlas[2]!,
    uPr: atlas[3]!,
    aresScene: scene,
    aresOriginal: scene,
    aresActors: mask,
    aresCells: board,
  })
  const quad = new QuadMesh(native.material)
  renderer.setRenderTarget(target)
  await renderer.compileAsync(quad, quad.camera)
  return async (classe: string, name: string, seconds: number, verify_overlay = false) => {
    const source = create_source()
    source.select(classe, name)
    const frame = source.frame(seconds, width, height)
    const camera = new PerspectiveCamera(30, width / height, 0.1, 100)
    camera.position.fromArray(frame.uCam as readonly number[])
    camera.lookAt(...(frame.uLook as readonly [number, number, number]))
    camera.updateMatrixWorld()
    const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const uniforms: SpellUniforms = {
      ...frame,
      aresProjection: projection.elements,
      aresInverseProjection: projection.clone().invert().elements,
      aresLocalToWorld: new Matrix4().elements,
      aresBoard: [-7.5, -3.5, 1, 0],
      aresBoardSize: [15, 7],
      aresVerticalScale: camera.projectionMatrix.elements[5]! / 2,
      aresSpotCount: 3,
      aresSpots: [0, 0, 0, 1, 0, 0, 0, 0, 1, ...new Array<number>(12).fill(0)],
    }
    const bottom_up = pixels(0, uniforms)
    const left = new Uint8Array(bottom_up.length)
    for (let row = 0; row < height; row += 1)
      left.set(bottom_up.subarray(row * width * 4, (row + 1) * width * 4), (height - 1 - row) * width * 4)
    native.update({ ...uniforms, aresComposite: 1 })
    quad.render(renderer)
    const right = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Uint8Array
    const background_pixels = context.getImageData(0, 0, width, height).data
    const colors = display_colors(right, background_pixels)
    const difference = pixel_difference(display_colors(left, background_pixels), colors)
    let overlay_maximum: number | null = null
    if (verify_overlay) {
      native.update({ ...uniforms, aresComposite: 0 })
      quad.render(renderer)
      const composited = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Uint8Array
      overlay_maximum = pixel_difference(display_colors(composited, background_pixels), colors).maximum
    }
    return {
      composite_mean: difference.mean,
      composite_maximum: difference.maximum,
      composite_changed: difference.changed,
      overlay_maximum,
    }
  }
}
