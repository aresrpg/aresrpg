// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import {
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  type InstancedMesh,
  type InterleavedBufferAttribute,
} from 'three'

import { character_crowd_key, create_character_crowd_layer, is_character_crowd_spec } from '../src/character_crowd.ts'
import type { CharacterAppearanceRender, CharacterEntityRender } from '../src/types.ts'

const appearance = (colors: readonly [string, string, string]): CharacterAppearanceRender =>
  Object.freeze({
    body_url: '/senshi.glb',
    hair_url: '/senshi_hair.glb',
    colors,
    worn: Object.freeze({ head: null, back: null }),
  })

const character = (id: string, x: number, colors: readonly [string, string, string]): CharacterEntityRender =>
  Object.freeze({
    id,
    kind: 'character',
    presentation: 'crowd',
    appearance: appearance(colors),
    anchor: Object.freeze({ kind: 'world', position: Object.freeze([x, 2, 3] as const) }),
    facing: Object.freeze({ kind: 'yaw', yaw: x }),
    animation: Object.freeze({ name: 'IDLE', time_scale: 1 }),
  })

const model = () => {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial({ color: 0xffffff })))
  return Object.freeze({
    root,
    clips: Object.freeze([]),
    min_y: 0,
    set_colors: () => undefined,
    dispose: () => undefined,
  })
}

const attached_model = () => {
  const root = new Group()
  const body = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial())
  body.name = 'body'
  const body_detail = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial())
  body_detail.name = 'body_detail'
  root.add(body, body_detail)
  const head = new Bone()
  head.position.y = 1
  const hair = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
  hair.name = 'hair'
  head.add(hair)
  root.add(head)
  return Object.freeze({
    root,
    clips: Object.freeze([]),
    min_y: 0,
    set_colors: () => undefined,
    dispose: () => undefined,
  })
}

test('crowd identity ignores colors but separates animation and topology', () => {
  const first = character('0xa', 0, ['#ff0000', '#00ff00', '#0000ff'])
  const recolored = character('0xb', 1, ['#ffffff', '#888888', '#111111'])
  expect(character_crowd_key(first)).toBe(character_crowd_key(recolored))
  expect(character_crowd_key({ ...first, animation: { name: 'RUN', time_scale: 1 } })).not.toBe(
    character_crowd_key(first)
  )
  expect(is_character_crowd_spec(first)).toBeTrue()
  expect(is_character_crowd_spec({ ...first, presentation: 'individual' })).toBeFalse()
})

test('compatible world characters become one skinned instance batch with retained anchors', async () => {
  const scene = new Scene()
  const crowd = create_character_crowd_layer({ scene, load_model: async () => model() })
  crowd.set(
    Object.freeze([
      character('0xa', 0, ['#ff0000', '#00ff00', '#0000ff']),
      character('0xb', 4, ['#ffffff', '#888888', '#111111']),
    ]) as never
  )
  await Promise.resolve()
  await Promise.resolve()

  const meshes: Readonly<{ isInstancedMesh?: boolean; count?: number; geometry?: BoxGeometry }>[] = []
  scene.traverse((object) => {
    if ('isInstancedMesh' in object) meshes.push(object as never)
  })
  expect(crowd.stats()).toEqual({ batches: 1, instances: 2 })
  expect(meshes).toHaveLength(1)
  const first_mesh = meshes[0]!
  expect(first_mesh.count).toBe(2)
  expect(first_mesh.geometry!.getAttribute('crowdColor1').count).toBe(256)
  const color_1 = first_mesh.geometry!.getAttribute('crowdColor1') as InterleavedBufferAttribute
  const color_2 = first_mesh.geometry!.getAttribute('crowdColor2') as InterleavedBufferAttribute
  const color_3 = first_mesh.geometry!.getAttribute('crowdColor3') as InterleavedBufferAttribute
  expect(color_2.data).toBe(color_1.data)
  expect(color_3.data).toBe(color_1.data)
  expect(crowd.world_anchor('0xb')).toMatchObject({ x: 4, y: 4, z: 3 })

  crowd.dispose()
  expect(scene.children).toHaveLength(0)
})

