// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Proven legacy avatar contract: one scaled body owns hair, three-mask recoloring, and worn bone children.
import {
  Box3,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { clone as clone_skinned } from 'three/addons/utils/SkeletonUtils.js'

import type { EntityModel } from './entity_model.ts'
import { load_gltf_source } from './gltf_loader.ts'
import type { CharacterAppearanceRender, WornModelRender } from './types.ts'

type ModelMaterial = Material & {
  map?: Texture | null
  emissiveMap?: Texture | null
  metalness?: number
  roughness?: number
  needsUpdate: boolean
}

type LoadedPart = Readonly<{ root: Object3D; materials: readonly Material[] }>
type Pixels = Readonly<{ data: Uint8ClampedArray; width: number; height: number }>

const CHARACTER_HEIGHT = 1.4
const PLACEHOLDER_COLOR = 0x8a8fa3
const material_rows = (material: Material | Material[]): readonly Material[] =>
  Array.isArray(material) ? material : [material]

const clone_materials = (root: Object3D): readonly Material[] => {
  const clones = new Map<Material, Material>()
  const clone = (original: Material): Material => {
    const cached = clones.get(original)
    if (cached) return cached
    const copy = original.clone()
    clones.set(original, copy)
    return copy
  }
  root.traverse((object) => {
    const mesh = object as Object3D & { isMesh?: boolean; material?: Material | Material[] }
    if (!mesh.isMesh || !mesh.material) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material)
  })
  return Object.freeze([...clones.values()])
}

export const find_character_bone = (origin: Object3D, name: string): Object3D | null => {
  let bone: Object3D | null = null
  const wanted = name.toLowerCase()
  origin.traverse((object) => {
    const candidate = object as Object3D & { isBone?: boolean }
    if (!bone && candidate.isBone && candidate.name.toLowerCase().includes(wanted)) bone = candidate
  })
  return bone
}

export const mount_character_part = ({
  body,
  part,
  slot,
  hair,
}: Readonly<{
  body: Object3D
  part: Object3D
  slot: 'head' | 'back'
  hair: Object3D | null
}>): boolean => {
  const bone = find_character_bone(body, slot === 'head' ? 'head' : 'cape')
  if (!bone) return false
  if (slot === 'head' && hair) hair.visible = false
  if (slot === 'back') part.rotation.set(Math.PI, 0, 0)
  bone.add(part)
  return true
}

export const compose_pixels = (
  base: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  rgb: readonly [number, number, number]
): Uint8ClampedArray<ArrayBuffer> => {
  const output = new Uint8ClampedArray(base.length)
  output.set(base)
  for (let index = 0; index < output.length; index += 4) {
    const alpha_byte = mask[index + 3] ?? 0
    if (alpha_byte < 128) continue
    const alpha = alpha_byte / 255
    const inverse = 1 - alpha
    output[index] = (mask[index] ?? 0) * rgb[0] * alpha + (output[index] ?? 0) * inverse
    output[index + 1] = (mask[index + 1] ?? 0) * rgb[1] * alpha + (output[index + 1] ?? 0) * inverse
    output[index + 2] = (mask[index + 2] ?? 0) * rgb[2] * alpha + (output[index + 2] ?? 0) * inverse
  }
  return output
}

const image_pixels = (image: CanvasImageSource & Readonly<{ width: number; height: number }>): Pixels | null => {
  if (typeof document === 'undefined' || image.width <= 0 || image.height <= 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height)
  return Object.freeze({ data: pixels.data, width: pixels.width, height: pixels.height })
}

