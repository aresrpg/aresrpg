// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Scene, Vector3 } from 'three'
import { float, uniform } from 'three/tsl'

import { detail_builder } from '../src/detail_builder.ts'
import { decode_detail_vertices, DETAIL_STRIDE, validate_details } from '../src/detail_artifact.ts'
import { create_upload_queue } from '../src/upload_queue.ts'
import { create_detail_layer } from '../src/detail_layer.ts'
import { compile_materials } from '../src/world_materials.ts'
import { create_material_texture } from '../src/material_texture.ts'
import { terrain_recipe, parse_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

const palette = { wood: { color: '#785533', preset: 'wood' } } as const

test('mirrored prop geometry retains outward normals rather than turning inside out', () => {
  const builder = detail_builder()
  builder.transformed(([x, y, z]) => [-x, y, z], true).box([0, 0, 0], [1, 1, 1], 'wood')
  for (const cell of builder.finish()) {
    const vertices = decode_detail_vertices(cell.vertices)
    for (let i = 0; i < vertices.length; i += DETAIL_STRIDE) {
      const outward = [0, 1, 2].reduce(
        (sum, axis) =>
          sum + (vertices[i + axis]! + cell.origin[axis]! - [-0.5, 0.5, 0.5][axis]!) * vertices[i + 3 + axis]!,
        0
      )
      expect(outward).toBeGreaterThan(0)
    }
  }
})

test('world-aligned architectural UVs survive detail-cell clipping', () => {
  const builder = detail_builder()
  const points = [
    [31, 32, 4],
    [31, 32, 8],
    [34, 32, 8],
    [34, 32, 4],
  ] as const
  builder.quad(
    ...points,
    'wood',
    points.map(([x, , z]) => [x / 4, -z / 4] as const)
  )
  const cells = builder.finish()
  expect(cells).toHaveLength(2)
  cells.forEach((cell) => {
    const vertices = decode_detail_vertices(cell.vertices)
    for (let i = 0; i < vertices.length; i += DETAIL_STRIDE) {
      expect(vertices[i + 6]).toBeCloseTo((vertices[i]! + cell.origin[0]) / 4)
      expect(vertices[i + 7]).toBeCloseTo(-(vertices[i + 2]! + cell.origin[2]) / 4)
    }
  })
})

test('dense detail cells use bounded queue jobs and eviction cancels work not yet admitted', () => {
  const builder = detail_builder()
  for (let index = 0; index < 240; index++) builder.box([1, 1, 1], [2, 2, 2], 'wood')
  const uploads = create_upload_queue(() => 0)
  const scene = new Scene()
  const materials = compile_materials(palette)
  const atlas = create_material_texture(materials, 16)
  const layer = create_detail_layer({
    scene,
    cells: builder.finish(),
    materials,
    atlas,
    quality: 'high',
    uploads,
    clouds: { shadow_at: () => float(1) },
    sun_direction: uniform(new Vector3(0, 1, 0)),
  })
  layer.retain('ground', [0, 0, 0])
  expect(scene.children).toHaveLength(0)
  expect(uploads.size()).toBeGreaterThan(1)
  const bytes = uploads.drain([0, 0, 0], 131072, 1)
  expect(bytes).toBeGreaterThan(0)
  expect(bytes).toBeLessThanOrEqual(131072)
  expect(scene.children).toHaveLength(1)
  layer.set_quality('low', atlas)
  layer.remove('ground')
  expect(uploads.size()).toBe(0)
  expect(scene.children).toHaveLength(0)
  uploads.drain([0, 0, 0], 131072, 1)
  expect(scene.children).toHaveLength(0)
  layer.dispose()
  atlas.dispose()
})

test('worker projection keeps terrain facts and excludes baked rendering payloads', () => {
  const source = {
    ...parse_world_recipe(world_terrain('nauvis')),
    details: [],
    scenery: { waterfalls: [], spores: [], vines: [] },
    portal: false,
  }
  const projected = terrain_recipe(source)
  expect(projected).not.toHaveProperty('details')
  expect(projected).not.toHaveProperty('scenery')
  expect(projected.materials).toBe(source.materials)
  expect(projected.biomes).toBe(source.biomes)
  expect(projected.structure_areas).toBe(source.structure_areas)
  expect(projected.portal).toBe(false)
})

test('malformed or incompatible baked details fail validation instead of substituting geometry', () => {
  const builder = detail_builder()
  builder.box([1, 1, 1], [2, 2, 2], 'wood')
  const [cell] = builder.finish()
  expect(validate_details([{ ...cell, vertices: '!' }], palette).length).toBeGreaterThan(0)
  expect(validate_details([{ ...cell, palette: ['missing'] }], palette).length).toBeGreaterThan(0)
  expect(validate_details([{ ...cell, origin: [1, 0, 0] }], palette).length).toBeGreaterThan(0)
  expect(validate_details([cell, cell], palette)).toContain('details contains duplicate cells')
  expect(validate_details([cell], palette)).toEqual([])
})

test('baked slabs have outward normals and triangles stay inside their residency cells', () => {
  const builder = detail_builder()
  builder.box([-40, 10, -2], [50, 10.3, 2], 'wood')
  const cells = builder.finish()
  expect(cells.length).toBeGreaterThan(2)
  expect(validate_details(cells, palette)).toEqual([])
  let area = 0
  for (const cell of cells) {
    const data = decode_detail_vertices(cell.vertices)
    for (let index = 0; index < data.length; index += DETAIL_STRIDE * 3) {
      const point = (offset: number) =>
        new Vector3(data[index + offset]!, data[index + offset + 1]!, data[index + offset + 2]!)
      const a = point(0)
      const b = point(DETAIL_STRIDE)
      const c = point(DETAIL_STRIDE * 2)
      const cross = b.clone().sub(a).cross(c.clone().sub(a))
      const normal = point(3)
      expect(cross.dot(normal)).toBeGreaterThanOrEqual(-1e-6)
      area += cross.length() / 2
      const world = a
        .clone()
        .add(new Vector3(...cell.origin))
        .sub(new Vector3(5, 10.15, 0))
      expect(world.dot(normal)).toBeGreaterThan(0)
    }
  }
  expect(area).toBeCloseTo(2 * (90 * 0.3 + 90 * 4 + 0.3 * 4), 3)
})

test('detail cells follow shared column residency and never dispose the borrowed atlas', () => {
  const builder = detail_builder()
  builder.box([1, 1, 1], [2, 2, 2], 'wood')
  const scene = new Scene()
  const materials = compile_materials(palette)
  const atlas = create_material_texture(materials, 16)
  let atlas_disposals = 0
  atlas.addEventListener('dispose', () => {
    atlas_disposals++
  })
  const uploads = create_upload_queue()
  const layer = create_detail_layer({
    uploads,
    scene,
    cells: builder.finish(),
    materials,
    atlas,
    quality: 'high',
    clouds: { shadow_at: () => float(1) },
    sun_direction: uniform(new Vector3(0, 1, 0)),
  })
  expect(scene.children).toHaveLength(0)
  layer.set_visible(true)
  layer.retain('ground', [0, 0, 0])
  layer.retain('upper', [0, 32, 0])
  expect(scene.children).toHaveLength(0)
  uploads.drain([0, 0, 0], 131072, 1000)
  expect(scene.children).toHaveLength(1)
  expect(scene.children[0]!.visible).toBe(true)
  layer.remove('ground')
  expect(scene.children).toHaveLength(1)
  layer.set_quality('low', atlas)
  expect(scene.children[0]!.castShadow).toBe(false)
  layer.set_visible(false)
  expect(scene.children[0]!.visible).toBe(false)
  layer.remove('upper')
  expect(scene.children).toHaveLength(0)
  layer.retain('ground', [0, 0, 0])
  uploads.drain([0, 0, 0], 131072, 1000)
  expect(scene.children).toHaveLength(1)
  layer.dispose()
  expect(scene.children).toHaveLength(0)
  expect(atlas_disposals).toBe(0)
  atlas.dispose()
})

test('streamed city details share column residency and are recreated after eviction', () => {
  const builder = detail_builder()
  builder.box([1, 1, 1], [2, 2, 2], 'wood')
  const cells = builder.finish(),
    uploads = create_upload_queue(() => 0),
    scene = new Scene()
  const materials = compile_materials(palette),
    atlas = create_material_texture(materials, 16)
  const layer = create_detail_layer({
    scene,
    cells: [],
    materials,
    atlas,
    quality: 'high',
    uploads,
    clouds: { shadow_at: () => float(1) },
    sun_direction: uniform(new Vector3(0, 1, 0)),
  })
  layer.set_quality('low', atlas)
  layer.retain('lower', [0, 0, 0], cells)
  layer.retain('upper', [0, 32, 0], cells)
  uploads.drain([0, 0, 0], 131072, 1)
  expect(scene.children).toHaveLength(1)
  expect(scene.children[0]!.castShadow).toBe(false)
  layer.remove('lower')
  expect(scene.children).toHaveLength(1)
  layer.remove('upper')
  expect(scene.children).toHaveLength(0)
  layer.retain('reload', [0, 0, 0], cells)
  expect(uploads.size()).toBe(1)
  layer.remove('reload')
  uploads.drain([0, 0, 0], 131072, 1)
  expect(scene.children).toHaveLength(0)
  layer.dispose()
  atlas.dispose()
})
