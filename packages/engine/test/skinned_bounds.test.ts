// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Scene,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three'

import { create_entity_layer } from '../src/entities.ts'
import { skinned_boundary_vertices, update_skinned_bounds } from '../src/skinned_bounds.ts'

const cube_points = (): number[] => {
  const points: number[] = []
  for (let x = -4; x <= 4; x += 1)
    for (let y = -4; y <= 4; y += 1) for (let z = -4; z <= 4; z += 1) points.push(x / 4, y / 4, z / 4)
  return points
}

const rig = (points = cube_points(), blended = false) => {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3))
  const count = points.length / 3
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(Array.from({ length: count }, () => [0, 1, 0, 0]).flat(), 4)
  )
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      Array.from({ length: count }, (_, i) => (blended && i % 2 ? [0.3, 0.7, 0, 0] : [1, 0, 0, 0])).flat(),
      4
    )
  )
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  const bones = [new Bone(), new Bone()]
  mesh.add(...bones)
  mesh.bind(new Skeleton(bones))
  const dispose = (): void => {
    mesh.skeleton.dispose()
    mesh.material.dispose()
    geometry.dispose()
  }
  return { mesh, bones, dispose }
}

const expect_exact_bounds = (mesh: SkinnedMesh): void => {
  mesh.updateWorldMatrix(true, true)
  mesh.computeBoundingBox()
  const expected = mesh.boundingBox!.clone()
  const actual = update_skinned_bounds(mesh)
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-6)
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-6)
}

test('a live pet label does not skin every mesh vertex each frame', async () => {
  const { mesh, dispose } = rig()
  const layer = create_entity_layer({
    scene: new Scene(),
    load_model: async () => ({ root: mesh, clips: [], min_y: -1, dispose }),
  })
  layer.set([
    {
      id: 'pet',
      kind: 'mob',
      model_url: 'pet.glb',
      anchor: { kind: 'world', position: [0, 0, 0] },
      facing: { kind: 'yaw', yaw: 0 },
    },
  ])
  await new Promise((resolve) => setTimeout(resolve, 0))
  const vertices = spyOn(mesh, 'getVertexPosition')
  try {
    expect(layer.live_crown('pet')).not.toBeNull()
    expect(vertices.mock.calls.length).toBeLessThanOrEqual(8)
  } finally {
    vertices.mockRestore()
    layer.dispose()
  }
})

test('rigid and blended skin groups preserve bounds through changing bone poses', () => {
  const { mesh, bones, dispose } = rig(cube_points(), true)
  try {
    for (let frame = 0; frame < 20; frame += 1) {
      bones[0]!.rotation.set(frame * 0.13, frame * 0.07, frame * -0.11)
      bones[1]!.position.set(0.2, frame * 0.1, -0.4)
      bones[1]!.scale.set(0.7, 1.5, 1.1)
      bones[1]!.rotation.set(-frame * 0.21, frame * 0.17, frame * 0.19)
      expect_exact_bounds(mesh)
    }
    const indices = skinned_boundary_vertices(mesh.geometry)
    expect(indices!.length).toBeLessThan(40)
    expect(skinned_boundary_vertices(mesh.geometry)).toBe(indices)
  } finally {
    dispose()
  }
})

test('planar, collinear and coincident vertices remain valid under rotation', () => {
  for (const points of [
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0.5, 0.5, 0],
    [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
    Array(15).fill(0),
  ]) {
    const { mesh, bones, dispose } = rig(points)
    try {
      bones[0]!.rotation.set(0.7, 0.3, 1.2)
      expect_exact_bounds(mesh)
    } finally {
      dispose()
    }
  }
})

test('morph targets retain the full calculation even after a static hull was cached', () => {
  const { mesh, dispose } = rig()
  try {
    skinned_boundary_vertices(mesh.geometry)
    const morph = new Float32Array(mesh.geometry.getAttribute('position').count * 3)
    morph[364 * 3 + 1] = 10
    mesh.geometry.morphAttributes.position = [new Float32BufferAttribute(morph, 3)]
    mesh.geometry.morphTargetsRelative = true
    mesh.updateMorphTargets()
    mesh.morphTargetInfluences![0] = 1
    expect(skinned_boundary_vertices(mesh.geometry)).toBeNull()
    expect_exact_bounds(mesh)
    expect(mesh.boundingBox!.max.y).toBe(10)
  } finally {
    dispose()
  }
})