const apply_colors = (root: Object3D, colors: readonly [string, string, string], owned_textures: Texture[]): void => {
  if (typeof document === 'undefined' || typeof ImageData === 'undefined') return
  const textures = new Map<string, Texture>()
  const materials = new Map<string, ModelMaterial[]>()
  root.traverse((object) => {
    const mesh = object as Object3D & { material?: Material | Material[] }
    if (!mesh.material) return
    material_rows(mesh.material).forEach((source_material) => {
      const material = source_material as ModelMaterial
      for (const texture of [material.map, material.emissiveMap]) if (texture?.name) textures.set(texture.name, texture)
      const map_name = material.map?.name
      if (!map_name) return
      const rows = materials.get(map_name)
      if (rows) rows.push(material)
      else materials.set(map_name, [material])
    })
  })
  const rgb = colors.map((value) => {
    const color = new Color(value)
    return Object.freeze([color.r, color.g, color.b] as const)
  })
  for (const [name, base_texture] of textures) {
    const match = name.match(/^(.+)_base$/)
    const image = base_texture.image as (CanvasImageSource & Readonly<{ width: number; height: number }>) | undefined
    const base = image ? image_pixels(image) : null
    if (!match?.[1] || !base) continue
    let output = new Uint8ClampedArray(base.data)
    for (const [index, layer] of ['color1', 'color2', 'color3'].entries()) {
      const mask_texture = textures.get(`${match[1]}_${layer}`)
      const mask_image = mask_texture?.image as
        (CanvasImageSource & Readonly<{ width: number; height: number }>) | undefined
      const mask = mask_image ? image_pixels(mask_image) : null
      const layer_color = rgb[index]
      if (mask && layer_color && mask.width === base.width && mask.height === base.height)
        output = compose_pixels(output, mask.data, layer_color)
    }
    const canvas = document.createElement('canvas')
    canvas.width = base.width
    canvas.height = base.height
    canvas.getContext('2d')?.putImageData(new ImageData(output, base.width, base.height), 0, 0)
    const texture = new CanvasTexture(canvas)
    texture.name = `${match[1]}_customized`
    texture.colorSpace = SRGBColorSpace
    texture.flipY = base_texture.flipY
    texture.wrapS = base_texture.wrapS
    texture.wrapT = base_texture.wrapT
    texture.needsUpdate = true
    owned_textures.push(texture)
    for (const material of materials.get(name) ?? []) {
      material.map = texture
      material.needsUpdate = true
    }
  }
}

const prepare_character = (root: Object3D): number => {
  root.scale.setScalar(1)
  root.updateWorldMatrix(true, true)
  const raw_height = new Box3().setFromObject(root).getSize(new Vector3()).y
  root.scale.setScalar(CHARACTER_HEIGHT / (raw_height > 0.05 ? raw_height : 1))
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
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    material_rows(mesh.material).forEach((material) => {
      const render_material = material as ModelMaterial
      if (typeof render_material.metalness === 'number') render_material.metalness = 0
      render_material.needsUpdate = true
    })
  })
  root.updateWorldMatrix(true, true)
  return new Box3().setFromObject(root).min.y
}

const apply_material_variant = async (gltf: GLTF, root: Object3D, variant: string | null): Promise<void> => {
  if (!variant) return
  const json = gltf.parser.json as Readonly<{
    extensions?: Readonly<{ KHR_materials_variants?: Readonly<{ variants?: readonly Readonly<{ name?: string }>[] }> }>
  }>
  const variants = json.extensions?.KHR_materials_variants?.variants ?? []
  const variant_index = variants.findIndex(({ name }) => name === variant)
  if (variant_index < 0) {
    console.warn(`Cosmetic variant ${variant} is absent from its GLB.`)
    return
  }
  const changes: Promise<void>[] = []
  root.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean
      material?: Material | Material[]
      userData: Readonly<{
        gltfExtensions?: Readonly<{
          KHR_materials_variants?: Readonly<{
            mappings?: readonly Readonly<{ variants?: readonly number[]; material?: number }>[]
          }>
        }>
      }>
    }
    if (!mesh.isMesh) return
    const mappings = mesh.userData.gltfExtensions?.KHR_materials_variants?.mappings ?? []
    const mapping = mappings.find(({ variants: indexes }) => indexes?.includes(variant_index))
    if (mapping?.material === undefined) return
    changes.push(
      gltf.parser.getDependency('material', mapping.material).then((material: Material) => {
        mesh.material = material
      })
    )
  })
  await Promise.all(changes)
}

