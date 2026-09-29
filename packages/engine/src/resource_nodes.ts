// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chain-driven resource props. A patch is one chain row; its blocks are deterministic visual
// seats. Geometry is instanced by resource identity, so hundreds of nodes still cost at most
// one draw per authored gatherable.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
  type Texture,
} from 'three'
import { MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute, float, texture } from 'three/tsl'

import grain_visuals from '../../../seed/content/grain_visuals.json'

import { flora_cluster } from './nature/flora_cluster.ts'
import { grain_stalk } from './nature/grain_stalk.ts'
import { create_nature_texture, nature_uv, type NatureSurface } from './nature/surface_texture.ts'
import { mushroom_cluster } from './nature/mushroom_cluster.ts'
import { ore_vein } from './nature/ore_vein.ts'
import { plant_wind_position } from './nature/plant_wind.ts'
import { mulberry, type SpriteBuilder } from './nature/sprite_kit.ts'
import type { ResourceNodeMarker } from './types.ts'

export type ResourceFamily = 'FARMER' | 'HERBALIST' | 'MINER'
export type ResourceSilhouette = 'grain' | 'flora' | 'mushroom' | 'ore'

export const resource_nodes_visible = ({
  terrain_presented,
  board_active,
}: Readonly<{ terrain_presented: boolean; board_active: boolean }>): boolean => terrain_presented && !board_active

const BUILDERS: Readonly<Record<ResourceSilhouette, Readonly<{ build: SpriteBuilder; surface: NatureSurface }>>> =
  Object.freeze({
    grain: { build: grain_stalk, surface: 'plant' },
    flora: { build: flora_cluster, surface: 'plant' },
    mushroom: { build: mushroom_cluster, surface: 'mushroom' },
    ore: { build: ore_vein, surface: 'mineral' },
  })

// Identity palettes override the job+tier fallback where the resource has a distinct colour.
const HUES: Readonly<Record<ResourceFamily, readonly [number, number]>> = Object.freeze({
  FARMER: [48, 8],
  HERBALIST: [112, 286],
  MINER: [198, 318],
})

const clamp_tier = (tier: number): number => Math.max(1, Math.min(11, Math.trunc(tier)))

const RESOURCE_VISUALS: Readonly<
  Record<string, Readonly<{ silhouette: ResourceSilhouette; body: string; accent: string }>>
> = Object.freeze({
  green_mushroom: Object.freeze({ silhouette: 'mushroom', body: '#b9a57e', accent: '#62bf52' }),
  red_orchid: Object.freeze({ silhouette: 'flora', body: '#315f37', accent: '#e04458' }),
  ivory_shrooms: Object.freeze({ silhouette: 'mushroom', body: '#b7aa90', accent: '#fff4dc' }),
  aloe_vera: Object.freeze({ silhouette: 'flora', body: '#315f3d', accent: '#82d47c' }),
  nightcap: Object.freeze({ silhouette: 'mushroom', body: '#493c62', accent: '#7c6be2' }),
  crimson_truffle: Object.freeze({ silhouette: 'mushroom', body: '#5b2930', accent: '#cf4d59' }),
  phantom_spore: Object.freeze({ silhouette: 'mushroom', body: '#49636d', accent: '#b8f4e8' }),
  witherbloom: Object.freeze({ silhouette: 'flora', body: '#4b5033', accent: '#94769a' }),
  arcaneshroom: Object.freeze({ silhouette: 'mushroom', body: '#3c315d', accent: '#55ddd0' }),
  dragonlily: Object.freeze({ silhouette: 'flora', body: '#3f4e2c', accent: '#f17a43' }),
  cursed_fungus: Object.freeze({ silhouette: 'mushroom', body: '#292436', accent: '#a5d74f' }),
})

const color_tuple = (value: string): readonly [number, number, number] => {
  const color = new Color(value)
  return Object.freeze([color.r, color.g, color.b] as const)
}

type GrainVisual = Readonly<{ pattern: string; palette: readonly string[] }>
const {
  grains,
  patterns,
}: Readonly<{
  grains: Readonly<Record<string, GrainVisual>>
  patterns: Readonly<Record<string, readonly (readonly number[])[]>>
}> = grain_visuals
const SILHOUETTES: Readonly<Record<ResourceFamily, ResourceSilhouette>> = {
  FARMER: 'grain',
  HERBALIST: 'flora',
  MINER: 'ore',
}

