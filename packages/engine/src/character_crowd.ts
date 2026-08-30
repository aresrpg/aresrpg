// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  AnimationMixer,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type AnimationAction,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Scene,
  type Texture,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute, mix, texture, vec4 } from 'three/tsl'

import { create_character_model, type CharacterModel } from './character_model.ts'
import { resolve_entity_locomotion_clip } from './entities.ts'
import type { CharacterAnimationName, CharacterAppearanceRender, CharacterEntityRender } from './types.ts'

const BATCH_CAPACITY = 256
const CHARACTER_HEIGHT = 2
const COLOR_ATTRIBUTES = Object.freeze(['crowdColor1', 'crowdColor2', 'crowdColor3'] as const)
const TOPOLOGY_KEYS = new WeakMap<CharacterAppearanceRender, string>()

type CrowdSpec = CharacterEntityRender &
  Readonly<{ anchor: Readonly<{ kind: 'world'; position: readonly [number, number, number] }> }>
type CrowdAnimation = Readonly<{ name: CharacterAnimationName; time_scale: number }>
type InstancedChild = Mesh & {
  isInstancedMesh: true
  instanceMatrix: InstancedBufferAttribute
  count: number
}
type BatchMesh = Readonly<{
  mesh: InstancedChild
  geometry: BufferGeometry
  materials: readonly Material[]
  attachment: Readonly<{ bone: Object3D; offset: Matrix4 }> | null
}>
type LoadedBatch = Readonly<{
  root: Group
  model: CharacterModel
  mixer: AnimationMixer | null
  base_matrices: InstancedBufferAttribute
  color_buffer: InstancedInterleavedBuffer
  colors: readonly InterleavedBufferAttribute[]
  meshes: readonly BatchMesh[]
  scale: number
  set_animation: (animation: CrowdAnimation) => void
  dispose: () => void
}>
type BatchSlot = {
  key: string
  topology: string
  specs: readonly CrowdSpec[]
  loaded: LoadedBatch | null
}

const material_rows = (material: Material | Material[]): readonly Material[] =>
  Array.isArray(material) ? material : [material]

const crowd_topology = (appearance: CharacterAppearanceRender): string => {
  const cached = TOPOLOGY_KEYS.get(appearance)
  if (cached) return cached
  const { body_url, hair_url, worn } = appearance
  const key = JSON.stringify({ body_url, hair_url, worn })
  TOPOLOGY_KEYS.set(appearance, key)
  return key
}

export const character_crowd_key = (spec: Readonly<CharacterEntityRender>): string => {
  const animation = spec.animation ?? Object.freeze({ name: 'IDLE' as const, time_scale: 1 })
  return `${crowd_topology(spec.appearance)}:${animation.name}:${animation.time_scale === 0 ? 'frozen' : 'active'}`
}

const crowd_animation = (spec: Readonly<CharacterEntityRender>): CrowdAnimation =>
  spec.animation ?? Object.freeze({ name: 'IDLE', time_scale: 1 })

export const is_character_crowd_spec = (spec: Readonly<CharacterEntityRender>): spec is CrowdSpec =>
  spec.presentation === 'crowd' && spec.anchor.kind === 'world' && spec.visible !== false && !spec.visual_effect

const texture_rows = (root: Object3D): ReadonlyMap<string, Texture> => {
  const rows = new Map<string, Texture>()
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    material_rows(mesh.material).forEach((material) => {
      const { map } = material as MeshStandardMaterial
      if (map?.name) rows.set(map.name, map)
    })
  })
  return rows
}

const crowd_color_node = (base: Texture, textures: ReadonlyMap<string, Texture>) => {
  const match = base.name.match(/^(.+)_base$/)
  const sampled = texture(base)
  if (!match?.[1]) return sampled
  let { rgb } = sampled
  COLOR_ATTRIBUTES.forEach((attribute_name, index) => {
    const mask = textures.get(`${match[1]}_color${index + 1}`)
    if (!mask) return
    const sampled_mask = texture(mask)
    rgb = mix(rgb, sampled_mask.rgb.mul(attribute(attribute_name, 'vec3')), sampled_mask.a)
  })
  return vec4(rgb, sampled.a)
}

const crowd_material = (source: Material, textures: ReadonlyMap<string, Texture>): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial()
  material.copy(source as MeshStandardMaterial)
  const { map } = source as MeshStandardMaterial
  if (map) material.colorNode = crowd_color_node(map, textures)
  return material
}

