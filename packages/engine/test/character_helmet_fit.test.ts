// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readdirSync, readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  Matrix4,
} from 'three'

import { model_variant_identity } from '../../immutable/src/model_variant.ts'

import { head_geometry, read_character_glb } from './helpers/character_glb.ts'

const characters = new URL('../../../seed/models/characters/', import.meta.url)
const equipment = new URL('../../../seed/models/equipment/', import.meta.url)
const items = JSON.parse(readFileSync(new URL('../../../seed/content/items.json', import.meta.url), 'utf8')) as {
  title_model?: string
  item_type: string
  category: string
}[]
const community = [...new Set(items.flatMap(({ title_model }) => (title_model ? [title_model] : [])))]
const original_names = readdirSync(characters).filter((name) => /_(male|female)\.glb$/.test(name))
const originals = original_names.map((name) => head_geometry(new URL(name, characters)))
const maximum = (values: readonly number[]) => values.reduce((value, next) => Math.max(value, next), -Infinity)
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const points = originals.flatMap(({ vertices }) => vertices.map(({ point }) => point))
// These are measured native geometry envelopes, not a new renderer fit table. Ears and cheek
// ornaments explain the widest originals; the median body width and crown isolate the shared skull.
const reference = {
  width: median(originals.map(({ vertices }) => maximum(vertices.map(({ point }) => Math.abs(point.x))))),
  crown_width: median(
    originals.map(({ vertices }) =>
      maximum(vertices.filter(({ point }) => point.y > 0.5).map(({ point }) => Math.abs(point.x)))
    )
  ),
  top: maximum(points.map(({ y }) => y)),
  crown_back: maximum(points.filter(({ y }) => y >= 0.47).map(({ z }) => -z)),
}
// Draco quantization of the original corpus is ~1e-4 model units.
const tolerance = 0.001

test('helmet reference includes the actual 24 original bodies and all community title bodies', () => {
  expect(original_names).toHaveLength(24)
  expect(community).toHaveLength(10)
  expect(community).toContain('blast_girl')
  expect(reference.width).toBeCloseTo(0.301, 2)
  expect(reference.crown_width).toBeCloseTo(0.258, 2)
})

const helmet_meshes = (name: string) =>
  read_character_glb(new URL(name, equipment)).meshes.map(({ matrix, attributes, indices }) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(attributes.POSITION!.flat(), 3))
    geometry.setIndex(indices)
    geometry.applyMatrix4(matrix)
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
    mesh.updateMatrixWorld(true)
    return mesh
  })

