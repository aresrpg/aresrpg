// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import { AnimationClip, Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture, VectorKeyframeTrack } from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

import * as sources from '../src/gltf_loader.ts'
import { create_character_model } from '../src/character_model.ts'
import { create_mob_model } from '../src/mob_model.ts'

const source = (root: Group, animations: AnimationClip[] = []) => ({ scene: root, animations }) as GLTF

test('characters read shared source pixels once while keeping recolored textures independent', async () => {
  const document_before = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const image_data_before = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
  let reads = 0
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        const canvas: { pixels?: Uint8ClampedArray; getContext?: () => unknown } = {}
        canvas.getContext = () => ({
          drawImage: () => {},
          getImageData: () => {
            reads += 1
            return { data: new Uint8ClampedArray([200, 100, 50, 255]), width: 1, height: 1 }
          },
          putImageData: (image: { data: Uint8ClampedArray }) => {
            canvas.pixels = image.data
          },
        })
        return canvas
      },
    },
  })
  Object.defineProperty(globalThis, 'ImageData', {
    configurable: true,
    value: function image_data(data: Uint8ClampedArray) {
      return { data }
    },
  })
  const root = new Group()
  for (const suffix of ['base', 'color1', 'color2', 'color3']) {
    const map = new Texture({ width: 1, height: 1 })
    map.name = `body_${suffix}`
    root.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial({ map })))
  }
  const load = spyOn(sources, 'load_gltf_source').mockResolvedValue(source(root))
  const bounds = spyOn(Box3.prototype, 'setFromObject')
  const appearance = {
    body_url: 'body.glb',
    hair_url: null,
    colors: ['#ff0000', '#ff0000', '#ff0000'] as const,
    worn: { head: null, back: null },
  }
  try {
    const first = await create_character_model(appearance)
    const second = await create_character_model({ ...appearance, colors: ['#0000ff', '#0000ff', '#0000ff'] })
    expect(reads).toBe(4)
    expect(bounds).toHaveBeenCalledTimes(2)
    const first_map = ((first.root.children[0] as Mesh).material as MeshBasicMaterial).map!
    const second_map = ((second.root.children[0] as Mesh).material as MeshBasicMaterial).map!
    expect(first_map).not.toBe(second_map)
    expect((first_map.image as { pixels: Uint8ClampedArray }).pixels).not.toEqual(
      (second_map.image as { pixels: Uint8ClampedArray }).pixels
    )
    expect([...(first_map.image as { pixels: Uint8ClampedArray }).pixels]).toEqual([200, 0, 0, 255])
    expect([...(second_map.image as { pixels: Uint8ClampedArray }).pixels]).toEqual([0, 0, 50, 255])
    const second_dispose = spyOn(second_map, 'dispose')
    first.dispose()
    expect(second_dispose).not.toHaveBeenCalled()
    second.dispose()
    expect(second_dispose).toHaveBeenCalledTimes(1)
    second_dispose.mockRestore()
  } finally {
    load.mockRestore()
    bounds.mockRestore()
    if (document_before) Object.defineProperty(globalThis, 'document', document_before)
    else Reflect.deleteProperty(globalThis, 'document')
    if (image_data_before) Object.defineProperty(globalThis, 'ImageData', image_data_before)
    else Reflect.deleteProperty(globalThis, 'ImageData')
  }
})

test('creatures reuse idle grounding measurements without sharing pose or material state', async () => {
  const root = new Group()
  const body = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial())
  body.name = 'Body'
  body.position.y = -5
  root.add(body)
  const idle = new AnimationClip('IDLE', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 1, 0, 0, 1, 0])])
  const load = spyOn(sources, 'load_gltf_source').mockResolvedValue(source(root, [idle]))
  const union = spyOn(Box3.prototype, 'union')
  try {
    const first = await create_mob_model('creature.glb')
    const second = await create_mob_model('creature.glb')
    expect(union).toHaveBeenCalledTimes(1)
    expect(first.min_y).toBe(0)
    expect(second.min_y).toBe(first.min_y)
    expect(second.root.children[0]!.position.y).toBe(1)
    first.root.children[0]!.position.y = 10
    expect(second.root.children[0]!.position.y).toBe(1)
    expect((first.root.children[0] as Mesh).material).not.toBe((second.root.children[0] as Mesh).material)
    const other_root = new Group()
    const other_body = new Mesh(new BoxGeometry(1, 6, 1), new MeshBasicMaterial())
    other_body.name = 'Body'
    other_root.add(other_body)
    load.mockResolvedValue(source(other_root, [idle]))
    const other = await create_mob_model('other-creature.glb')
    expect(other.min_y).toBe(-2)
    expect(union).toHaveBeenCalledTimes(2)
    other.dispose()
    first.dispose()
    second.dispose()
  } finally {
    union.mockRestore()
    load.mockRestore()
  }
})