const prepare_mesh = (
  mesh: Mesh,
  textures: ReadonlyMap<string, Texture>,
  matrices: InstancedBufferAttribute,
  colors: readonly InterleavedBufferAttribute[],
  attachment: BatchMesh['attachment']
): BatchMesh => {
  const geometry = mesh.geometry.clone()
  COLOR_ATTRIBUTES.forEach((name, index) => geometry.setAttribute(name, colors[index]!))
  const materials = material_rows(mesh.material).map((material) => crowd_material(material, textures))
  mesh.geometry = geometry
  mesh.material = Array.isArray(mesh.material) ? [...materials] : materials[0]!
  const instanced = mesh as InstancedChild
  instanced.isInstancedMesh = true
  instanced.instanceMatrix = matrices
  instanced.count = 0
  instanced.frustumCulled = false
  instanced.castShadow = true
  instanced.receiveShadow = true
  return Object.freeze({
    mesh: instanced,
    geometry,
    materials: Object.freeze(materials),
    attachment,
  })
}

const parent_bone = (parent: Object3D | null, root: Object3D): Object3D | null => {
  if (!parent || parent === root) return null
  if ('isBone' in parent && parent.isBone) return parent
  return parent_bone(parent.parent, root)
}

const attachment_bone = (mesh: Mesh, root: Object3D): Object3D | null =>
  'isSkinnedMesh' in mesh && mesh.isSkinnedMesh ? null : parent_bone(mesh.parent, root)

const detach_attachment = (mesh: Mesh, root: Object3D): BatchMesh['attachment'] => {
  const bone = attachment_bone(mesh, root)
  if (!bone) return null
  root.updateWorldMatrix(true, true)
  const offset = bone.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
  mesh.removeFromParent()
  root.add(mesh)
  mesh.position.set(0, 0, 0)
  mesh.rotation.set(0, 0, 0)
  mesh.scale.set(1, 1, 1)
  mesh.updateMatrix()
  return Object.freeze({ bone, offset })
}

const load_batch = async (
  key: string,
  appearance: CharacterAppearanceRender,
  animation: CrowdAnimation,
  load_model: (appearance: CharacterAppearanceRender) => Promise<CharacterModel>
): Promise<LoadedBatch> => {
  const model = await load_model(appearance)
  const root = new Group()
  root.name = `character-crowd:${key}`
  root.add(model.root)
  root.position.y = -model.min_y
  const textures = texture_rows(model.root)
  const base_matrices = new InstancedBufferAttribute(new Float32Array(BATCH_CAPACITY * 16), 16).setUsage(
    DynamicDrawUsage
  )
  const color_buffer = new InstancedInterleavedBuffer(new Float32Array(BATCH_CAPACITY * 9), 9, 1).setUsage(
    DynamicDrawUsage
  )
  const colors = COLOR_ATTRIBUTES.map((_, index) => new InterleavedBufferAttribute(color_buffer, 3, index * 3))
  const meshes: BatchMesh[] = []
  const source_meshes: Mesh[] = []
  model.root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) source_meshes.push(mesh)
  })
  source_meshes.forEach((mesh) => {
    const attachment = detach_attachment(mesh, model.root)
    const matrices = attachment
      ? new InstancedBufferAttribute(new Float32Array(BATCH_CAPACITY * 16), 16).setUsage(DynamicDrawUsage)
      : base_matrices
    meshes.push(prepare_mesh(mesh, textures, matrices, colors, attachment))
  })
  const mixer = model.clips.length > 0 ? new AnimationMixer(model.root) : null
  let action: AnimationAction | null = null
  const set_animation = (next: CrowdAnimation): void => {
    action?.stop()
    const clip = resolve_entity_locomotion_clip(model.clips, next.name)
    action = mixer && clip ? mixer.clipAction(clip).reset().play() : null
    action?.setEffectiveTimeScale(next.time_scale)
  }
  set_animation(animation)
  mixer?.update(0)
  const scale = model.root.scale.x || 1
  let disposed = false
  return Object.freeze({
    root,
    model,
    mixer,
    base_matrices,
    color_buffer,
    colors: Object.freeze(colors),
    meshes: Object.freeze(meshes),
    scale,
    set_animation,
    dispose: () => {
      if (disposed) return
      disposed = true
      action?.stop()
      mixer?.stopAllAction()
      meshes.forEach(({ geometry, materials }) => {
        geometry.dispose()
        materials.forEach((material) => material.dispose())
      })
      model.dispose()
    },
  })
}

