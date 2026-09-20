// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type Matrix4,
  type MeshStandardMaterial,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three'
import { MeshStandardNodeMaterial, type NodeBuilder } from 'three/webgpu'
import {
  attribute,
  Fn,
  mat4,
  mix,
  normalLocal,
  positionLocal,
  tangentLocal,
  texture,
  transformNormal,
  vec4,
} from 'three/tsl'

import type { CharacterEntityRender } from './types.ts'
export const BATCH_CAPACITY = 256
const MATRIX_ATTRIBUTES = ['crowdMatrix0', 'crowdMatrix1', 'crowdMatrix2', 'crowdMatrix3'] as const
// Vertex attributes bind per geometry, so shader construction does not capture a batch's matrix buffer.
// This path has no temporal/motion-vector pass; previous-instance matrices are deliberately absent.
const instance_position = Fn((_inputs: [], builder: NodeBuilder) => {
  const columns = MATRIX_ATTRIBUTES.map((name) => vec4(attribute<'vec4'>(name, 'vec4')))
  const matrix = mat4(columns[0]!, columns[1]!, columns[2]!, columns[3]!)
  if (builder.geometry.hasAttribute('normal')) normalLocal.assign(transformNormal(normalLocal, matrix))
  if (builder.geometry.hasAttribute('tangent')) tangentLocal.assign(matrix.mul(vec4(tangentLocal, 0)).xyz.normalize())
  return matrix.mul(positionLocal).xyz
})()
const COLOR_ATTRIBUTES = Object.freeze(['crowdColor1', 'crowdColor2', 'crowdColor3'] as const)
export type CrowdSpec = CharacterEntityRender &
  Readonly<{ anchor: Readonly<{ kind: 'world'; position: readonly [number, number, number] }> }>
export type CrowdMesh = Mesh<InstancedBufferGeometry> & {
  instance_matrix: InstancedInterleavedBuffer
}
export type BatchMesh = Readonly<{
  mesh: CrowdMesh
  geometry: InstancedBufferGeometry
  materials: readonly Material[]
  dispose: () => void
  attachment: Readonly<{ bone: Object3D; offset: Matrix4 }> | null
}>
const material_rows = (material: Material | Material[]): readonly Material[] =>
  Array.isArray(material) ? material : [material]

export const texture_rows = (root: Object3D): ReadonlyMap<string, Texture> => {
  const rows = new Map<string, Texture>()
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    material_rows(mesh.material).forEach((material) => {
      const { map } = material as MeshStandardMaterial
      if (map?.name) rows.set(map.name, map)
    })
  })
  return rows
}

// Source textures are immutable. Reuse their color graph so compatible poses share shader plans.
const color_nodes = new WeakMap<Texture, Map<string, NonNullable<MeshStandardNodeMaterial['colorNode']>>>()
const crowd_color_node = (base: Texture, textures: ReadonlyMap<string, Texture>) => {
  const prefix = base.name.match(/^(.+)_base$/)?.[1]
  const masks = COLOR_ATTRIBUTES.map((_, index) => (prefix ? textures.get(`${prefix}_color${index + 1}`) : undefined))
  const key = masks.map((mask) => mask?.uuid ?? '').join(':')
  const variants = color_nodes.get(base) ?? new Map<string, NonNullable<MeshStandardNodeMaterial['colorNode']>>()
  const cached = variants.get(key)
  if (cached) return cached
  const sampled = texture(base)
  let { rgb } = sampled
  masks.forEach((mask, index) => {
    if (!mask) return
    const sampled_mask = texture(mask)
    rgb = mix(rgb, sampled_mask.rgb.mul(attribute(COLOR_ATTRIBUTES[index]!, 'vec3')), sampled_mask.a)
  })
  const node = vec4(rgb, sampled.a)
  variants.set(key, node)
  color_nodes.set(base, variants)
  return node
}

const crowd_material = (source: Material, textures: ReadonlyMap<string, Texture>): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial()
  material.copy(source as MeshStandardMaterial)
  material.positionNode = instance_position
  const { map } = source as MeshStandardMaterial
  if (map) material.colorNode = crowd_color_node(map, textures)
  return material
}

export const prepare_mesh = (
  mesh: Mesh,
  textures: ReadonlyMap<string, Texture>,
  matrices: InstancedInterleavedBuffer,
  colors: readonly InterleavedBufferAttribute[],
  attachment: BatchMesh['attachment']
): BatchMesh => {
  const geometry = new InstancedBufferGeometry().copy(mesh.geometry as InstancedBufferGeometry)
  geometry.instanceCount = 0
  MATRIX_ATTRIBUTES.forEach((name, index) =>
    geometry.setAttribute(name, new InterleavedBufferAttribute(matrices, 4, index * 4))
  )
  COLOR_ATTRIBUTES.forEach((name, index) => geometry.setAttribute(name, colors[index]!))
  const materials = material_rows(mesh.material).map((material) => crowd_material(material, textures))
  mesh.geometry = geometry
  mesh.material = Array.isArray(mesh.material) ? [...materials] : materials[0]!
  const instanced = mesh as CrowdMesh
  instanced.instance_matrix = matrices
  instanced.frustumCulled = false
  instanced.castShadow = true
  instanced.receiveShadow = true
  return Object.freeze({
    mesh: instanced,
    geometry,
    materials: Object.freeze(materials),
    attachment,
    dispose: () => {
      geometry.dispose()
      materials.forEach((material) => material.dispose())
    },
  })
}

export const write_color = (attribute_row: InterleavedBufferAttribute, index: number, value: string): void => {
  const color = new Color(value)
  attribute_row.setXYZ(index, color.r, color.g, color.b)
}

export const upload_colors = (batch: Readonly<{ color_buffer: InstancedInterleavedBuffer }>, count: number): void => {
  batch.color_buffer.clearUpdateRanges()
  batch.color_buffer.addUpdateRange(0, count * batch.color_buffer.stride)
  batch.color_buffer.needsUpdate = true
}

export const upload_instances = (attribute_row: InstancedInterleavedBuffer, count: number): void => {
  attribute_row.clearUpdateRanges()
  attribute_row.addUpdateRange(0, count * attribute_row.stride)
  attribute_row.needsUpdate = true
}

export const instance_matrix = (spec: CrowdSpec, scale: number, target: Matrix4): Matrix4 => {
  const [x, y, z] = spec.anchor.position
  return target
    .makeRotationY(spec.facing.kind === 'yaw' ? spec.facing.yaw : 0)
    .setPosition(x / scale, y / scale, z / scale)
}

export const same_colors = (left: readonly CrowdSpec[], right: readonly CrowdSpec[]): boolean =>
  left.length === right.length &&
  left.every((spec, index) =>
    spec.appearance.colors.every((color, slot) => color === right[index]?.appearance.colors[slot])
  )

export const create_instance_buffers = () => {
  const base_matrices = new InstancedInterleavedBuffer(new Float32Array(BATCH_CAPACITY * 16), 16, 1).setUsage(
    DynamicDrawUsage
  )
  const color_buffer = new InstancedInterleavedBuffer(new Float32Array(BATCH_CAPACITY * 9), 9, 1).setUsage(
    DynamicDrawUsage
  )
  const colors = COLOR_ATTRIBUTES.map((_, index) => new InterleavedBufferAttribute(color_buffer, 3, index * 3))
  return { base_matrices, color_buffer, colors }
}
