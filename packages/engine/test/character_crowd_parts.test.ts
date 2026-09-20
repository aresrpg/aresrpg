// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import {
  AnimationClip,
  VectorKeyframeTrack,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Skeleton,
  SkinnedMesh,
  Vector3,
  Bone,
  BoxGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  type InterleavedBufferAttribute,
} from 'three'

import type { CrowdMesh } from '../src/character_crowd_mesh.ts'
import { create_character_crowd_layer } from '../src/character_crowd.ts'
import { mount_character_part, type CharacterPart } from '../src/character_model.ts'
import type { CharacterEntityRender } from '../src/types.ts'

const body = () => {
  const root = new Group()
  const head = new Bone()
  head.name = 'Head'
  head.position.y = 1
  const cape = new Bone()
  cape.name = 'cape'
  cape.rotation.z = 0.4
  const mesh = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial())
  mesh.name = 'body'
  root.add(mesh, head, cape)
  return { root, clips: [], min_y: 0, set_colors: () => {}, dispose: () => {} }
}
const part = (name: string, disposed: string[]): CharacterPart => {
  const root = new Group()
  const geometry = new BoxGeometry(0.5, 0.5, 0.5)
  const material = new MeshStandardMaterial()
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  mesh.position.x = 0.3
  root.add(mesh)
  return {
    root,
    dispose: () => {
      disposed.push(name)
      root.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
const actor = (id: string, head: string | null, back: string | null = null): CharacterEntityRender => ({
  id,
  kind: 'character',
  presentation: 'crowd',
  appearance: {
    body_url: 'body',
    hair_url: 'hair',
    colors: [id === 'a' ? '#ff0000' : '#00ff00', '#fff', '#fff'],
    worn: { head: head ? { url: head, variant: null } : null, back: back ? { url: back, variant: null } : null },
  },
  anchor: { kind: 'world', position: [5, 2, 3] },
  facing: { kind: 'yaw', yaw: 0.7 },
  animation: { name: 'IDLE', time_scale: 1 },
})
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const mesh = (scene: Scene, name: string) => scene.getObjectByName(name) as CrowdMesh

test('hair visibility follows successful head loading and part colors follow their selected instances', async () => {
  const scene = new Scene(),
    disposed: string[] = []
  const pending = Promise.withResolvers<CharacterPart>()
  let bodies = 0
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => {
      bodies++
      return body()
    },
    load_part: async (_slot, spec) => (spec.url === 'slow_hat' ? pending.promise : part(spec.url, disposed)),
  })
  try {
    crowd.set([actor('a', 'slow_hat'), actor('b', null)] as never)
    await settle()
    crowd.tick(performance.now())
    expect(mesh(scene, 'body').geometry.instanceCount).toBe(2)
    expect(mesh(scene, 'hair').geometry.instanceCount).toBe(2)
    pending.resolve(part('slow_hat', disposed))
    await settle()
    crowd.tick(performance.now())
    expect(mesh(scene, 'hair').geometry.instanceCount).toBe(1)
    expect(mesh(scene, 'slow_hat').geometry.instanceCount).toBe(1)
    const color = mesh(scene, 'hair').geometry.getAttribute('crowdColor1') as InterleavedBufferAttribute
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual(new Color('#00ff00').toArray())
    crowd.set([actor('a', null), actor('b', null)] as never)
    crowd.tick(performance.now())
    expect(mesh(scene, 'hair').geometry.instanceCount).toBe(2)
    expect(scene.getObjectByName('slow_hat')).toBeUndefined()
    expect(bodies).toBe(1)
  } finally {
    crowd.dispose()
  }
  expect([...disposed].sort()).toEqual(['hair', 'slow_hat'])
})

test('retired part loads dispose their resources instead of changing a new outfit', async () => {
  const scene = new Scene(),
    disposed: string[] = []
  const pending = Promise.withResolvers<CharacterPart>()
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => body(),
    load_part: async (_slot, spec) => (spec.url === 'old' ? pending.promise : part(spec.url, disposed)),
  })
  crowd.set([actor('a', 'old')] as never)
  await settle()
  crowd.set([actor('a', 'new')] as never)
  pending.resolve(part('old', disposed))
  await settle()
  crowd.tick(performance.now())
  expect(scene.getObjectByName('old')).toBeUndefined()
  expect(mesh(scene, 'new').geometry.instanceCount).toBe(1)
  expect(disposed).toContain('old')
  crowd.dispose()
  expect(scene.children).toEqual([])
})

test('back equipment keeps authored rotation and bone offset under each instance transform', async () => {
  const scene = new Scene(),
    disposed: string[] = []
  const source = body()
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => source,
    load_part: async (_slot, spec) => part(spec.url, disposed),
  })
  try {
    crowd.set([actor('a', null, 'cloak')] as never)
    await settle()
    crowd.tick(performance.now())
    const cloak = mesh(scene, 'cloak')
    const expected = new Matrix4().makeRotationY(0.7).setPosition(5, 2, 3).multiply(cloak.matrixWorld)
    const actual = cloak.matrixWorld.clone().multiply(new Matrix4().fromArray(cloak.instance_matrix.array, 0))
    actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index]!, 5))
    expect(cloak.parent!.rotation.x).toBe(Math.PI)
  } finally {
    crowd.dispose()
  }
})