const grain_visual = (grain: GrainVisual) => {
  const palette = Object.freeze(grain.palette.map(color_tuple))
  return {
    family: 'FARMER' as const,
    silhouette: 'grain' as const,
    body: palette[0]!,
    accent: palette[2]!,
    pattern: patterns[grain.pattern]!,
    palette,
  }
}

export const resource_visual = (item_type: string, job: string, tier: number) => {
  const step = (clamp_tier(tier) - 1) / 10
  const size = { tier: clamp_tier(tier), scale: 0.9 + step * 0.22 }
  const grain = grains[item_type]
  if (grain) return Object.freeze({ ...size, ...grain_visual(grain) })
  const family: ResourceFamily = job === 'FARMER' || job === 'MINER' ? job : 'HERBALIST'
  const [hue_lo, hue_hi] = HUES[family]
  const hue = hue_lo + (hue_hi - hue_lo) * step
  const fallback_body = new Color().setHSL(hue / 360, family === 'MINER' ? 0.38 : 0.52, family === 'MINER' ? 0.3 : 0.28)
  const fallback_accent = new Color().setHSL(hue / 360, 0.72, 0.62)
  const authored = RESOURCE_VISUALS[item_type]
  return Object.freeze({
    ...size,
    family,
    silhouette: authored?.silhouette ?? SILHOUETTES[family],
    pattern: undefined,
    palette: undefined,
    body: authored
      ? color_tuple(authored.body)
      : Object.freeze([fallback_body.r, fallback_body.g, fallback_body.b] as const),
    accent: authored
      ? color_tuple(authored.accent)
      : Object.freeze([fallback_accent.r, fallback_accent.g, fallback_accent.b] as const),
  })
}

const resource_recipe = (visual: ReturnType<typeof resource_visual>, random: () => number) =>
  visual.pattern ? grain_stalk(random, visual.pattern) : BUILDERS[visual.silhouette].build(random)

const resource_color = (visual: ReturnType<typeof resource_visual>, band: number): readonly number[] =>
  visual.palette?.[band] ?? visual.body.map((value, index) => value + (visual.accent[index]! - value) * band)

