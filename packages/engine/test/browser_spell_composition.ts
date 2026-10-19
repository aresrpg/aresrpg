// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  NoToneMapping,
  PerspectiveCamera,
} from 'three'
import { MeshBasicNodeMaterial, QuadMesh, WebGPURenderer } from 'three/webgpu'
import { screenUV, texture } from 'three/tsl'

import { create_source } from '../src/generated/claude_spell_source.js'
import { create_spell_effect_pass } from '../src/spell_effect_pass.ts'

/** Compare one overlapping batch against two independently composed casts on the same world. */
export const compare_spell_composition = async (urls: readonly string[]) => {
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
  const map = new CanvasTexture(background)
  map.flipY = false
  map.generateMipmaps = false
  map.minFilter = map.magFilter = LinearFilter
  const renderer = new WebGPURenderer({ antialias: false })
  await renderer.init()
  renderer.setSize(width, height, false)
  renderer.toneMapping = NoToneMapping
  renderer.outputColorSpace = LinearSRGBColorSpace
  const material = new MeshBasicNodeMaterial({ toneMapped: false })
  material.fragmentNode = texture(map, screenUV)
  const world = new QuadMesh(material)
  const effects = create_spell_effect_pass(renderer)
  const mask = new DataTexture(new Uint8Array(4), 1, 1)
  mask.needsUpdate = true
  const source = create_source()
  const frame = (classe: string, name: string, seconds: number) => {
    source.select(classe, name)
    const authored = source.frame(seconds, width, height)
    const camera = new PerspectiveCamera(30, width / height, 0.1, 100)
    camera.position.fromArray(authored.uCam as readonly number[])
    camera.lookAt(...(authored.uLook as readonly [number, number, number]))
    camera.updateMatrixWorld()
    const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    return {
      uniforms: {
        ...authored,
        aresProjection: projection.elements,
        aresInverseProjection: projection.clone().invert().elements,
        aresLocalToWorld: new Matrix4().elements,
        aresBoard: [-7.5, -3.5, 1, 0],
        aresBoardSize: [15, 7],
        aresVerticalScale: camera.projectionMatrix.elements[5]! / 2,
        aresSpotCount: 0,
      },
      cells: new Uint8Array(15 * 7 * 4).fill(255),
      width: 15,
      height: 7,
    }
  }
  const frames = [frame('yogan', 'Magic Arrow', 0.9), frame('yajin', 'Deviousness', 1.2)]
  const copy = document.createElement('canvas')
  copy.width = width
  copy.height = height
  const pixels = copy.getContext('2d')!
  const read = () => {
    pixels.drawImage(renderer.domElement, 0, 0)
    return pixels.getImageData(0, 0, width, height).data
  }
  try {
    effects.resize(2, 2)
    await effects.prepare(urls, frames, mask)
    effects.resize(width, height)
    world.render(renderer)
    const before = read()
    effects.render(mask, frames)
    const batch = read()
    world.render(renderer)
    frames.forEach((cast) => effects.render(mask, [cast]))
    const sequential = read()
    let maximum = 0,
      changed = 0
    for (let index = 0; index < batch.length; index += 1) {
      maximum = Math.max(maximum, Math.abs(batch[index]! - sequential[index]!))
      changed += Number(batch[index] !== before[index])
    }
    return { maximum, changed }
  } finally {
    effects.dispose()
    mask.dispose()
    map.dispose()
    material.dispose()
    renderer.dispose()
  }
}