test('failed equipment loading keeps the body and hair, and late loads after disposal are released', async () => {
  const scene = new Scene(),
    disposed: string[] = []
  const late = Promise.withResolvers<CharacterPart>()
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => body(),
    load_part: async (_slot, spec) => {
      if (spec.url === 'bad') throw new Error('expected unavailable equipment')
      if (spec.url === 'late') return late.promise
      return part(spec.url, disposed)
    },
  })
  crowd.set([actor('a', 'bad', 'late')] as never)
  await settle()
  crowd.tick(performance.now())
  expect(mesh(scene, 'body').geometry.instanceCount).toBe(1)
  expect(mesh(scene, 'hair').geometry.instanceCount).toBe(1)
  expect(crowd.entity_height('a')).toBe(2)
  crowd.dispose()
  late.resolve(part('late', disposed))
  await settle()
  expect(disposed).toContain('late')
  expect(scene.children).toEqual([])
})

test('skinned attachments preserve their bind pose and animated parent under instance placement', async () => {
  const scene = new Scene()
  const make_skin = (): CharacterPart => {
    const root = new Group()
    const bone = new Bone()
    bone.name = 'part_bone'
    bone.position.y = 0.2
    const geometry = new BoxGeometry(0.5, 0.5, 0.5)
    const { count } = geometry.attributes.position!
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4))
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(
        Array.from({ length: count * 4 }, (_, index) => (index % 4 === 0 ? 1 : 0)),
        4
      )
    )
    const material = new MeshStandardMaterial()
    const skin = new SkinnedMesh(geometry, material)
    skin.name = 'skinned_hat'
    skin.position.x = 0.3
    root.add(bone, skin)
    root.updateMatrixWorld(true)
    skin.bind(new Skeleton([bone]))
    return {
      root,
      dispose: () => {
        root.removeFromParent()
        skin.skeleton.dispose()
        geometry.dispose()
        material.dispose()
      },
    }
  }
  const source = body()
  source.root.scale.setScalar(0.5)
  const reference = body()
  reference.root.scale.setScalar(0.5)
  reference.root.position.set(5, 2, 3)
  reference.root.rotation.y = 0.7
  const reference_part = make_skin()
  mount_character_part({ body: reference.root, part: reference_part.root, slot: 'head', hair: null })
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => ({
      ...source,
      clips: [new AnimationClip('IDLE', 1, [new VectorKeyframeTrack('Head.position', [0, 1], [0, 1, 0, 0, 2, 0])])],
    }),
    load_part: async (_slot, spec) => (spec.url === 'skin' ? make_skin() : part(spec.url, [])),
  })
  try {
    crowd.set([actor('a', 'skin')] as never)
    await settle()
    crowd.tick(performance.now() + 100)
    scene.updateMatrixWorld(true) // Renderer updates attached bind matrices before skinning.
    const actual_skin = scene.getObjectByName('skinned_hat') as SkinnedMesh & CrowdMesh
    const expected_skin = reference_part.root.getObjectByName('skinned_hat') as SkinnedMesh
    const head = source.root.getObjectByName('Head')!
    expect(head.position.y).toBeGreaterThan(1)
    reference.root.getObjectByName('Head')!.position.copy(head.position)
    reference.root.updateMatrixWorld(true)
    const actual = actual_skin
      .applyBoneTransform(0, new Vector3().fromBufferAttribute(actual_skin.geometry.attributes.position!, 0))
      .applyMatrix4(new Matrix4().fromArray(actual_skin.instance_matrix.array, 0))
      .applyMatrix4(actual_skin.matrixWorld)
    const expected = expected_skin
      .applyBoneTransform(0, new Vector3().fromBufferAttribute(expected_skin.geometry.attributes.position!, 0))
      .applyMatrix4(expected_skin.matrixWorld)
    expect(actual.distanceTo(expected)).toBeLessThan(0.00001)
  } finally {
    crowd.dispose()
    reference_part.dispose()
  }
})

test('splitting and merging poses retains shader compatibility with independent instance buffers', async () => {
  const scene = new Scene(),
    disposed: string[] = []
  let loads = 0
  const crowd = create_character_crowd_layer({
    scene,
    load_model: async () => body(),
    load_part: async (_slot, spec) => {
      loads++
      return part(spec.url, disposed)
    },
  })
  const a = actor('a', 'hat_a'),
    b = actor('b', 'hat_b')
  try {
    crowd.set([a, b] as never)
    await settle()
    crowd.tick(performance.now())
    const first_a = (mesh(scene, 'hat_a').material as MeshStandardMaterial).customProgramCacheKey()
    const first_b = (mesh(scene, 'hat_b').material as MeshStandardMaterial).customProgramCacheKey()
    const pose = (spec: CharacterEntityRender, name: 'RUN' | 'JUMP') => ({
      ...spec,
      animation: { name, time_scale: 1 },
    })
    crowd.set([pose(a, 'RUN'), pose(b, 'JUMP')] as never)
    await settle()
    crowd.tick(performance.now())
    expect(crowd.stats()).toEqual({ batches: 2, instances: 2 })
    expect((mesh(scene, 'hat_a').material as MeshStandardMaterial).customProgramCacheKey()).toBe(first_a)
    expect((mesh(scene, 'hat_b').material as MeshStandardMaterial).customProgramCacheKey()).toBe(first_b)
    expect(mesh(scene, 'hat_a').parent!.parent).not.toBe(mesh(scene, 'hat_b').parent!.parent)
    crowd.set([a, b] as never)
    await settle()
    crowd.tick(performance.now())
    expect((mesh(scene, 'hat_a').material as MeshStandardMaterial).customProgramCacheKey()).toBe(first_a)
    expect((mesh(scene, 'hat_b').material as MeshStandardMaterial).customProgramCacheKey()).toBe(first_b)
    expect(mesh(scene, 'hat_a').instance_matrix).not.toBe(mesh(scene, 'hat_b').instance_matrix)
  } finally {
    crowd.dispose()
  }
  expect(disposed).toHaveLength(loads)
})