const write_color = (attribute_row: InterleavedBufferAttribute, index: number, value: string): void => {
  const color = new Color(value)
  attribute_row.setXYZ(index, color.r, color.g, color.b)
}

const upload_colors = (batch: LoadedBatch, count: number): void => {
  batch.color_buffer.clearUpdateRanges()
  batch.color_buffer.addUpdateRange(0, count * batch.color_buffer.stride)
  batch.color_buffer.needsUpdate = true
}

const upload_instances = (attribute_row: InstancedBufferAttribute, count: number): void => {
  attribute_row.clearUpdateRanges()
  attribute_row.addUpdateRange(0, count * attribute_row.itemSize)
  attribute_row.needsUpdate = true
}

const attachment_matrices = (batch: LoadedBatch): readonly (Matrix4 | null)[] => {
  batch.model.root.updateWorldMatrix(true, true)
  const root_inverse = batch.model.root.matrixWorld.clone().invert()
  return batch.meshes.map(({ attachment }) =>
    attachment ? root_inverse.clone().multiply(attachment.bone.matrixWorld).multiply(attachment.offset) : null
  )
}

const instance_matrix = (spec: CrowdSpec, scale: number, target: Matrix4): Matrix4 => {
  const [x, y, z] = spec.anchor.position
  return target
    .makeRotationY(spec.facing.kind === 'yaw' ? spec.facing.yaw : 0)
    .setPosition(x / scale, y / scale, z / scale)
}

const apply_specs = (batch: LoadedBatch, specs: readonly CrowdSpec[], update_colors = true): void => {
  const base = new Matrix4()
  const matrix = new Matrix4()
  const attachments = attachment_matrices(batch)
  specs.forEach((spec, index) => {
    instance_matrix(spec, batch.scale, base)
    base.toArray(batch.base_matrices.array, index * 16)
    batch.meshes.forEach(({ mesh }, mesh_index) => {
      const attachment = attachments[mesh_index]
      if (attachment)
        matrix
          .copy(base)
          .multiply(attachment)
          .toArray(mesh.instanceMatrix.array, index * 16)
    })
    if (update_colors)
      spec.appearance.colors.forEach((color, color_index) => write_color(batch.colors[color_index]!, index, color))
  })
  upload_instances(batch.base_matrices, specs.length)
  batch.meshes.forEach(({ mesh, attachment }) => {
    mesh.count = specs.length
    if (attachment) upload_instances(mesh.instanceMatrix, specs.length)
  })
  if (update_colors) upload_colors(batch, specs.length)
}

const apply_attachment_specs = (batch: LoadedBatch, specs: readonly CrowdSpec[]): void => {
  const base = new Matrix4()
  const matrix = new Matrix4()
  const attachments = attachment_matrices(batch)
  batch.meshes.forEach(({ mesh }, mesh_index) => {
    const attachment = attachments[mesh_index]
    if (!attachment) return
    specs.forEach((spec, index) => {
      instance_matrix(spec, batch.scale, base)
      matrix
        .copy(base)
        .multiply(attachment)
        .toArray(mesh.instanceMatrix.array, index * 16)
    })
    upload_instances(mesh.instanceMatrix, specs.length)
  })
}

const same_specs = (left: readonly CrowdSpec[], right: readonly CrowdSpec[]): boolean =>
  left.length === right.length && left.every((spec, index) => spec === right[index])

const same_colors = (left: readonly CrowdSpec[], right: readonly CrowdSpec[]): boolean =>
  left.length === right.length &&
  left.every((spec, index) =>
    spec.appearance.colors.every((color, slot) => color === right[index]?.appearance.colors[slot])
  )

const grouped_specs = (specs: readonly CrowdSpec[]): ReadonlyMap<string, readonly CrowdSpec[]> => {
  const groups = new Map<string, CrowdSpec[]>()
  specs.forEach((spec) => {
    const key = character_crowd_key(spec)
    const rows = groups.get(key) ?? []
    rows.push(spec)
    groups.set(key, rows)
  })
  return new Map(
    [...groups].flatMap(([key, rows]) =>
      Array.from(
        { length: Math.ceil(rows.length / BATCH_CAPACITY) },
        (_, chunk) =>
          [`${key}:${chunk}`, Object.freeze(rows.slice(chunk * BATCH_CAPACITY, (chunk + 1) * BATCH_CAPACITY))] as const
      )
    )
  )
}

