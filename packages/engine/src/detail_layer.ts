// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  InterleavedBuffer,
  InterleavedBufferAttribute,
  BufferGeometry,
  Mesh,
  type DataArrayTexture,
  type Scene,
} from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node, type NodeBuilder } from 'three/webgpu'
import { Fn, attribute, float, int, mix, normalWorld, positionWorld, smoothstep, texture, uint, uv } from 'three/tsl'

import { get_quality_profile } from './quality.ts'
import type { UploadQueue } from './upload_queue.ts'
import type { Clouds } from './clouds.ts'
import { decode_detail_vertices, DETAIL_STRIDE, type DetailCell } from './detail_artifact.ts'
import { macro_tint_nodes, material_emission_node } from './terrain_tint.ts'
import type { CompiledMaterials } from './world_materials.ts'
import type { EngineQuality, Vec3 } from './types.ts'
import type { create_sky_node } from './sky/sky_node.ts'

const detail_geometry = (cell: DetailCell, materials: CompiledMaterials): BufferGeometry => {
  const values = decode_detail_vertices(cell.vertices)
  const ids = cell.palette.map((name) => materials.id_for(name))
  for (let index = 8; index < values.length; index += DETAIL_STRIDE) values[index] = ids[values[index]!]!
  const buffer = new InterleavedBuffer(values, DETAIL_STRIDE)
  const geometry = new BufferGeometry()
  const layouts = [
    ['position', 0, 3],
    ['normal', 3, 3],
    ['uv', 6, 2],
    ['detail_material', 8, 1],
  ] as const
  layouts.forEach(([name, offset, size]) => {
    geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, size, offset))
  })
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

const detail_material = (
  atlas: DataArrayTexture,
  materials: CompiledMaterials,
  quality: EngineQuality,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  clouds: Pick<Clouds, 'shadow_at'>
) => {
  const id = uint(attribute('detail_material', 'float' as const))
  const sample = texture(atlas, uv()).depth(int(id))
  const tint = macro_tint_nodes({ material_id: id, position_world: positionWorld, materials })
  const emission = material_emission_node(materials, id)
  const material = quality === 'low' ? new MeshBasicNodeMaterial() : new MeshStandardNodeMaterial()
  const light =
    quality === 'low'
      ? normalWorld
          .dot(sun_direction)
          .max(0)
          .mul(0.45)
          .add(0.55)
          .mul(mix(float(0.32), float(1), smoothstep(-0.14, 0.18, sun_direction.y)))
      : float(1)
  material.colorNode = tint.tint_albedo(sample.rgb).mul(light)
  if (material instanceof MeshStandardNodeMaterial) {
    material.roughnessNode = tint.roughness_node.add(sample.a.sub(0.5)).clamp(0.08, 1)
    material.emissiveNode = emission
    material.receivedShadowNode = Fn((args: readonly [Node<'float'>], _builder: NodeBuilder) =>
      args[0].mul(clouds.shadow_at(positionWorld.xz, positionWorld.y))
    ) as unknown as () => Node
  } else material.colorNode = material.colorNode.add(emission)
  return material
}

