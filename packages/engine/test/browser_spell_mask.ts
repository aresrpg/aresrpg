// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Float32BufferAttribute, Group, Mesh, Vector3, type Camera, type Object3D } from 'three'
import type { Renderer } from 'three/webgpu'

import { create_spell_actor_mask } from '../src/spell_actor_mask.ts'

export const compare_spell_mask = async (roots: readonly Object3D[], camera: Camera, renderer: Renderer) => {
  const mask = create_spell_actor_mask(renderer, camera),
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
  const read = async (objects: readonly Object3D[]) => {
    mask.render(objects, 320, 224)
    return renderer.readRenderTargetPixelsAsync(mask.target, 0, 0, 320, 224)
  }
  const gpu = await read(roots),
    cpu = await read([reference])
  let different = 0,
    filled = 0
  for (let index = 0; index < gpu.length; index += 4) {
    if (gpu[index] !== cpu[index]) different += 1
    if (cpu[index]) filled += 1
  }
  mask.dispose()
  geometries.forEach((geometry) => geometry.dispose())
  return { different, filled }
}
