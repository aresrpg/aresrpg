// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { Bone, Group, LinearMipmapLinearFilter, NearestFilter, Texture } from 'three'

import { compose_pixels, find_character_bone, mount_character_part } from '../src/character_model.ts'
import { prepare_pixel_texture } from '../src/model_texture.ts'

describe('character model legacy contract', () => {
  test('the shared entity loader installs Draco for the shipped character assets', () => {
    const source = readFileSync(new URL('../src/gltf_loader.ts', import.meta.url), 'utf8')
    expect(source).toContain("from 'three/addons/loaders/DRACOLoader.js'")
    expect(source).toContain('new GLTFLoader().setDRACOLoader(draco)')
  })

  test('finds namespaced Head and cape bones by case-insensitive substring', () => {
    const body = new Group()
    const head = new Bone()
    head.name = 'mixamorig:Head'
    const cape = new Bone()
    cape.name = 'Rig_CAPE_anchor'
    body.add(head, cape)

    expect(find_character_bone(body, 'head')).toBe(head)
    expect(find_character_bone(body, 'cape')).toBe(cape)
  })

  test('a hat mounts on Head and suppresses hair without deleting it', () => {
    const body = new Group()
    const head = new Bone()
    head.name = 'mixamorig:Head'
    const hair = new Group()
    const hat = new Group()
    head.add(hair)
    body.add(head)

    expect(mount_character_part({ body, part: hat, slot: 'head', hair })).toBeTrue()
    expect(hair.visible).toBeFalse()
    expect(hair.parent).toBe(head)
    expect(hat.parent).toBe(head)
  })

  test('a cloak mounts on cape with the exact legacy pi flip', () => {
    const body = new Group()
    const cape = new Bone()
    cape.name = 'cape'
    const cloak = new Group()
    body.add(cape)

    expect(mount_character_part({ body, part: cloak, slot: 'back', hair: null })).toBeTrue()
    expect(cloak.parent).toBe(cape)
    expect(cloak.rotation.x).toBe(Math.PI)
  })

  test('recolors an opaque mask with the legacy alpha blend and preserves alpha', () => {
    const result = compose_pixels(
      new Uint8ClampedArray([100, 80, 60, 123]),
      new Uint8ClampedArray([200, 100, 50, 255]),
      [0.5, 1, 0]
    )
    expect([...result]).toEqual([100, 100, 0, 123])
  })

  test('uses crisp magnification and mipmapped minification for every entity texture', () => {
    const texture = new Texture()

    prepare_pixel_texture(texture)

    expect(texture.magFilter).toBe(NearestFilter)
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
    expect(texture.generateMipmaps).toBeTrue()
    expect(texture.anisotropy).toBe(8)
    expect(texture.version).toBeGreaterThan(0)
  })
})
