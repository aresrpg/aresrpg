// Classic-WebGL scene compatibility for the minimal heightmap renderer. The fallback scene has no
// lights and cannot compile three/webgpu NodeMaterials, so every app-owned subtree is prepared once
// when mounted and again whenever an async GLB/hair/cosmetic child is added beneath it.

import { MeshBasicMaterial } from 'three'

/** Camera-invisible layer for WebGPU-only node materials. */
const NODE_MATERIAL_LAYER = 31
/** Object3D nodes already carrying the late-child observer; weak so detached rigs remain collectible. */
const WATCHED = new WeakSet()

/** @param {any} material @returns {boolean} */
function needs_unlit_fallback(material) {
  if (!material || material.isNodeMaterial || material.isMeshBasicMaterial) return false
  return !!(
    material.isMeshStandardMaterial ||
    material.isMeshPhysicalMaterial ||
    material.isMeshLambertMaterial ||
    material.isMeshPhongMaterial ||
    material.isMeshToonMaterial
  )
}

/** Preserve the painted skin and cutout/render-state fields while dropping the runtime light model. @param {any} material */
function unlit_material(material) {
  const basic = new MeshBasicMaterial({
    color: material.color ?? 0xffffff,
    map: material.map ?? null,
    alphaMap: material.alphaMap ?? null,
    aoMap: material.aoMap ?? null,
    lightMap: material.lightMap ?? null,
    opacity: material.opacity,
    transparent: material.transparent,
    alphaTest: material.alphaTest,
    side: material.side,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    colorWrite: material.colorWrite,
    vertexColors: material.vertexColors,
    wireframe: material.wireframe,
    fog: material.fog,
    toneMapped: material.toneMapped,
  })
  basic.name = material.name
  basic.blending = material.blending
  basic.premultipliedAlpha = material.premultipliedAlpha
  basic.polygonOffset = material.polygonOffset
  basic.polygonOffsetFactor = material.polygonOffsetFactor
  basic.polygonOffsetUnits = material.polygonOffsetUnits
  basic.visible = material.visible
  basic.userData = { ...material.userData }
  // Mob instances own/dispose their original cloned PBR materials (mob_model.js). Preserve that
  // ownership edge so replacing one here cannot leak a compiled Basic material across despawns.
  const on_source_dispose = () => {
    material.removeEventListener('dispose', on_source_dispose)
    basic.dispose()
  }
  const on_basic_dispose = () => {
    basic.removeEventListener('dispose', on_basic_dispose)
    material.removeEventListener('dispose', on_source_dispose)
  }
  material.addEventListener('dispose', on_source_dispose)
  basic.addEventListener('dispose', on_basic_dispose)
  return basic
}

/**
 * Replaces classic lit mesh materials below `root` with texture-preserving MeshBasicMaterial instances.
 * Shared materials remain shared within the subtree. NodeMaterials are handled by the parking pass below.
 * @param {import('three').Object3D} root
 * @returns {number}
 */
export function replace_lit_materials(root) {
  const replacements = new Map()
  let replaced = 0
  const replace_one = (/** @type {any} */ material) => {
    if (!needs_unlit_fallback(material)) return material
    let basic = replacements.get(material)
    if (!basic) {
      basic = unlit_material(material)
      replacements.set(material, basic)
    }
    replaced += 1
    return basic
  }
  root.traverse((/** @type {any} */ object) => {
    if (!object.isMesh || !object.material) return
    object.material = Array.isArray(object.material) ? object.material.map(replace_one) : replace_one(object.material)
  })
  return replaced
}

/**
 * Parks every node-material object below `root` away from the classic fallback camera.
 * @param {import('three').Object3D} root
 * @returns {number}
 */
export function park_node_material_objects(root) {
  let parked = 0
  root.traverse((/** @type {any} */ object) => {
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
    if (!materials.some((/** @type {any} */ material) => material?.isNodeMaterial)) return
    if (!object.layers.isEnabled(NODE_MATERIAL_LAYER)) parked += 1
    object.layers.set(NODE_MATERIAL_LAYER)
  })
  return parked
}

/**
 * Applies both fallback material policies and observes every node for async `childadded` events. This
 * covers create_character_avatar's initially empty root plus later body, hair, and worn-cosmetic children.
 * @param {import('three').Object3D} root
 * @param {{ on_node_material?: () => void }} [options]
 * @returns {{ replaced: number, parked: number }}
 */
export function prepare_webgl_scene_object(root, { on_node_material } = {}) {
  const prepare_subtree = (/** @type {import('three').Object3D} */ subtree) => {
    const replaced = replace_lit_materials(subtree)
    const parked = park_node_material_objects(subtree)
    if (parked > 0) on_node_material?.()
    subtree.traverse((/** @type {import('three').Object3D} */ object) => {
      if (WATCHED.has(object)) return
      WATCHED.add(object)
      object.addEventListener('childadded', (/** @type {{ child: import('three').Object3D }} */ event) => {
        prepare_subtree(event.child)
      })
    })
    return { replaced, parked }
  }
  return prepare_subtree(root)
}
