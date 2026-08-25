// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Material, Object3D } from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

type VariantMapping = Readonly<{ variants?: readonly number[]; material?: number }>

const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '')

const material_for = async (
  gltf: GLTF,
  mappings: readonly VariantMapping[],
  variant_index: number,
  variant: string
): Promise<Material | null> => {
  const indexes = mappings
    .filter(({ variants }) => variants?.includes(variant_index))
    .flatMap(({ material }) => (material === undefined ? [] : [material]))
  if (indexes.length === 0) return null
  const materials = (await Promise.all(
    indexes.map((index) => gltf.parser.getDependency('material', index))
  )) as Material[]
  if (materials.length === 1) return materials[0]!
  const wanted = normalized(variant)
  return (
    materials.find(({ name }) => normalized(name) === wanted) ??
    materials.find(({ name }) => normalized(name).endsWith(wanted)) ??
    null
  )
}

/** Apply one KHR_materials_variants skin before instance-owned materials are cloned. */
export const apply_gltf_variant = async (gltf: GLTF, root: Object3D, variant: string | null): Promise<void> => {
  if (!variant) return
  const json = gltf.parser.json as Readonly<{
    extensions?: Readonly<{ KHR_materials_variants?: Readonly<{ variants?: readonly Readonly<{ name?: string }>[] }> }>
  }>
  const variants = json.extensions?.KHR_materials_variants?.variants ?? []
  const variant_index = variants.findIndex(({ name }) => name?.toLowerCase() === variant.toLowerCase())
  if (variant_index < 0) throw new Error(`Model variant ${variant} is absent from its GLB.`)

  const changes: Promise<boolean>[] = []
  root.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean
      material?: Material | Material[]
      userData: Readonly<{
        gltfExtensions?: Readonly<{
          KHR_materials_variants?: Readonly<{ mappings?: readonly VariantMapping[] }>
        }>
      }>
    }
    if (!mesh.isMesh) return
    const mappings = mesh.userData.gltfExtensions?.KHR_materials_variants?.mappings ?? []
    changes.push(
      material_for(gltf, mappings, variant_index, variant).then((material) => {
        if (material) {
          mesh.material = material
          return true
        }
        if (mappings.some(({ variants: indexes }) => indexes?.includes(variant_index)))
          throw new Error(`Model variant ${variant} has ambiguous material mappings.`)
        return false
      })
    )
  })
  if (!(await Promise.all(changes)).some(Boolean)) throw new Error(`Model variant ${variant} has no material mapping.`)
}