const load_part = async (spec: WornModelRender): Promise<LoadedPart> => {
  const gltf = await load_gltf_source(spec.url)
  const root = clone_skinned(gltf.scene)
  await apply_material_variant(gltf, root, spec.variant)
  const materials = clone_materials(root)
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
    material_rows(mesh.material).forEach((material) => {
      const worn = material as ModelMaterial
      if (typeof worn.metalness === 'number') worn.metalness = 0.35
      if (typeof worn.roughness === 'number') worn.roughness = 0.4
      worn.needsUpdate = true
    })
  })
  return Object.freeze({ root, materials })
}

const placeholder_model = (): EntityModel => {
  const root = new Group()
  const tint = new Color(PLACEHOLDER_COLOR)
  const radius = CHARACTER_HEIGHT * 0.22
  const geometry = new CapsuleGeometry(radius, CHARACTER_HEIGHT - radius * 2, 4, 12)
  const material = new MeshStandardMaterial({
    color: tint,
    emissive: tint.clone().multiplyScalar(0.25),
    roughness: 0.65,
    metalness: 0,
  })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = CHARACTER_HEIGHT / 2
  mesh.castShadow = true
  mesh.name = 'entity_placeholder'
  root.add(mesh)
  let disposed = false
  return Object.freeze({
    root,
    clips: Object.freeze([]),
    min_y: 0,
    dispose: () => {
      if (disposed) return
      disposed = true
      geometry.dispose()
      material.dispose()
    },
  })
}

export const create_character_model = async (appearance: CharacterAppearanceRender): Promise<EntityModel> => {
  if (!appearance.body_url) return placeholder_model()
  const body_gltf = await load_gltf_source(appearance.body_url)
  const root = clone_skinned(body_gltf.scene)
  const owned_materials = [...clone_materials(root)]
  const owned_textures: Texture[] = []
  const min_y = prepare_character(root)
  apply_colors(root, appearance.colors, owned_textures)

  let hair: Object3D | null = null
  if (appearance.hair_url) {
    const head = find_character_bone(root, 'Head')
    if (head) {
      const hair_gltf = await load_gltf_source(appearance.hair_url)
      hair = clone_skinned(hair_gltf.scene)
      owned_materials.push(...clone_materials(hair))
      apply_colors(hair, appearance.colors, owned_textures)
      head.add(hair)
    } else console.warn(`Character body ${appearance.body_url} has no Head bone; hair was skipped.`)
  }

  const attach = async (slot: 'head' | 'back', spec: WornModelRender | null): Promise<void> => {
    if (!spec) return
    if (!find_character_bone(root, slot === 'head' ? 'head' : 'cape')) {
      console.warn(`Character body ${appearance.body_url} has no ${slot === 'head' ? 'Head' : 'cape'} bone.`)
      return
    }
    try {
      const part = await load_part(spec)
      owned_materials.push(...part.materials)
      mount_character_part({ body: root, part: part.root, slot, hair })
    } catch (error) {
      console.warn(`Failed to attach ${slot} cosmetic ${spec.url}.`, error)
    }
  }
  await Promise.all([attach('head', appearance.worn.head), attach('back', appearance.worn.back)])

  let disposed = false
  return Object.freeze({
    root,
    clips: Object.freeze([...body_gltf.animations]),
    min_y,
    dispose: () => {
      if (disposed) return
      disposed = true
      root.traverse((object) => {
        const skinned = object as Object3D & { isSkinnedMesh?: boolean; skeleton?: { dispose?: () => void } }
        if (skinned.isSkinnedMesh) skinned.skeleton?.dispose?.()
      })
      owned_textures.forEach((texture) => texture.dispose())
      owned_materials.forEach((material) => material.dispose())
    },
  })
}
