// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one creature-model factory. Every fight surface and future world spawn uses this render policy.
import {
  AnimationMixer,
  Box3,
  Color,
  Vector3,
  type AnimationClip,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three'
import { clone as clone_skinned } from 'three/addons/utils/SkeletonUtils.js'

import { load_gltf_source } from './gltf_loader.ts'
import { apply_gltf_variant } from './gltf_variant.ts'
import { prepare_pixel_texture } from './model_texture.ts'

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
  for (const texture of new Set([material.map, material.emissiveMap])) prepare_pixel_texture(texture)
  material.needsUpdate = true
}

export const prepare_mob_model_root = (root: Object3D, clips: readonly AnimationClip[], label: string): number => {
  const idle = clips.find(({ name }) => name.toUpperCase().includes('IDLE'))
  if (idle) {
    const reference_pose = new AnimationMixer(root)
    reference_pose.clipAction(idle).play()
    // Several inherited GLBs have a malformed bind pose at t=0. Sample the authored idle itself,
    // where the creature actually stands, so off-centre rigs still land on their feet.
    reference_pose.setTime(idle.duration / 2)
  }
  root.scale.setScalar(1)
  root.updateWorldMatrix(true, true)
  const bounds = new Box3()
  root.traverse((object) => {
    const skinned = object as SkinnedMesh
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox()
      bounds.union(skinned.boundingBox.clone().applyMatrix4(skinned.matrixWorld))
      return
    }
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
  })
  if (bounds.isEmpty()) console.warn(`[mob_model] "${label}" has no measurable idle-pose bounds`)
  // Creature GLBs already author meaningful relative sizes: spiders are short, skeletons are
  // tall, sheep are squat. Preserve those proportions; the entity layer adds only context and
  // level scaling. Flattening every species to one height made small fauna character-sized.
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
  return bounds.isEmpty() ? 0 : bounds.min.y
}

export const create_mob_model = async (url: string, label = url, variant: string | null = null): Promise<MobModel> => {
  const gltf = await load_gltf_source(url)
  const root = clone_skinned(gltf.scene)
  await apply_gltf_variant(gltf, root, variant)
  const materials = clone_materials(root)
  const min_y = prepare_mob_model_root(root, gltf.animations, label)
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

/** Warm the shared parsed-GLB cache without constructing a scene instance. */
export const preload_mob_model = (url: string): void => {
  void load_gltf_source(url).catch((error: unknown) => console.error(`Failed to preload mob model ${url}.`, error))
}