const geometry_for = (item_type: string, job: string, tier: number): BufferGeometry => {
  const visual = resource_visual(item_type, job, tier)
  const item_seed = [...item_type].reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619),
    2_166_136_261
  )
  const recipe = resource_recipe(visual, mulberry(item_seed + visual.tier * 977))
  const positions = new Float32Array(recipe.length * 3)
  const colors = new Float32Array(recipe.length * 3)
  const normals = new Float32Array(recipe.length * 3)
  const wind =
    visual.family === 'MINER' ? null : { sway: new Float32Array(recipe.length), phase: new Float32Array(recipe.length) }
  const surface_kind = BUILDERS[visual.silhouette].surface
  const uvs = new Float32Array(recipe.flatMap((vertex) => nature_uv(surface_kind, vertex)))
  const glow = new Float32Array(recipe.length)
  const glow_scale = Number(visual.silhouette === 'mushroom')
  for (let start = 0; start < recipe.length; start += 3) {
    const base = start * 3
    for (let corner = 0; corner < 3; corner += 1) {
      const [x, y, z, blend, sway] = recipe[start + corner]!
      const offset = base + corner * 3
      positions[offset] = x
      positions[offset + 1] = y
      positions[offset + 2] = z
      colors.set(resource_color(visual, blend), offset)
      glow[start + corner] = Math.max(0, (blend - 0.65) / 0.35) * glow_scale
      if (wind) {
        wind.sway[start + corner] = sway
        wind.phase[start + corner] = (x + z) * 0.8
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
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('glow', new BufferAttribute(glow, 1))
  if (wind) {
    geometry.setAttribute('sway', new BufferAttribute(wind.sway, 1))
    geometry.setAttribute('phase', new BufferAttribute(wind.phase, 1))
  }
  geometry.computeBoundingSphere()
  return geometry
}

const material_for = (
  visual: ReturnType<typeof resource_visual>,
  wind: boolean,
  surface: Texture | null
): MeshStandardMaterial | MeshStandardNodeMaterial => {
  const options = {
    vertexColors: true,
    map: surface,
    bumpMap: visual.family === 'MINER' || visual.silhouette === 'mushroom' ? surface : null,
    bumpScale: 0.035,
    side: DoubleSide,
    roughness: visual.family === 'MINER' ? 0.55 : 0.9,
    metalness: visual.family === 'MINER' ? 0.12 : 0,
  }
  if (!wind || visual.family === 'MINER') return new MeshStandardMaterial(options)
  const material = new MeshSSSNodeMaterial(options)
  material.positionNode = plant_wind_position()
  // Thin leaves transmit shadowed light from behind, as in Tidewater's vegetation lighting.
  // This stays in the existing direct-light shader: no extra render pass or unshadowed glow.
  material.thicknessColorNode = attribute('color', 'vec3' as const).mul(0.35)
  material.thicknessScaleNode = float(1)
  material.thicknessAttenuationNode = float(0.4)
  material.emissiveNode = attribute('color', 'vec3' as const)
    .mul(attribute('glow', 'float' as const))
    .mul(surface ? texture(surface).r.mul(1.1) : float(1.8))
  return material
}

const marker_scale = (row: ResourceNodeMarker): number => Math.max(0.25, Math.min(4, row.scale ?? 1))

export const create_resource_node_layer = ({ scene, wind = false }: Readonly<{ scene: Scene; wind?: boolean }>) => {
  const meshes = new Map<string, InstancedMesh>()
  const anchors = new Map<string, Vector3>()
  let surface_texture: Texture | null = null
  // The backend reveals resource dressing only after its first terrain frame has presented.
  let visible = false

  const release_mesh = (mesh: InstancedMesh): void => {
    scene.remove(mesh)
    mesh.dispose()
    mesh.geometry.dispose()
    ;(mesh.material as MeshStandardMaterial).dispose()
  }

  const clear_meshes = (): void => {
    meshes.forEach(release_mesh)
    meshes.clear()
  }

  const mesh_for = (key: string, rows: readonly ResourceNodeMarker[]): InstancedMesh => {
    const known = meshes.get(key)
    if (known && known.instanceMatrix.count >= rows.length) return known
    const first = rows[0]!
    const visual = resource_visual(first.item_type, first.job, first.tier)
    const surface = (surface_texture ??= create_nature_texture())
    const { geometry, material } = known ?? {
      geometry: geometry_for(first.item_type, first.job, first.tier),
      material: material_for(visual, wind, surface),
    }
    const mesh = new InstancedMesh(geometry, material, 2 ** Math.ceil(Math.log2(rows.length)))
    mesh.name = `resource:${first.item_type}`
    mesh.castShadow = false
    mesh.receiveShadow = true
    if (known) {
      scene.remove(known)
      known.dispose()
    }
    scene.add(mesh)
    return mesh
  }

  const set_markers = (next: readonly ResourceNodeMarker[]): void => {
    const wanted = new Set(next.map(({ id }) => id))
    for (const id of anchors.keys()) if (!wanted.has(id)) anchors.delete(id)
    const buckets = new Map<string, ResourceNodeMarker[]>()
    next.forEach((row) => {
      const key = `${row.item_type}:${row.job}:${clamp_tier(row.tier)}`
      const rows = buckets.get(key) ?? []
      rows.push(row)
      buckets.set(key, rows)
    })
    for (const [key, mesh] of meshes)
      if (!buckets.has(key)) {
        release_mesh(mesh)
        meshes.delete(key)
      }
    buckets.forEach((rows, key) => {
      const first = rows[0]!
      const visual = resource_visual(first.item_type, first.job, first.tier)
      const mesh = mesh_for(key, rows)
      mesh.count = rows.length
      rows.forEach((row, index) => {
        const yaw =
          mulberry(
            [...row.id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619), 2_166_136_261)
          )() * Math.PI
        const matrix = new Matrix4().compose(
          new Vector3(row.x, row.y, row.z),
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
          new Vector3().setScalar(visual.scale * marker_scale(row))
        )
        mesh.setMatrixAt(index, matrix)
        const anchor = anchors.get(row.id) ?? new Vector3()
        anchor.set(row.x, row.y + (row.job === 'FARMER' ? 2.1 : 1.35) * marker_scale(row), row.z)
        anchors.set(row.id, anchor)
      })
      mesh.visible = visible
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      meshes.set(key, mesh)
    })
  }

  return Object.freeze({
    set_markers,
    /** The shared CSS2D layer reads this invisible world point every render. */
    label_anchor: (id: string): Vector3 | null => (visible ? (anchors.get(id) ?? null) : null),
    set_visible: (next: boolean) => {
      visible = next
      meshes.forEach((mesh) => (mesh.visible = next))
    },
    dispose: () => {
      clear_meshes()
      surface_texture?.dispose()
      anchors.clear()
    },
  })
}
