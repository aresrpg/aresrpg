// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { AnimationClip, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, VectorKeyframeTrack } from 'three'

import { compose_pixels, find_character_bone, mount_character_part } from '../src/character_model.ts'
import { prepare_mob_model_root } from '../src/mob_model.ts'

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

  test('preserves authored character samplers while creatures keep their pixel-art policy', () => {
    const character_source = readFileSync(new URL('../src/character_model.ts', import.meta.url), 'utf8')
    const mob_source = readFileSync(new URL('../src/mob_model.ts', import.meta.url), 'utf8')

    expect(character_source).not.toContain('prepare_pixel_texture')
    expect(mob_source).toContain('prepare_pixel_texture')
  })
})

describe('mob model preparation', () => {
  test('grounds an animated mob from its idle pose instead of its authored rest pose', () => {
    const root = new Group()
    const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    body.name = 'Body'
    body.position.y = -2
    root.add(body)
    const idle = new AnimationClip('IDLE', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 0, 0, 0])])

    const min_y = prepare_mob_model_root(root, [idle], 'offset fixture')

    expect(body.position.y).toBe(0)
    expect(min_y).toBeCloseTo(-0.25)
  })
})
