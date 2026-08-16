// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one creature-model factory. Every fight surface and future world spawn uses this render policy.
import {
  Box3,
  Color,
  LinearMipmapLinearFilter,
  NearestFilter,
  Vector3,
  type AnimationClip,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { clone as clone_skinned } from 'three/addons/utils/SkeletonUtils.js'

import { load_gltf_source } from './gltf_loader.ts'

export type MobModel = Readonly<{
  root: Object3D
  clips: readonly AnimationClip[]
  min_y: number
  dispose: () => void
}>

type RenderMaterial = Material & {
  metalness?: number
  map?: Texture | null
  emissiveMap?: Texture | null
  emissive?: Color
  emissiveIntensity?: number
}

const GLB_UNITS_TO_BLOCKS = 0.5
const MOB_MIN_HEIGHT = 0.35
const MOB_MAX_HEIGHT = 3.2
const MOB_EMISSIVE_FLOOR = 0.3
const material_rows = (material: Material | Material[]): readonly Material[] =>
  Array.isArray(material) ? material : [material]

const clone_materials = (root: Object3D): readonly Material[] => {
  const clones = new Map<Material, Material>()
  const owned = new Set<Material>()
  const clone = (original: Material): Material => {
    const cached = clones.get(original)
    if (cached) return cached
    const copy = original.clone()
    clones.set(original, copy)
    owned.add(copy)
    return copy
  }
  root.traverse((object) => {
    const mesh = object as Object3D & { isMesh?: boolean; material?: Material | Material[] }
    if (!mesh.isMesh || !mesh.material) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material)
  })
  return Object.freeze([...owned])
}

const prepare_material = (material: RenderMaterial): void => {
  if (typeof material.metalness === 'number') material.metalness = 0
  if (!material.map) return
  material.emissiveMap = material.map
  material.emissive = new Color(0xffffff)
  material.emissiveIntensity = MOB_EMISSIVE_FLOOR
  for (const texture of new Set([material.map, material.emissiveMap])) {
    texture.magFilter = NearestFilter
    texture.minFilter = LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 8
    texture.needsUpdate = true
  }
  material.needsUpdate = true
}

const prepare = (root: Object3D, label: string): number => {
  root.scale.setScalar(1)
  root.updateWorldMatrix(true, true)
  const raw_height = new Box3().setFromObject(root).getSize(new Vector3()).y
  const measured_height = raw_height > 0.05 ? raw_height : 1
  const intrinsic_height = measured_height * GLB_UNITS_TO_BLOCKS
  const final_height = Math.min(MOB_MAX_HEIGHT, Math.max(MOB_MIN_HEIGHT, intrinsic_height))
  if (final_height !== intrinsic_height)
    console.warn(
      `[mob_model] "${label}" height ${intrinsic_height.toFixed(2)} was clamped to ${final_height.toFixed(2)}`
    )
  root.scale.setScalar(final_height / measured_height)
  root.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean
      material?: Material | Material[]
      castShadow: boolean
      receiveShadow: boolean
      frustumCulled: boolean
    }
    if (!mesh.isMesh || !mesh.material) return
    mesh.castShadow = true
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    material_rows(mesh.material).forEach((material) => prepare_material(material as RenderMaterial))
  })
  root.updateWorldMatrix(true, true)
  return new Box3().setFromObject(root).min.y
}

export const create_mob_model = async (url: string, label = url): Promise<MobModel> => {
  const gltf = await load_gltf_source(url)
  const root = clone_skinned(gltf.scene)
  const materials = clone_materials(root)
  const min_y = prepare(root, label)
  let disposed = false
  return Object.freeze({
    root,
    clips: Object.freeze([...gltf.animations]),
    min_y,
    dispose: () => {
      if (disposed) return
      disposed = true
      root.traverse((object) => {
        const skinned = object as Object3D & { isSkinnedMesh?: boolean; skeleton?: { dispose?: () => void } }
        if (skinned.isSkinnedMesh) skinned.skeleton?.dispose?.()
      })
      materials.forEach((material) => material.dispose())
    },
  })
}
