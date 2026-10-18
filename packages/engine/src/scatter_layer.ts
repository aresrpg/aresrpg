// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Worker-built vegetation keeps one merged draw and one disposable material per resident chunk.
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, Sphere, Vector3, type Scene } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { Fn, attribute, float, positionWorld, texture } from 'three/tsl'

import { create_nature_texture } from './nature/surface_texture.ts'
import type { ScatterMeshData } from './scatter_mesh.ts'
import { plant_wind_position } from './nature/plant_wind.ts'
import { macro_surface_tint_nodes } from './terrain_tint.ts'
import { occlusion_dither_discard, type BoardOcclusion } from './board_occlusion.ts'
import type { RenderedChunk } from './types.ts'

const scatter_geometry = ({ attributes, bounds }: ScatterMeshData): BufferGeometry => {
  const geometry = new BufferGeometry()
  Object.entries(attributes).forEach(([name, { values, size }]) =>
    geometry.setAttribute(name, new BufferAttribute(values, size))
  )
  geometry.boundingSphere = new Sphere(new Vector3(...bounds.center), bounds.radius)
  return geometry
}

export type ScatterLayer = Readonly<{
  set_visible: (visible: boolean) => void
  add: (chunk: RenderedChunk, data: ScatterMeshData | null) => void
  remove: (key: string) => void
  dispose: () => void
}>

export const create_scatter_layer = ({
  scene,
  board_occlusion,
}: Readonly<{ scene: Scene; board_occlusion: BoardOcclusion }>): ScatterLayer => {
  const group = new Group()
  scene.add(group)
  const meshes = new Map<string, Mesh<BufferGeometry, MeshStandardNodeMaterial>>()
  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.9, metalness: 0 })
  // The clutter's color follows the SAME macro climate field the ground uses — living kinds
  // (tint attribute 1) shift with dry/lush regions exactly like the surface they grow from.
  const surface = create_nature_texture()
  const authored = attribute('color', 'vec3' as const)
  const tint = macro_surface_tint_nodes({
    paired_color: authored,
    roughness: float(0.9),
    climate_tint: attribute('tint', 'float' as const),
    position_world: { x: positionWorld.x, z: positionWorld.z },
    patch_scale: 0,
  })
  // CLUTTER MELTS FOR A BOARD. Grass grows through a slab that was laid on top of it, and it
  // stands between the camera and the arena — both are the peephole's job. Unlike terrain this
  // is one thin sprite layer, never the depth workhorse, so it carries the discard directly
  // rather than paying for a second material; the uniform folds it away when nothing is mounted.
  material.colorNode = Fn(() => {
    occlusion_dither_discard(board_occlusion)
    return tint.tint_albedo(authored.mul(texture(surface).rgb))
  })() as ReturnType<typeof tint.tint_albedo>
  material.roughnessNode = tint.roughness_node
  material.positionNode = plant_wind_position()
  const remove = (key: string): void => {
    const mesh = meshes.get(key)
    if (!mesh) return
    meshes.delete(key)
    group.remove(mesh)
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
  return Object.freeze({
    set_visible: (next: boolean) => {
      group.visible = next
    },
    add: (chunk: RenderedChunk, data: ScatterMeshData | null) => {
      // A chunk re-rendered at a coarser lod sheds its clutter (walking away demotes near→mid).
      if (!data) {
        remove(chunk.key)
        return
      }
      if (meshes.has(chunk.key)) return
      const geometry = scatter_geometry(data)
      // Chunk-owned material lifetime releases Three's per-object render bindings on eviction.
      // The cloned node material still shares its shader graph and world uniforms.
      const mesh = new Mesh(geometry, material.clone())
      mesh.position.set(chunk.origin[0], chunk.origin[1], chunk.origin[2])
      mesh.castShadow = false
      mesh.receiveShadow = true
      meshes.set(chunk.key, mesh)
      group.add(mesh)
    },
    remove,
    dispose: () => {
      meshes.forEach((_, key) => remove(key))
      material.dispose()
      surface.dispose()
      scene.remove(group)
    },
  })
}
