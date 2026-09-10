// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Box3, Line3, Plane, Vector3, type BufferGeometry, type SkinnedMesh } from 'three'
import { ConvexHull } from 'three/addons/math/ConvexHull.js'

type Vertex = Readonly<{ point: Vector3; index: number }>

// GLTF geometry is shared by cloned rigs and immutable after loading. Bone poses remain per instance.
const boundary_vertices = new WeakMap<BufferGeometry, readonly number[]>()

/** Equal skin indices/weights apply the same affine transform to every point in a group.
 * Its convex hull therefore preserves every axis extremum under every possible bone pose. */
const skin_groups = (geometry: BufferGeometry): readonly (readonly Vertex[])[] => {
  const positions = geometry.getAttribute('position')
  const indices = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  const groups = new Map<string, Map<string, Vertex>>()
  for (let index = 0; index < positions.count; index += 1) {
    const skin_key = [0, 1, 2, 3]
      .filter((slot) => weights.getComponent(index, slot) !== 0)
      .flatMap((slot) => [indices.getComponent(index, slot), weights.getComponent(index, slot)])
      .join(':')
    const group = groups.get(skin_key) ?? new Map<string, Vertex>()
    const point = new Vector3().fromBufferAttribute(positions, index)
    group.set(point.toArray().join(':'), { point, index })
    groups.set(skin_key, group)
  }
  return [...groups.values()].map((group) => [...group.values()])
}

/** QuickHull requires a volume. Keep planar, linear and tiny groups intact. */
const has_volume = (points: readonly Vector3[]): boolean => {
  if (points.length < 4) return false
  const first = points[0]!
  const second = points.reduce(
    (farthest, point) => (point.distanceToSquared(first) > farthest.distanceToSquared(first) ? point : farthest),
    first
  )
  const line = new Line3(first, second)
  const closest = new Vector3()
  const distance = (point: Vector3): number => line.closestPointToPoint(point, true, closest).distanceToSquared(point)
  const third = points.reduce((farthest, point) => (distance(point) > distance(farthest) ? point : farthest), first)
  const scale = first.distanceTo(second)
  if (distance(third) <= scale * scale * 1e-12) return false
  const plane = new Plane().setFromCoplanarPoints(first, second, third)
  return points.some((point) => Math.abs(plane.distanceToPoint(point)) > scale * 1e-6)
}

const group_boundary = (vertices: readonly Vertex[]): readonly number[] => {
  const points = vertices.map(({ point }) => point)
  if (!has_volume(points)) return vertices.map(({ index }) => index)
  const hull = new ConvexHull().setFromPoints(points)
  const visible = new Set<Vector3>()
  for (const face of hull.faces) {
    let { edge } = face
    do {
      visible.add(edge.vertex.point)
      edge = edge.next
    } while (edge !== face.edge)
  }
  return vertices.filter(({ point }) => visible.has(point)).map(({ index }) => index)
}

export const skinned_boundary_vertices = (geometry: BufferGeometry): readonly number[] | null => {
  // Morphs can change a group's hull. Preserve Three.js's full calculation for those models.
  if (geometry.morphAttributes.position?.length) return null
  const cached = boundary_vertices.get(geometry)
  if (cached) return cached
  const vertices = Object.freeze(skin_groups(geometry).flatMap(group_boundary))
  boundary_vertices.set(geometry, vertices)
  return vertices
}

/** Same animated local bounds as computeBoundingBox, without skinning interior/seam vertices. */
export const update_skinned_bounds = (mesh: SkinnedMesh): Box3 => {
  const vertices = skinned_boundary_vertices(mesh.geometry)
  if (vertices === null) {
    mesh.computeBoundingBox()
    return mesh.boundingBox!
  }
  const bounds = mesh.boundingBox ?? new Box3()
  const point = new Vector3()
  bounds.makeEmpty()
  for (const index of vertices) bounds.expandByPoint(mesh.getVertexPosition(index, point))
  mesh.boundingBox = bounds
  return bounds
}
