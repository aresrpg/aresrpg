// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { opaque_canopy_mesh, validate_canopy, CANOPY_BOUNDS_MARGIN } from '../src/opaque_canopy.ts'
import { CANOPY_LOD, canopy_rotation, CANOPY_YAW_OFFSET, CANOPY_YAW_STEP } from '../src/canopy_transforms.ts'
import { create_material_texture_data } from '../src/material_texture.ts'
import { compile_materials } from '../src/world_materials.ts'

const materials = compile_materials({
  bark: { color: '#655133', preset: 'wood' },
  leaves: { color: '#519243', preset: 'foliage' },
})
const quads = new Uint32Array([0, 1, (31 << 18) | (31 << 23) | (2 << 28), 2])
const source = { quads, quad_count: 2 }

test('opaque foliage preserves solid geometry, material identity, and opposing leaf faces', () => {
  const mesh = opaque_canopy_mesh(source, materials, 'near')
  expect([...mesh.quads.slice(0, 2)]).toEqual([0, 1])
  expect([...quads]).toEqual([0, 1, (31 << 18) | (31 << 23) | (2 << 28), 2])
  for (let index = 2; index < mesh.quads.length; index += 4) {
    const front = mesh.quads[index]!
    const back = mesh.quads[index + 2]!
    expect((front >>> 28) & 7).toBe(6)
    expect((back >>> 28) & 7).toBe(7)
    expect(front & 0x0fffffff).toBe(back & 0x0fffffff)
    expect(mesh.quads[index + 1]! & 0xfff).toBe(2)
    expect(mesh.quads[index + 1]).toBe(mesh.quads[index + 3])
  }
})

test('cluster density is deterministic, deduplicated, bounded, and reduced for distant chunks', () => {
  const repeated = {
    quads: new Uint32Array(Array.from({ length: 100 }, () => [...quads.slice(2)]).flat()),
    quad_count: 100,
  }
  const near = opaque_canopy_mesh(repeated, materials, 'near')
  const mid = opaque_canopy_mesh(repeated, materials, 'mid')
  expect(near).toEqual(opaque_canopy_mesh({ quads: quads.slice(2), quad_count: 1 }, materials, 'near'))
  expect(near.quad_count).toBeLessThanOrEqual(4096 * 6)
  expect(mid.quad_count).toBeLessThanOrEqual(512 * 6)
  expect(mid.quad_count).toBeLessThan(near.quad_count)
  const far = opaque_canopy_mesh(repeated, materials, 'far')
  expect(far.quad_count).toBeLessThan(mid.quad_count)
  expect(far.quad_count).toBeLessThanOrEqual(64 * 6)
  for (let index = 0; index < mid.quads.length; index += 2) {
    const word = mid.quads[index]!
    const size = ((mid.quads[index + 1]! >>> 12) & 63) / 4
    expect(size).toBe(CANOPY_LOD.mid.size)
    expect(size).toBeLessThanOrEqual(CANOPY_LOD.mid.step)
    expect(word & 63).toBeLessThanOrEqual(34)
    expect((word >>> 6) & 63).toBeLessThanOrEqual(34)
    expect((word >>> 12) & 63).toBeLessThanOrEqual(34)
  }
})

test('non-foliage worlds retain identical packed geometry and the recipe defaults to voxels', () => {
  const solid = { quads: quads.slice(0, 2), quad_count: 1 }
  expect(opaque_canopy_mesh(solid, materials, 'near')).toEqual(solid)
  expect(validate_canopy(undefined)).toEqual([])
  expect(validate_canopy('clusters')).toEqual([])
  expect(validate_canopy('voxels')).toEqual([])
  expect(validate_canopy('cards')).toHaveLength(1)
})

test('opposite faces anchor to the same occupied cell instead of expanding into empty neighbours', () => {
  const mesh = {
    quads: new Uint32Array(Array.from({ length: 6 }, (_, face) => [1 | (1 << 6) | (1 << 12) | (face << 28), 2]).flat()),
    quad_count: 6,
  }
  const clump = opaque_canopy_mesh(mesh, materials, 'near')
  expect(clump.quad_count).toBe(6)
  const centers = new Set(Array.from({ length: 6 }, (_, index) => clump.quads[index * 2]! & 0x3ffff))
  expect(centers.size).toBe(1)
})

