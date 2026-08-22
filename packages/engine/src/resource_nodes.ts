// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chain-driven resource props. A patch is one chain row; its blocks are deterministic visual
// seats. Geometry is instanced by gathering job+tier, so hundreds of nodes cost at most 33 draws.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Scene,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { flora_cluster } from './nature/flora_cluster.ts'
import { grain_stalk } from './nature/grain_stalk.ts'
import { ore_vein } from './nature/ore_vein.ts'
import { plant_wind_position } from './nature/plant_wind.ts'
import { mulberry, type SpriteBuilder } from './nature/sprite_kit.ts'
import type { ResourceNodeMarker } from './types.ts'

export type ResourceFamily = 'FARMER' | 'HERBALIST' | 'MINER'

export const resource_nodes_visible = ({
  terrain_presented,
  flattened,
  board_active,
}: Readonly<{ terrain_presented: boolean; flattened: boolean; board_active: boolean }>): boolean =>
  terrain_presented && !flattened && !board_active

const BUILDERS: Readonly<Record<ResourceFamily, SpriteBuilder>> = Object.freeze({
  FARMER: grain_stalk,
  HERBALIST: flora_cluster,
  MINER: ore_vein,
})

// The deprecated build's visual law survives without copying 33 content ids: family chooses
// silhouette and the authored tier chooses one rung of its 11-step material ramp.
const HUES: Readonly<Record<ResourceFamily, readonly [number, number]>> = Object.freeze({
  FARMER: [48, 8],
  HERBALIST: [112, 286],
  MINER: [198, 318],
})

const clamp_tier = (tier: number): number => Math.max(1, Math.min(11, Math.trunc(tier)))

export const resource_visual = (job: string, tier: number) => {
  const family: ResourceFamily = job === 'FARMER' || job === 'MINER' ? job : 'HERBALIST'
  const step = (clamp_tier(tier) - 1) / 10
  const [hue_lo, hue_hi] = HUES[family]
  const hue = hue_lo + (hue_hi - hue_lo) * step
  const body = new Color().setHSL(hue / 360, family === 'MINER' ? 0.38 : 0.52, family === 'MINER' ? 0.3 : 0.28)
  const accent = new Color().setHSL(hue / 360, 0.72, 0.62)
  return Object.freeze({
    family,
    tier: clamp_tier(tier),
    body: Object.freeze([body.r, body.g, body.b] as const),
    accent: Object.freeze([accent.r, accent.g, accent.b] as const),
    scale: 0.9 + step * 0.22,
  })
}

const geometry_for = (job: string, tier: number): BufferGeometry => {
  const visual = resource_visual(job, tier)
  const recipe = BUILDERS[visual.family](mulberry(visual.tier * 977 + visual.family.length * 131))
  const positions = new Float32Array(recipe.length * 3)
  const colors = new Float32Array(recipe.length * 3)
  const normals = new Float32Array(recipe.length * 3)
  const sways = visual.family === 'MINER' ? null : new Float32Array(recipe.length)
  const phases = visual.family === 'MINER' ? null : new Float32Array(recipe.length)
  for (let start = 0; start < recipe.length; start += 3) {
    const base = start * 3
    for (let corner = 0; corner < 3; corner += 1) {
      const [x, y, z, blend, sway] = recipe[start + corner]!
      const offset = base + corner * 3
      positions[offset] = x
      positions[offset + 1] = y
      positions[offset + 2] = z
      colors[offset] = visual.body[0] + (visual.accent[0] - visual.body[0]) * blend
      colors[offset + 1] = visual.body[1] + (visual.accent[1] - visual.body[1]) * blend
      colors[offset + 2] = visual.body[2] + (visual.accent[2] - visual.body[2]) * blend
      if (sways && phases) {
        sways[start + corner] = sway
        phases[start + corner] = (x + z) * 0.8
      }
    }
    const ab = [
      positions[base + 3]! - positions[base]!,
      positions[base + 4]! - positions[base + 1]!,
      positions[base + 5]! - positions[base + 2]!,
    ]
    const ac = [
      positions[base + 6]! - positions[base]!,
      positions[base + 7]! - positions[base + 1]!,
      positions[base + 8]! - positions[base + 2]!,
    ]
    const normal = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ]
    const length = Math.hypot(...normal) || 1
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = base + corner * 3
      normals[offset] = normal[0]! / length
      normals[offset + 1] = normal[1]! / length
      normals[offset + 2] = normal[2]! / length
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  if (sways && phases) {
    geometry.setAttribute('sway', new BufferAttribute(sways, 1))
    geometry.setAttribute('phase', new BufferAttribute(phases, 1))
  }
  geometry.computeBoundingSphere()
  return geometry
}

