// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rasterize current game silhouettes where the source program originally drew its dummy actors.
import { Matrix4, type BufferGeometry, type SkinnedMesh, type Skeleton, type Object3D } from 'three'

import { spell_gl_program } from './claude_spell_gl.ts'

const MASK_VERTEX = `
attribute vec3 p;
attribute vec4 skin_index, skin_weight;
uniform mat4 transform, bind_matrix, bind_inverse;
uniform highp sampler2D bones;
uniform float bone_rows;
uniform bool skinned;
mat4 bone(float index) {
  float row = (index + .5) / bone_rows;
  return mat4(texture2D(bones, vec2(.125, row)), texture2D(bones, vec2(.375, row)),
    texture2D(bones, vec2(.625, row)), texture2D(bones, vec2(.875, row)));
}
void main() {
  vec4 position = vec4(p, 1.);
  if (skinned) {
    vec4 bound = bind_matrix * position;
    position = bind_inverse * (bone(skin_index.x) * bound * skin_weight.x
      + bone(skin_index.y) * bound * skin_weight.y
      + bone(skin_index.z) * bound * skin_weight.z
      + bone(skin_index.w) * bound * skin_weight.w);
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

export const create_spell_actor_mask = async (gl: WebGLRenderingContext, signal?: AbortSignal) => {
  if (!gl.getExtension('OES_texture_float') || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) === 0)
    throw new Error('Spell masks require floating-point vertex textures')
  const program = await spell_gl_program(
    gl,
    MASK_VERTEX,
    'precision highp float;void main(){gl_FragColor=vec4(1.);}',
    signal
  )
  const texture = gl.createTexture()!,
    framebuffer = gl.createFramebuffer()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  // A complete, non-attached sampler is required even when a rigid mesh skips skinning.
  const empty_pose = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, empty_pose)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  const buffers = new Map<BufferGeometry, Buffers>()
  const poses = new Map<Skeleton, WebGLTexture>()
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
  const pose_texture = (skeleton: Skeleton): WebGLTexture => {
    const previous = poses.get(skeleton)
    if (previous) return previous
    const texture = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, skeleton.bones.length, 0, gl.RGBA, gl.FLOAT, null)
    poses.set(skeleton, texture)
    return texture
  }
  return {
    texture,
    prepare: (roots: readonly Object3D[]): void => {
      mask_meshes(roots).forEach((mesh) => {
        get_buffers(mesh.geometry)
        if (mesh.isSkinnedMesh) pose_texture(mesh.skeleton)
      })
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
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, empty_pose)
      program.use({ bones: 0 })
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
          const texture = pose_texture(mesh.skeleton)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, texture)
          if (!skeletons.has(mesh.skeleton)) {
            mesh.skeleton.update()
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
            gl.texSubImage2D(
              gl.TEXTURE_2D,
              0,
              0,
              0,
              4,
              mesh.skeleton.bones.length,
              gl.RGBA,
              gl.FLOAT,
              mesh.skeleton.boneMatrices!
            )
            skeletons.add(mesh.skeleton)
          }
          program.use({
            bones: 0,
            bone_rows: mesh.skeleton.bones.length,
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
      poses.forEach((texture, skeleton) => {
        if (!skeletons.has(skeleton)) {
          gl.deleteTexture(texture)
          poses.delete(skeleton)
        }
      })
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    },
    dispose: () => {
      buffers.forEach(release)
      buffers.clear()
      poses.forEach((texture) => gl.deleteTexture(texture))
      poses.clear()
      program.dispose()
      gl.deleteTexture(texture)
      gl.deleteTexture(empty_pose)
      gl.deleteFramebuffer(framebuffer)
    },
  }
}