test('leaf clusters retain source occlusion across orientation changes', () => {
  const source_appearance = 2 | (0x69 << 20)
  const source_face = 3
  const source_quad = (31 << 18) | (31 << 23) | (source_face << 28)
  const mesh = opaque_canopy_mesh(
    { quads: new Uint32Array([source_quad, source_appearance]), quad_count: 1 },
    materials,
    'near'
  )
  for (let index = 1; index < mesh.quads.length; index += 2) {
    expect((mesh.quads[index]! >>> 20) & 0xff).toBe(0x69)
  }
})

test('each compact clump has six faces and one packed size instead of per-rectangle UVs', () => {
  const mesh = opaque_canopy_mesh({ quads: new Uint32Array([2 << 28, 2]), quad_count: 1 }, materials, 'near')
  expect(mesh.quad_count).toBe(6)
  const axes = new Set(Array.from({ length: mesh.quad_count }, (_, index) => (mesh.quads[index * 2 + 1]! >>> 18) & 3))
  expect([...axes]).toEqual([0, 1, 2])
  for (let index = 1; index < mesh.quads.length; index += 2)
    expect(((mesh.quads[index]! >>> 12) & 63) / 4).toBe(CANOPY_LOD.near.size)
})

test('cluster art changes only foliage atlas layers and keeps the atlas allocation unchanged', () => {
  const ordinary = create_material_texture_data(materials, 32)
  const clusters = create_material_texture_data(materials, 32, true)
  expect(clusters.length).toBe(ordinary.length)
  expect(clusters.slice(0, 2 * 32 * 32 * 4)).toEqual(ordinary.slice(0, 2 * 32 * 32 * 4))
  expect(clusters.slice(2 * 32 * 32 * 4)).not.toEqual(ordinary.slice(2 * 32 * 32 * 4))
})

test('adjacent canopy clusters do not all reuse the same orientation', () => {
  const mesh = opaque_canopy_mesh({ quads: quads.slice(2), quad_count: 1 }, materials, 'near')
  const variants = new Set(Array.from({ length: mesh.quad_count }, (_, index) => mesh.quads[index * 2 + 1]! >>> 28))
  expect(variants.size).toBeGreaterThan(4)
})

const clump_vertices = (a: number, b: number): readonly (readonly number[])[] => {
  const back = ((a >>> 28) & 7) === 7
  const axis = (b >>> 18) & 3
  const scale = ((b >>> 12) & 63) / 4
  const side = ((back ? -1 : 1) * scale) / 2
  const rotation = canopy_rotation((b >>> 28) * CANOPY_YAW_STEP + CANOPY_YAW_OFFSET)
  return [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([u, v]) => {
    const horizontal = ((back ? 1 - u! : u!) - 0.5) * scale
    const vertical = (0.5 - v!) * scale
    const offset = [
      [horizontal, vertical, -side],
      [side, vertical, horizontal],
      [horizontal, side, vertical],
    ][axis]!
    return rotation.map((row) => row.reduce((sum, value, i) => sum + value * offset[i]!, 0))
  })
}

test('clumps are closed volumes with outward winding and remain inside the shared culling margin', () => {
  for (const lod of ['near', 'far'] as const) {
    const mesh = opaque_canopy_mesh({ quads: new Uint32Array([2 << 28, 2]), quad_count: 1 }, materials, lod)
    const edges = new Map<string, number>()
    for (let index = 0; index < mesh.quads.length; index += 2) {
      const points = clump_vertices(mesh.quads[index]!, mesh.quads[index + 1]!)
      const [a, b, c] = points
      const ab = b!.map((value, i) => value - a![i]!)
      const ac = c!.map((value, i) => value - a![i]!)
      const normal = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ]
      expect(normal.reduce((sum, value, i) => sum + value * a![i]!, 0)).toBeGreaterThan(0)
      for (const [from, to] of [
        [0, 1],
        [1, 3],
        [3, 2],
        [2, 0],
      ]) {
        const edge = [points[from!]!, points[to!]!]
          .map((p) => p.map((value) => Math.round(value * 1e6)).join(','))
          .sort()
          .join(':')
        edges.set(edge, (edges.get(edge) ?? 0) + 1)
      }
      const word = mesh.quads[index]!
      const center = [(word & 63) - 1, ((word >>> 6) & 63) - 1, ((word >>> 12) & 63) - 1]
      const coordinates = points.flatMap((point) => point.map((value, axis) => value + center[axis]!))
      expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(-CANOPY_BOUNDS_MARGIN)
      expect(Math.max(...coordinates)).toBeLessThanOrEqual(32 + CANOPY_BOUNDS_MARGIN)
    }
    expect(edges.size).toBe(12)
    expect([...edges.values()].every((count) => count === 2)).toBe(true)
  }
})
