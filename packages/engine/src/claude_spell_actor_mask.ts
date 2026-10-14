// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rasterize current game silhouettes where the source program originally drew its dummy actors.
import { Matrix4, type BufferGeometry, type SkinnedMesh, type Object3D } from 'three'

import { spell_gl_program } from './claude_spell_gl.ts'

// 60 bones plus three matrices fit WebGL 1's minimum 256 vertex uniform vectors.
const MAX_SKIN_BONES = 60
const MASK_VERTEX = `
attribute vec3 p;
attribute vec4 skin_index, skin_weight;
uniform mat4 transform, bind_matrix, bind_inverse, bones[${MAX_SKIN_BONES}];
uniform bool skinned;
void main() {
  vec4 position = vec4(p, 1.);
  if (skinned) {
    vec4 bound = bind_matrix * position;
    position = bind_inverse * (bones[int(skin_index.x)] * bound * skin_weight.x
      + bones[int(skin_index.y)] * bound * skin_weight.y
      + bones[int(skin_index.z)] * bound * skin_weight.z
      + bones[int(skin_index.w)] * bound * skin_weight.w);
  }
  gl_Position = transform * position;
}`
type Buffers = Readonly<{
  vertices: WebGLBuffer
  indices: WebGLBuffer | null
  count: number
  index_type: number
}>

// Normalize interleaved and integer attributes once; the GPU owns all animated skinning.
const mask_vertices = (geometry: BufferGeometry): Float32Array => {
  const position = geometry.attributes.position!
  const packed = new Float32Array(position.count * 11)
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    for (const [name, offset, count] of [
      ['position', 0, 3],
      ['skinIndex', 3, 4],
      ['skinWeight', 7, 4],
    ] as const) {
      const attribute = geometry.getAttribute(name)
      if (!attribute) continue
      for (let component = 0; component < count; component += 1)
        packed[vertex * 11 + offset + component] = attribute.getComponent(vertex, component)
    }
  }
  return packed
}

const mask_meshes = (roots: readonly Object3D[]): readonly SkinnedMesh[] => {
  const meshes: SkinnedMesh[] = []
  roots.forEach((root) =>
    root.traverseVisible((object) => {
      const mesh = object as SkinnedMesh
      if (mesh.isMesh && mesh.geometry.attributes.position) meshes.push(mesh)
    })
  )
  return meshes
}

export const create_spell_actor_mask = (gl: WebGLRenderingContext) => {
  const program = spell_gl_program(gl, MASK_VERTEX, 'precision highp float;void main(){gl_FragColor=vec4(1.);}')
  const texture = gl.createTexture()!,
    framebuffer = gl.createFramebuffer()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const buffers = new Map<BufferGeometry, Buffers>()
  const matrix = new Matrix4()
  const attributes = [
    { location: 0, size: 3, offset: 0 },
    { location: gl.getAttribLocation(program.program, 'skin_index'), size: 4, offset: 3 },
    { location: gl.getAttribLocation(program.program, 'skin_weight'), size: 4, offset: 7 },
  ]
  let width = 0,
    height = 0
  const release = (buffer: Buffers): void => {
    gl.deleteBuffer(buffer.vertices)
    gl.deleteBuffer(buffer.indices)
  }
  const get_buffers = (geometry: BufferGeometry): Buffers => {
    const previous = buffers.get(geometry)
    if (previous) return previous
    const vertices = gl.createBuffer()!,
      { index } = geometry
    const indices = index ? gl.createBuffer() : null
    const index_type = index?.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    if (index_type === gl.UNSIGNED_INT && !gl.getExtension('OES_element_index_uint'))
      throw new Error('Spell mask needs 32-bit mesh indices')
    if (index && indices) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index.array, gl.STATIC_DRAW)
    }
    const position = geometry.attributes.position!
    const packed = mask_vertices(geometry)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW)
    const result = { vertices, indices, count: index?.count ?? position.count, index_type }
    buffers.set(geometry, result)
    return result
  }
  return {
    texture,
    prepare: (roots: readonly Object3D[]): void => {
      mask_meshes(roots).forEach((mesh) => get_buffers(mesh.geometry))
    },
    render: (roots: readonly Object3D[], projection: Matrix4, next_width: number, next_height: number): void => {
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      if (width !== next_width || height !== next_height) {
        width = next_width
        height = next_height
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      gl.viewport(0, 0, width, height)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const seen = new Set<BufferGeometry>()
      const skeletons = new Set<SkinnedMesh['skeleton']>()
      mask_meshes(roots).forEach((mesh) => {
        const buffer = get_buffers(mesh.geometry)
        seen.add(mesh.geometry)
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer.vertices)
        attributes.forEach(({ location, size, offset }) => {
          gl.enableVertexAttribArray(location)
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 44, offset * 4)
        })
        matrix.multiplyMatrices(projection, mesh.matrixWorld)
        program.use({ transform: matrix.elements, skinned: Number(mesh.isSkinnedMesh === true) })
        if (mesh.isSkinnedMesh) {
          if (mesh.skeleton.bones.length > MAX_SKIN_BONES)
            throw new Error('Spell mask exceeds the supported skin bone count')
          if (!skeletons.has(mesh.skeleton)) {
            mesh.skeleton.update()
            skeletons.add(mesh.skeleton)
          }
          program.use({
            bones: mesh.skeleton.boneMatrices!,
            bind_matrix: mesh.bindMatrix.elements,
            bind_inverse: mesh.bindMatrixInverse.elements,
          })
        }
        if (buffer.indices) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer.indices)
          gl.drawElements(gl.TRIANGLES, buffer.count, buffer.index_type, 0)
        } else gl.drawArrays(gl.TRIANGLES, 0, buffer.count)
      })
      attributes.slice(1).forEach(({ location }) => gl.disableVertexAttribArray(location))
      buffers.forEach((buffer, geometry) => {
        if (!seen.has(geometry)) {
          release(buffer)
          buffers.delete(geometry)
        }
      })
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    },
    dispose: () => {
      buffers.forEach(release)
      buffers.clear()
      program.dispose()
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
    },
  }
}