/** Baked surfaces follow terrain column residency and borrow its atlas. No independent streaming or textures. */
export const create_detail_layer = ({
  scene,
  cells,
  materials,
  atlas,
  quality,
  sun_direction,
  clouds,
  uploads,
}: Readonly<{
  scene: Scene
  cells: readonly DetailCell[]
  materials: CompiledMaterials
  atlas: DataArrayTexture
  quality: EngineQuality
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction']
  clouds: Pick<Clouds, 'shadow_at'>
  uploads: UploadQueue
}>) => {
  const columns = new Map<string, DetailCell[]>()
  // Each triangle is 108 bytes / 144 base64 characters: cuts need neither decoding nor padding repair.
  const triangles_per_job = Math.floor(
    get_quality_profile('low').chunks.upload_bytes_per_frame / (DETAIL_STRIDE * 3 * 4)
  )
  const encoded_part_size = triangles_per_job * DETAIL_STRIDE * 16
  const parts_for = (cell: DetailCell): DetailCell[] =>
    Array.from({ length: Math.ceil(cell.vertices.length / encoded_part_size) }, (_, index) => ({
      ...cell,
      vertices: cell.vertices.slice(index * encoded_part_size, (index + 1) * encoded_part_size),
    }))
  cells.forEach((cell) => {
    const key = `${cell.origin[0]},${cell.origin[2]}`
    columns.set(key, [...(columns.get(key) ?? []), ...parts_for(cell)])
  })
  const authored_columns = new Map(columns)
  const city_columns = new Set<string>()
  let current_atlas = atlas
  let current_quality = quality
  const resident = new Map<string, string>()
  const meshes = new Map<string, Mesh<BufferGeometry, MeshBasicNodeMaterial | MeshStandardNodeMaterial>[]>()
  let material = cells.length > 0 ? detail_material(atlas, materials, quality, sun_direction, clouds) : null
  let visible = false
  let lit = quality !== 'low'
  const job_key = (column: string, index: number) => `detail:${column}:${index}`
  const release = (column: string): void => {
    columns.get(column)?.forEach((_, index) => uploads.remove(job_key(column, index)))
    meshes.get(column)?.forEach((mesh) => {
      scene.remove(mesh)
      mesh.geometry.dispose()
    })
    meshes.delete(column)
    city_columns.delete(column)
    const authored = authored_columns.get(column)
    if (authored) columns.set(column, authored)
    else columns.delete(column)
  }
  return Object.freeze({
    retain: (key: string, origin: Vec3, city_cells: readonly DetailCell[] = []): void => {
      const column = `${origin[0]},${origin[2]}`
      if (city_cells.length > 0 && !city_columns.has(column)) {
        columns.set(column, [...(columns.get(column) ?? []), ...city_cells.flatMap(parts_for)])
        city_columns.add(column)
      }
      if (!columns.has(column)) return
      material ??= detail_material(current_atlas, materials, current_quality, sun_direction, clouds)
      resident.set(key, column)
      if (meshes.has(column)) return
      const rows: Mesh<BufferGeometry, MeshBasicNodeMaterial | MeshStandardNodeMaterial>[] = []
      meshes.set(column, rows)
      columns.get(column)!.forEach((cell, index) =>
        uploads.add({
          key: job_key(column, index),
          origin: cell.origin,
          bytes: (cell.vertices.length * 3) / 4,
          upload: () => {
            const mesh = new Mesh(detail_geometry(cell, materials), material!)
            mesh.position.set(...cell.origin)
            mesh.updateMatrix()
            mesh.matrixAutoUpdate = false
            mesh.visible = visible
            mesh.castShadow = lit
            mesh.receiveShadow = lit
            rows.push(mesh)
            scene.add(mesh)
            return true
          },
        })
      )
    },
    remove: (key: string): void => {
      const column = resident.get(key)
      resident.delete(key)
      if (column && ![...resident.values()].includes(column)) release(column)
    },
    set_visible: (next: boolean): void => {
      if (next === visible) return
      visible = next
      meshes.forEach((rows) =>
        rows.forEach((mesh) => {
          mesh.visible = next
        })
      )
    },
    set_quality: (next: EngineQuality, next_atlas: DataArrayTexture): void => {
      current_atlas = next_atlas
      current_quality = next
      lit = next !== 'low'
      if (!material) return
      const previous = material
      material = detail_material(next_atlas, materials, next, sun_direction, clouds)
      meshes.forEach((rows) =>
        rows.forEach((mesh) => {
          mesh.material = material!
          mesh.castShadow = lit
          mesh.receiveShadow = lit
        })
      )
      previous.dispose()
    },
    dispose: (): void => {
      ;[...meshes.keys()].forEach(release)
      resident.clear()
      material?.dispose()
    },
  })
}
