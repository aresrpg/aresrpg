// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Matrix4, PerspectiveCamera } from 'three'

import { FRAGMENT } from '../src/generated/claude_spell_game_fragment.js'
import { create_source } from '../src/generated/claude_spell_source.js'
import { create_spell_gl, type SpellUniforms } from '../src/claude_spell_gl.ts'

import reference from './fixtures/spell_game_shader.json'

/** Compare the generated gameplay artifact with the captured pre-cleanup integration, not itself. */
export const create_spell_fidelity_probe = async (urls: readonly string[]) => {
  const renderers = await Promise.all([create_spell_gl(reference.fragment), create_spell_gl(FRAGMENT)])
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
  return (classe: string, name: string, seconds: number) => {
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
    const left = pixels(0, uniforms),
      right = pixels(1, uniforms)
    let maximum = 0,
      changed = 0
    for (let index = 0; index < left.length; index += 1) {
      const difference = Math.abs(left[index]! - right[index]!)
      maximum = Math.max(maximum, difference)
      changed += Number(difference > 0)
    }
    return { maximum, changed }
  }
}