const material_for = (
  visual: ReturnType<typeof resource_visual>,
  wind: boolean
): MeshStandardMaterial | MeshStandardNodeMaterial => {
  const options = {
    vertexColors: true,
    side: DoubleSide,
    roughness: visual.family === 'MINER' ? 0.55 : 0.9,
    metalness: visual.family === 'MINER' ? 0.12 : 0,
  }
  if (!wind || visual.family === 'MINER') return new MeshStandardMaterial(options)
  const material = new MeshStandardNodeMaterial(options)
  material.positionNode = plant_wind_position()
  return material
}

export const create_resource_node_layer = ({ scene, wind = false }: Readonly<{ scene: Scene; wind?: boolean }>) => {
  const meshes = new Map<string, InstancedMesh>()
  const anchors = new Map<string, Object3D>()
  const labels = new Map<string, CSS2DObject>()
  let markers = new Map<string, ResourceNodeMarker>()
  // The backend reveals resource dressing only after its first terrain frame has presented.
  let visible = false

  const clear_meshes = (): void => {
    meshes.forEach((mesh) => {
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as MeshStandardMaterial).dispose()
    })
    meshes.clear()
  }

  const set_markers = (next: readonly ResourceNodeMarker[]): void => {
    clear_meshes()
    const wanted = new Set(next.map(({ id }) => id))
    for (const [id, anchor] of anchors)
      if (!wanted.has(id)) {
        scene.remove(anchor)
        anchors.delete(id)
        labels.delete(id)
      }
    markers = new Map(next.map((marker) => [marker.id, marker]))
    const buckets = new Map<string, ResourceNodeMarker[]>()
    next.forEach((row) => {
      const key = `${row.job}:${clamp_tier(row.tier)}`
      const rows = buckets.get(key) ?? []
      rows.push(row)
      buckets.set(key, rows)
    })
    buckets.forEach((rows, key) => {
      const first = rows[0]!
      const visual = resource_visual(first.job, first.tier)
      const mesh = new InstancedMesh(geometry_for(first.job, first.tier), material_for(visual, wind), rows.length)
      rows.forEach((row, index) => {
        const yaw =
          mulberry(
            [...row.id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619), 2_166_136_261)
          )() * Math.PI
        const matrix = new Matrix4().compose(
          new Vector3(row.x, row.y, row.z),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
          new Vector3(visual.scale, visual.scale, visual.scale)
        )
        mesh.setMatrixAt(index, matrix)
        const anchor = anchors.get(row.id) ?? new Object3D()
        anchor.position.set(row.x, row.y + (visual.family === 'FARMER' ? 2.1 : 1.35), row.z)
        anchor.visible = visible
        if (!anchors.has(row.id)) {
          anchors.set(row.id, anchor)
          scene.add(anchor)
        }
      })
      mesh.visible = visible
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = false
      mesh.receiveShadow = true
      meshes.set(key, mesh)
      scene.add(mesh)
    })
  }

  const set_label = (id: string, element: HTMLElement | null): void => {
    const anchor = anchors.get(id)
    if (!anchor || !markers.has(id)) return
    const previous = labels.get(id)
    if (previous) anchor.remove(previous)
    labels.delete(id)
    if (!element) return
    const label = new CSS2DObject(element)
    anchor.add(label)
    labels.set(id, label)
  }

  return Object.freeze({
    set_markers,
    set_label,
    set_visible: (next: boolean) => {
      visible = next
      meshes.forEach((mesh) => (mesh.visible = next))
      anchors.forEach((anchor) => (anchor.visible = next))
    },
    dispose: () => {
      clear_meshes()
      anchors.forEach((anchor) => scene.remove(anchor))
      anchors.clear()
      labels.clear()
      markers.clear()
    },
  })
}