export const create_character_crowd_layer = ({
  scene,
  load_model = (appearance) => create_character_model(appearance, { colorize: false }),
}: Readonly<{
  scene: Scene
  load_model?: (appearance: CharacterAppearanceRender) => Promise<CharacterModel>
}>) => {
  const batches = new Map<string, BatchSlot>()
  const anchors = new Map<string, Readonly<{ position: Vector3; height: number }>>()
  let submitted_specs: readonly CrowdSpec[] = Object.freeze([])
  let previous_tick = performance.now()

  const remove = (key: string): void => {
    const batch = batches.get(key)
    if (!batch) return
    batches.delete(key)
    if (batch.loaded) {
      scene.remove(batch.loaded.root)
      batch.loaded.dispose()
    }
  }

  const set = (specs: readonly CrowdSpec[]): void => {
    if (same_specs(submitted_specs, specs)) return
    submitted_specs = specs
    anchors.clear()
    specs.forEach((spec) => {
      const [x, y, z] = spec.anchor.position
      anchors.set(
        spec.id,
        Object.freeze({ position: new Vector3(x, y + CHARACTER_HEIGHT, z), height: CHARACTER_HEIGHT })
      )
    })
    const groups = grouped_specs(specs)
    const stale_keys = new Set([...batches.keys()].filter((key) => !groups.has(key)))
    groups.forEach((rows, key) => {
      const existing = batches.get(key)
      if (existing) {
        const colors_changed = !same_colors(existing.specs, rows)
        existing.specs = rows
        if (existing.loaded) apply_specs(existing.loaded, rows, colors_changed)
        return
      }
      const first = rows[0]!
      const topology = crowd_topology(first.appearance)
      const reusable_key = [...stale_keys].find((candidate) => {
        const candidate_slot = batches.get(candidate)
        return candidate_slot?.topology === topology && candidate_slot.loaded !== null
      })
      const reusable = reusable_key ? batches.get(reusable_key) : null
      if (reusable_key && reusable?.loaded) {
        const colors_changed = !same_colors(reusable.specs, rows)
        stale_keys.delete(reusable_key)
        batches.delete(reusable_key)
        reusable.key = key
        reusable.specs = rows
        reusable.loaded.root.name = `character-crowd:${key}`
        reusable.loaded.set_animation(crowd_animation(first))
        batches.set(key, reusable)
        apply_specs(reusable.loaded, rows, colors_changed)
        return
      }
      const animation = crowd_animation(first)
      const slot: BatchSlot = { key, topology, specs: rows, loaded: null }
      batches.set(key, slot)
      void load_batch(key, first.appearance, animation, load_model).then(
        (loaded) => {
          const current = batches.get(key)
          if (!current || current !== slot) {
            loaded.dispose()
            return
          }
          current.loaded = loaded
          scene.add(loaded.root)
          apply_specs(loaded, current.specs)
        },
        (error: unknown) => {
          if (batches.get(key) === slot) batches.delete(key)
          console.error(`Failed to load character crowd batch ${key}.`, error)
        }
      )
    })
    stale_keys.forEach(remove)
  }

  return Object.freeze({
    set,
    tick: (now: number): void => {
      const delta = Math.min(0.1, Math.max(0, now - previous_tick) / 1_000)
      previous_tick = now
      batches.forEach(({ loaded, specs }) => {
        loaded?.mixer?.update(delta)
        if (loaded?.mixer && loaded.meshes.some(({ attachment }) => attachment)) apply_attachment_specs(loaded, specs)
      })
    },
    live_crown: (id: string): Vector3 | null => anchors.get(id)?.position.clone() ?? null,
    world_anchor: (id: string): Vector3 | null => anchors.get(id)?.position.clone() ?? null,
    entity_height: (id: string): number | null => anchors.get(id)?.height ?? null,
    stats: () =>
      Object.freeze({
        batches: batches.size,
        instances: [...batches.values()].reduce((count, batch) => count + batch.specs.length, 0),
      }),
    dispose: (): void => {
      ;[...batches.keys()].forEach(remove)
      submitted_specs = Object.freeze([])
      anchors.clear()
    },
  })
}
