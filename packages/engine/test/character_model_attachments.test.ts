// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { Bone, Group, Object3D, Vector3 } from 'three'

import { find_character_bone, mount_character_part } from '../src/character_model.ts'
import { align_mount } from '../src/entity_mount.ts'

const bytes = readFileSync(new URL('../../../seed/models/characters/blast_girl.glb', import.meta.url))
const json_length = bytes.readUInt32LE(12)
const source = JSON.parse(bytes.subarray(20, 20 + json_length).toString()) as {
  nodes: {
    name: string
    translation?: number[]
    rotation?: number[]
    scale?: number[]
    matrix?: number[]
    children?: number[]
  }[]
  skins: { joints: number[] }[]
  scenes: unknown[]
  accessors: { bufferView: number; byteOffset?: number; count: number; max?: number[] }[]
  bufferViews: { byteOffset: number; byteStride?: number }[]
  animations: {
    name: string
    samplers: { input: number; output: number }[]
    channels: { sampler: number; target: { path: string } }[]
  }[]
}
const native_rig = () => {
  const joints = new Set(source.skins.flatMap(({ joints }) => joints))
  const nodes = source.nodes.map((row, index) => {
    const node = joints.has(index) ? new Bone() : new Object3D()
    node.name = row.name
    if (row.matrix) {
      node.matrix.fromArray(row.matrix)
      node.matrix.decompose(node.position, node.quaternion, node.scale)
    } else {
      if (row.translation) node.position.fromArray(row.translation)
      if (row.rotation) node.quaternion.fromArray(row.rotation)
      if (row.scale) node.scale.fromArray(row.scale)
    }
    return node
  })
  source.nodes.forEach((row, index) => row.children?.forEach((child) => nodes[index]!.add(nodes[child]!)))
  const root = new Group()
  nodes.filter((node) => !node.parent).forEach((node) => root.add(node))
  return root
}

test('native Blast Girl anchors retain equipment through chest motion and mounted contact', () => {
  const original = native_rig()
  const clone = original.clone(true)
  const cape = find_character_bone(clone, 'cape')!
  const rider = clone.getObjectByName('Rider')!
  expect(cape.parent?.name).toBe('mixamorig:Neck')
  expect(rider.parent?.name).toBe('mixamorig:Hips')
  const hat = new Group()
  const cloak = new Group()
  expect(mount_character_part({ body: clone, part: hat, slot: 'head', hair: null })).toBeTrue()
  expect(mount_character_part({ body: clone, part: cloak, slot: 'back', hair: null })).toBeTrue()
  expect(hat.parent?.name).toBe('mixamorig:Head')
  expect(cloak.parent).toBe(cape)
  const before = cloak.getWorldPosition(new Vector3())
  clone.getObjectByName('mixamorig:Spine2')!.rotation.z = 0.5
  expect(cloak.getWorldPosition(new Vector3()).distanceTo(before)).toBeGreaterThan(0.1)
  const seat = new Object3D()
  seat.position.set(3, 2, 7)
  clone.scale.setScalar(0.7)
  align_mount(clone, rider, seat)
  expect(rider.getWorldPosition(new Vector3()).distanceTo(seat.position)).toBeLessThan(1e-6)
  expect(find_character_bone(original, 'cape')!.children).toHaveLength(0)
})

test('native Blast Girl exports one character and the full playable clip set with unit animated scales', () => {
  expect(source.scenes).toHaveLength(1)
  expect(source.skins).toHaveLength(1)
  expect(source.animations.map(({ name }) => name).sort()).toEqual([
    'ATTACK',
    'DANCE',
    'DEATH',
    'FALL',
    'IDLE',
    'JUMP',
    'JUMP_RUN',
    'RUN',
    'SIT',
    'SPELL_BUFF',
    'SPELL_TARGET',
    'WALK',
  ])
  const death = source.animations.find(({ name }) => name === 'DEATH')!
  expect(Math.max(...death.samplers.map(({ input }) => source.accessors[input]!.max![0]!))).toBe(1)
  for (const animation of source.animations) {
    for (const channel of animation.channels.filter(({ target }) => target.path === 'scale')) {
      const accessor = source.accessors[animation.samplers[channel.sampler]!.output]!
      const view = source.bufferViews[accessor.bufferView]!
      const start = 28 + json_length + view.byteOffset + (accessor.byteOffset ?? 0)
      for (let index = 0; index < accessor.count; index++) {
        for (let axis = 0; axis < 3; axis++)
          expect(bytes.readFloatLE(start + index * (view.byteStride ?? 12) + axis * 4)).toBeCloseTo(1, 5)
      }
    }
  }
})

test('detachable Blast Girl hair is a static Head-local part, excluded from the body', () => {
  const hair_bytes = readFileSync(new URL('../../../seed/models/characters/blast_girl_hair.glb', import.meta.url))
  const hair = JSON.parse(hair_bytes.subarray(20, 20 + hair_bytes.readUInt32LE(12)).toString()) as {
    skins?: unknown[]
    animations?: unknown[]
    nodes: { name: string }[]
    meshes: { primitives: { attributes: { POSITION: number } }[] }[]
    accessors: { min: number[]; max: number[] }[]
  }
  expect(source.nodes.some(({ name }) => name === 'BlastGirl_Hair')).toBeFalse()
  expect(hair.skins ?? []).toHaveLength(0)
  expect(hair.animations ?? []).toHaveLength(0)
  expect(hair.nodes.map(({ name }) => name)).toEqual(['BlastGirl_Hair'])
  const position = hair.accessors[hair.meshes[0]!.primitives[0]!.attributes.POSITION]!
  // Head-local Y points toward the crown; a second scene-axis conversion rotates hair behind the neck.
  expect(position.min[1]).toBeGreaterThan(-0.1)
  expect(position.max[1]).toBeGreaterThan(0.7)
  expect(position.max[2]).toBeLessThan(0.5)
})
