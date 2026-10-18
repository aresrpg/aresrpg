// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Float32BufferAttribute, Group, Matrix4, Mesh, Vector3, type Camera, type Object3D } from 'three'

import { create_spell_actor_mask } from '../src/claude_spell_actor_mask.ts'

export const compare_spell_mask = async (roots: readonly Object3D[], camera: Camera) => {
  const canvas = document.createElement('canvas'),
    gl = canvas.getContext('webgl')!
  const mask = await create_spell_actor_mask(gl),
    reference = new Group(),
    point = new Vector3()
  const geometries: Mesh['geometry'][] = []
  roots.forEach((root) =>
    root.traverseVisible((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh || !mesh.geometry.attributes.position) return
      const geometry = mesh.geometry.clone(),
        positions = new Float32Array(geometry.attributes.position!.count * 3)
      for (let index = 0; index < positions.length / 3; index += 1) {
        mesh.getVertexPosition(index, point)
        point.toArray(positions, index * 3)
      }
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometries.push(geometry)
      const snapshot = new Mesh(geometry)
      snapshot.matrixAutoUpdate = false
      snapshot.matrix.copy(mesh.matrixWorld)
      reference.add(snapshot)
    })
  )
  reference.updateMatrixWorld(true)
  const framebuffer = gl.createFramebuffer()!,
    projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const read = (objects: readonly Object3D[]) => {
    mask.render(objects, projection, 320, 224)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mask.texture, 0)
    const pixels = new Uint8Array(320 * 224 * 4)
    gl.readPixels(0, 0, 320, 224, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return pixels
  }
  const gpu = read(roots),
    cpu = read([reference])
  let different = 0,
    filled = 0
  for (let index = 0; index < gpu.length; index += 4) {
    if (gpu[index] !== cpu[index]) different += 1
    if (cpu[index]) filled += 1
  }
  const error = gl.getError()
  mask.dispose()
  gl.deleteFramebuffer(framebuffer)
  geometries.forEach((geometry) => geometry.dispose())
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { different, filled, error }
}