const tight_helmets = ['crew_helmet.glb', 'casque_hayate.glb', 'drakar.glb']
const crown_cases = community.flatMap((name) => tight_helmets.map((hat) => [name, hat] as const))
test.each(crown_cases)('%s crown fits the actual %s cavity without stretching', (name, hat) => {
  const { vertices } = head_geometry(new URL(`${name}.glb`, characters), 'helmet')
  for (const { head_weight } of vertices) expect(head_weight).toBeCloseTo(1, 5)
  // Crown seating is authored at the cavity transition. Separate ears, cheek tufts
  // and the lower face remain outside open helmet regions rather than inflating it.
  const crown = vertices.filter(({ point }) => point.y >= 0.47)
  expect(crown.length).toBeGreaterThan(0)
  const meshes = helmet_meshes(hat)
  let checked = 0
  try {
    for (const { point } of crown) {
      for (const axis of ['x', 'z'] as const) {
        const direction = new Vector3()
        direction[axis] = Math.sign(point[axis]) || 1
        const hit = new Raycaster(new Vector3(0, point.y, 0), direction)
          .intersectObjects(meshes)
          .find(({ distance }) => distance >= reference.crown_back - tolerance)
        // Internal hair/goggle surfaces already inside the original crown are not
        // enclosing walls: Hayate's back hair is at 0.130 versus native skull 0.215.
        if (!hit) continue
        expect(Math.abs(point[axis]), `${name}: ${hat} crown ${axis}`).toBeLessThanOrEqual(hit.distance + tolerance)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  } finally {
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
})

test('shipped helmet cavities retain the native side and crown clearances used by the fit', () => {
  const available = readdirSync(equipment)
    .filter((name) => name.endsWith('.glb'))
    .map((name) => name.slice(0, -4))
  const corpus = [
    ...new Set(
      items
        .filter(({ category }) => category === 'hat' || category === 'cosmetic_hat')
        .map(({ item_type }) => {
          const identity = model_variant_identity(item_type, available)
          expect(identity, item_type).not.toBeNull()
          return `${identity!.basename}.glb`
        })
    ),
  ]
  expect(corpus).toContain('crew_helmet.glb')
  expect(corpus).toContain('casque_hayate.glb')
  for (const name of corpus) {
    const meshes = helmet_meshes(name)
    try {
      // Every shipped mesh is decoded, including tight native hats and material-variant containers.
      expect(meshes.length, name).toBeGreaterThan(0)
      expect(
        meshes.every(({ geometry }) => geometry.attributes.position!.count > 0),
        name
      ).toBeTrue()
      if (name !== 'crew_helmet.glb') continue
      const origin = new Vector3(0, 0.3, 0)
      for (const direction of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0)]) {
        const [hit] = new Raycaster(origin, direction).intersectObjects(meshes)
        expect(hit, name).toBeDefined()
        expect(hit!.distance).toBeGreaterThan(reference.width)
      }
      const [ceiling] = new Raycaster(origin, new Vector3(0, 1, 0)).intersectObjects(meshes)
      expect(ceiling, name).toBeDefined()
      expect(origin.y + ceiling!.distance).toBeGreaterThan(reference.top)
    } finally {
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    }
  }
})

test.each(community)('%s skin binds and animated helmet frame remain compatible', (name) => {
  const model = head_geometry(new URL(`${name}.glb`, characters), 'helmet')
  const inverse_head = model.world(model.head).invert()
  const socket = model.attachment
  const socket_frame = inverse_head.clone().multiply(model.world(socket))
  const samples = model.meshes.flatMap(({ node, matrix, attributes }) => {
    const skin = model.document.skins?.[node.skin ?? -1]
    if (!skin) return []
    const head_joint = skin.joints.indexOf(model.head)
    const bind = new Matrix4().fromArray(model.accessor(skin.inverseBindMatrices)[head_joint]!)
    return attributes.POSITION!.flatMap((position, index) => {
      const joints = attributes.JOINTS_0![index]!
      const weights = attributes.WEIGHTS_0![index]!
      if (!joints.some((joint, slot) => joint === head_joint && weights[slot]! > 0.5)) return []
      const vertex = new Vector3().fromArray(position)
      const local = vertex.clone().applyMatrix4(matrix).applyMatrix4(inverse_head)
      const bound = vertex.applyMatrix4(bind)
      expect(bound.distanceTo(local), `${name}: inverse bind agrees with Head attachment`).toBeLessThan(tolerance)
      return index % 128 === 0 ? [{ local, bound }] : []
    })
  })
  expect(samples.length, name).toBeGreaterThan(0)
  const clips = model.document.animations ?? []
  expect(
    clips.map(({ name: clip }) => clip),
    name
  ).toEqual(expect.arrayContaining(['IDLE', 'RUN', 'ATTACK', 'SIT', 'DEATH']))
  for (const clip of clips) {
    for (const fraction of [0, 0.5, 1]) {
      const poses = new Map<number, { translation?: number[]; rotation?: number[]; scale?: number[] }>()
      for (const { sampler, target } of clip.channels) {
        const values = model.accessor(clip.samplers[sampler]!.output)
        const value = values[Math.floor((values.length - 1) * fraction)]!
        poses.set(target.node, { ...poses.get(target.node), [target.path]: value })
      }
      const animated_head = model.world(model.head, poses)
      // Rigid Head weights plus the verified bind frame make relative fit invariant under
      // every Head pose. Check exported poses themselves instead of testing A * inverse(A).
      expect(animated_head.elements.every(Number.isFinite), `${name}: ${clip.name} at ${fraction}`).toBeTrue()
      expect(Math.abs(animated_head.determinant()), `${name}: ${clip.name} at ${fraction}`).toBeGreaterThan(tolerance)
      const relative = animated_head.clone().invert().multiply(model.world(socket, poses))
      const drift = maximum(relative.elements.map((value, index) => Math.abs(value - socket_frame.elements[index]!)))
      expect(drift, `${name}: ${clip.name} keeps its authored helmet fit`).toBeLessThan(tolerance)
    }
  }
})