test('rigid hair and equipment retain the shared attachment-bone transform per instance', async () => {
  const scene = new Scene()
  const crowd = create_character_crowd_layer({ scene, load_model: async () => attached_model() })
  crowd.set(Object.freeze([character('0xa', 4, ['#fff', '#fff', '#fff'])]) as never)
  await Promise.resolve()
  await Promise.resolve()

  const hair = scene.getObjectByName('hair')! as InstancedMesh
  const body = scene.getObjectByName('body')! as InstancedMesh
  const body_detail = scene.getObjectByName('body_detail')! as InstancedMesh
  const hair_matrix = hair.instanceMatrix.array
  const body_matrix = body.instanceMatrix.array
  expect(hair.instanceMatrix).not.toBe(body.instanceMatrix)
  expect(body_detail.instanceMatrix).toBe(body.instanceMatrix)
  expect(body_matrix[12]).toBe(4)
  expect(body_matrix[13]).toBe(2)
  expect(body_matrix[14]).toBe(3)
  expect(hair_matrix[12]).toBe(4)
  expect(hair_matrix[13]).toBe(3)
  expect(hair_matrix[14]).toBe(3)
  crowd.dispose()
})

test('resubmitting identical crowd specs performs no GPU buffer upload', async () => {
  const scene = new Scene()
  const crowd = create_character_crowd_layer({ scene, load_model: async () => model() })
  const spec = character('0xa', 4, ['#fff', '#fff', '#fff'])
  crowd.set(Object.freeze([spec]) as never)
  await Promise.resolve()
  await Promise.resolve()

  const mesh = scene.children[0]!.children[0]!.children[0]! as InstancedMesh
  const { version } = mesh.instanceMatrix
  crowd.set(Object.freeze([spec]) as never)

  expect(mesh.instanceMatrix.version).toBe(version)
  crowd.dispose()
})

test('switching a compatible crowd animation reuses its loaded skinned batch', async () => {
  const scene = new Scene()
  let loads = 0
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => {
      loads += 1
      return model()
    },
  })
  const idle = character('0xa', 4, ['#fff', '#fff', '#fff'])
  crowd.set(Object.freeze([idle]) as never)
  await Promise.resolve()
  await Promise.resolve()

  crowd.set(Object.freeze([{ ...idle, animation: { name: 'RUN', time_scale: 1 } }]) as never)
  await Promise.resolve()
  await Promise.resolve()

  expect(loads).toBe(1)
  expect(scene.children).toHaveLength(1)
  expect(crowd.stats()).toEqual({ batches: 1, instances: 1 })
  crowd.dispose()
})

test('moving a crowd uploads one shared body transform and no unchanged colors', async () => {
  const scene = new Scene()
  const crowd = create_character_crowd_layer({ scene, load_model: async () => attached_model() })
  const spec = character('0xa', 4, ['#fff', '#888', '#111'])
  crowd.set(Object.freeze([spec]) as never)
  await Promise.resolve()
  await Promise.resolve()

  const body = scene.getObjectByName('body')! as InstancedMesh
  const body_detail = scene.getObjectByName('body_detail')! as InstancedMesh
  const hair = scene.getObjectByName('hair')! as InstancedMesh
  const color = body.geometry.getAttribute('crowdColor1') as InterleavedBufferAttribute
  const before = Object.freeze({
    body: body.instanceMatrix.version,
    hair: hair.instanceMatrix.version,
    color: color.data.version,
  })
  crowd.set(
    Object.freeze([
      Object.freeze({
        ...spec,
        anchor: Object.freeze({ kind: 'world', position: Object.freeze([5, 2, 3] as const) }),
      }),
    ]) as never
  )

  expect(body_detail.instanceMatrix).toBe(body.instanceMatrix)
  expect(body.instanceMatrix.version).toBe(before.body + 1)
  expect(hair.instanceMatrix.version).toBe(before.hair + 1)
  expect(body.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }])
  expect(hair.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }])
  expect(color.data.version).toBe(before.color)
  crowd.dispose()
})

test('two hundred compatible characters retain one skeleton batch', async () => {
  const scene = new Scene()
  let loads = 0
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => {
      loads += 1
      return model()
    },
  })
  const characters = Array.from({ length: 200 }, (_, index) =>
    character(`0x${index}`, index, ['#ffffff', '#888888', '#111111'])
  )
  crowd.set(Object.freeze(characters) as never)
  await Promise.resolve()
  await Promise.resolve()

  expect(crowd.stats()).toEqual({ batches: 1, instances: 200 })
  expect(loads).toBe(1)
  crowd.dispose()
})
