// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import {
  Bone,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'

import { head_geometry } from './helpers/character_glb.ts'

const characters = new URL('../../../seed/models/characters/', import.meta.url)
const proportions = (name: string) => {
  const model = head_geometry(new URL(`${name}.glb`, characters))
  const root = new Group()
  const nodes = model.document.nodes.map((_, index) => {
    const bone = new Bone()
    const parent = model.document.nodes.findIndex(({ children }) => children?.includes(index))
    bone.matrixAutoUpdate = false
    bone.matrix.copy(parent < 0 ? model.world(index) : model.world(parent).invert().multiply(model.world(index)))
    return bone
  })
  model.document.nodes.forEach(({ children }, index) => {
    for (const child of children ?? []) nodes[index]!.add(nodes[child]!)
  })
  for (const node of nodes) if (!node.parent) root.add(node)
  const meshes = model.meshes.map(({ node, attributes }) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(attributes.POSITION!.flat(), 3))
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(attributes.JOINTS_0!.flat(), 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(attributes.WEIGHTS_0!.flat(), 4))
    const mesh = new SkinnedMesh(geometry)
    nodes[model.document.nodes.indexOf(node)]!.add(mesh)
    root.updateMatrixWorld(true)
    const skin = model.document.skins![node.skin!]!
    const skeleton = new Skeleton(
      skin.joints.map((index) => nodes[index]!),
      model.accessor(skin.inverseBindMatrices).map((matrix) => new Matrix4().fromArray(matrix))
    )
    mesh.bind(skeleton, new Matrix4())
    skeleton.update()
    return mesh
  })
  // Exercise the same skinned, body-only Box3 used by character_shape before hair.
  root.updateMatrixWorld(true)
  const body = new Box3().setFromObject(root)
  const head = new Box3().setFromPoints(
    model.vertices.map(({ point }) => point.clone().applyMatrix4(model.world(model.head)))
  )
  for (const mesh of meshes) {
    mesh.geometry.dispose()
    mesh.skeleton.dispose()
    if (!Array.isArray(mesh.material)) mesh.material.dispose()
  }
  return { body, head, size: head.getSize(new Vector3()), height: body.max.y - body.min.y }
}
const senshi = proportions('senshi_male')
// Captured from the shipped 43cb5b18 bodies on 2026-11-12, before enlargement.
// Width/height and depth/height protect each curated face from stretching.
const cast = [
  ['aeon', 1.333333, 0.891667, 1.88],
  ['enforcer_machin', 1.615385, 1.123077, 1.98],
  ['fuddies', 1.474576, 0.877966, 1.85],
  ['mystic_yeti', 1.371429, 0.878571, 1.78],
  ['pawtato_heroes', 1.666667, 0.886667, 1.84],
  ['puggies', 1.466667, 1.041667, 1.84],
  ['rootlets', 1.392857, 0.992857, 1.88],
  ['suimilios', 1.366667, 0.821667, 1.88],
  ['the_ones', 1, 0.795833, 1.8],
] as const

test.each(cast)('%s keeps a Senshi-sized head after game height normalization', (name) => {
  const actual = proportions(name)
  // Senshi measures 29.83%; the authored target is 30%. Quantization is ~0.0001 units.
  expect(actual.size.y / actual.height).toBeGreaterThanOrEqual(senshi.size.y / senshi.height - 0.001)
})

test.each(cast)('%s preserves its face aspect and chin connection', (name, width, depth, chin) => {
  const actual = proportions(name)
  expect(actual.size.x / actual.size.y).toBeCloseTo(width, 2)
  expect(actual.size.z / actual.size.y).toBeCloseTo(depth, 2)
  expect(actual.head.min.y).toBeCloseTo(chin, 3)
  expect(actual.body.min.y).toBeCloseTo(0, 3)
})

// The lower ruff makes Yeti's Head bounds larger than its visible blue face.
// Pin the visually reviewed correction so the smaller 30% candidate cannot return.
test('Yeti retains the reviewed face enlargement beyond its lower fur ruff', () => {
  const actual = proportions('mystic_yeti')
  expect(actual.size.y / actual.height).toBeCloseTo(0.33, 2)
})
