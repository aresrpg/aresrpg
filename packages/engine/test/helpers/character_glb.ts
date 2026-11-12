// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { Matrix4, Quaternion, Vector3 } from 'three'

type DracoArray = { GetValue: (index: number) => number }
type DracoMesh = { num_points: () => number; num_faces: () => number }
type DracoDecoder = {
  DecodeArrayToMesh: (bytes: Uint8Array, length: number, mesh: DracoMesh) => { ok: () => boolean }
  GetAttributeByUniqueId: (mesh: DracoMesh, id: number) => { num_components: () => number }
  GetAttributeFloatForAllPoints: (mesh: DracoMesh, attribute: unknown, values: DracoArray) => void
  GetFaceFromMesh: (mesh: DracoMesh, face: number, values: DracoArray) => void
}
type Draco = {
  Decoder: new () => DracoDecoder
  Mesh: new () => DracoMesh
  DracoFloat32Array: new () => DracoArray
  DracoInt32Array: new () => DracoArray
  destroy: (value: unknown) => void
}
type Primitive = {
  attributes: Record<string, number>
  indices?: number
  extensions?: { KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> } }
}
type Node = {
  name?: string
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  children?: number[]
  mesh?: number
  skin?: number
}
type Document = {
  nodes: Node[]
  meshes: { primitives: Primitive[] }[]
  skins?: { joints: number[]; inverseBindMatrices: number }[]
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[]
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[]
  animations?: {
    name: string
    channels: { sampler: number; target: { node: number; path: string } }[]
    samplers: { input: number; output: number }[]
  }[]
}
const require_module = createRequire(import.meta.url)
const create_decoder = require_module('three/examples/jsm/libs/draco/draco_decoder.js') as () => Promise<Draco>
const decoder_module = await create_decoder()
const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

export const read_character_glb = (path: URL) => {
  const bytes = readFileSync(path)
  const length = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.subarray(20, 20 + length).toString()) as Document
  const binary_start = 28 + length
  const accessor = (index: number): number[][] => {
    const row = document.accessors[index]!
    const view = document.bufferViews[row.bufferView]!
    const width = widths[row.type]!
    const size = row.componentType === 5121 ? 1 : row.componentType === 5123 ? 2 : 4
    const read =
      row.componentType === 5126
        ? bytes.readFloatLE.bind(bytes)
        : row.componentType === 5121
          ? bytes.readUInt8.bind(bytes)
          : row.componentType === 5123
            ? bytes.readUInt16LE.bind(bytes)
            : bytes.readUInt32LE.bind(bytes)
    const start = binary_start + (view.byteOffset ?? 0) + (row.byteOffset ?? 0)
    return Array.from({ length: row.count }, (_, vertex) =>
      Array.from({ length: width }, (_, axis) => read(start + vertex * (view.byteStride ?? width * size) + axis * size))
    )
  }
  const parents = new Map(
    document.nodes.flatMap((node, index) => node.children?.map((child) => [child, index] as const) ?? [])
  )
  const world = (index: number, poses: ReadonlyMap<number, Partial<Node>> = new Map()): Matrix4 => {
    const row = { ...document.nodes[index]!, ...poses.get(index) }
    const local = row.matrix
      ? new Matrix4().fromArray(row.matrix)
      : new Matrix4().compose(
          new Vector3().fromArray(row.translation ?? [0, 0, 0]),
          new Quaternion().fromArray(row.rotation ?? [0, 0, 0, 1]),
          new Vector3().fromArray(row.scale ?? [1, 1, 1])
        )
    const parent = parents.get(index)
    return parent === undefined ? local : world(parent, poses).multiply(local)
  }
  const decode = (primitive: Primitive) => {
    const compressed = primitive.extensions?.KHR_draco_mesh_compression
    if (!compressed)
      return {
        attributes: Object.fromEntries(
          Object.entries(primitive.attributes).map(([name, index]) => [name, accessor(index)])
        ),
        indices: primitive.indices === undefined ? [] : accessor(primitive.indices).flat(),
      }
    const decoder = new decoder_module.Decoder()
    const mesh = new decoder_module.Mesh()
    const values = new decoder_module.DracoFloat32Array()
    const face = new decoder_module.DracoInt32Array()
    try {
      const view = document.bufferViews[compressed.bufferView]!
      const start = binary_start + (view.byteOffset ?? 0)
      const status = decoder.DecodeArrayToMesh(bytes.subarray(start, start + view.byteLength), view.byteLength, mesh)
      if (!status.ok()) throw new Error(`Invalid Draco mesh: ${path.pathname}`)
      const attributes = Object.fromEntries(
        Object.entries(compressed.attributes).map(([name, id]) => {
          const attribute = decoder.GetAttributeByUniqueId(mesh, id)
          decoder.GetAttributeFloatForAllPoints(mesh, attribute, values)
          const width = attribute.num_components()
          return [
            name,
            Array.from({ length: mesh.num_points() }, (_, vertex) =>
              Array.from({ length: width }, (_, axis) => values.GetValue(vertex * width + axis))
            ),
          ]
        })
      )
      const indices = Array.from({ length: mesh.num_faces() }, (_, index) => {
        decoder.GetFaceFromMesh(mesh, index, face)
        return [face.GetValue(0), face.GetValue(1), face.GetValue(2)]
      }).flat()
      return {
        attributes: {
          ...Object.fromEntries(
            Object.entries(primitive.attributes)
              .filter(([name]) => !(name in compressed.attributes))
              .map(([name, index]) => [name, accessor(index)])
          ),
          ...attributes,
        },
        indices,
      }
    } finally {
      for (const value of [face, values, mesh, decoder]) decoder_module.destroy(value)
    }
  }
  const meshes = document.nodes.flatMap((node, index) =>
    node.mesh === undefined
      ? []
      : document.meshes[node.mesh]!.primitives.map((primitive) => ({
          node,
          matrix: world(index),
          ...decode(primitive),
        }))
  )
  return { document, meshes, world, accessor }
}

export const head_geometry = (path: URL, frame: 'head' | 'helmet' = 'head') => {
  const model = read_character_glb(path)
  const head = model.document.nodes.findIndex(({ name }) => name?.endsWith(':Head'))
  if (head < 0) throw new Error(`Missing Head: ${path.pathname}`)
  const socket = model.document.nodes[head]!.children?.find((index) => model.document.nodes[index]!.name === 'Helmet')
  const attachment = frame === 'helmet' ? (socket ?? head) : head
  const inverse = model.world(attachment).invert()
  const vertices = model.meshes.flatMap(({ node, matrix, attributes }) => {
    const skin = model.document.skins?.[node.skin ?? -1]
    if (!skin) return []
    return attributes.POSITION!.flatMap((position, index) => {
      const joints = attributes.JOINTS_0![index]!
      const weights = attributes.WEIGHTS_0![index]!
      const head_weight = joints.reduce(
        (sum, joint, slot) => sum + (skin.joints[joint] === head ? weights[slot]! : 0),
        0
      )
      return head_weight > 0.5
        ? [{ point: new Vector3().fromArray(position).applyMatrix4(matrix).applyMatrix4(inverse), head_weight }]
        : []
    })
  })
  return { ...model, head, attachment, vertices }
}
