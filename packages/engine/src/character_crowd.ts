// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  AnimationMixer,
  DynamicDrawUsage,
  Group,
  InstancedInterleavedBuffer,
  type InterleavedBufferAttribute,
  Matrix4,
  Vector3,
  type AnimationAction,
  type Mesh,
  type Object3D,
  type Scene,
} from 'three'

import {
  create_instance_buffers,
  prepare_mesh,
  texture_rows,
  write_color,
  upload_colors,
  upload_instances,
  instance_matrix,
  same_colors,
  BATCH_CAPACITY,
  type CrowdSpec,
  type BatchMesh,
} from './character_crowd_mesh.ts'
import { create_crowd_parts, type CharacterPartLoader } from './character_crowd_parts.ts'
import { create_character_model, load_character_part, type CharacterModel } from './character_model.ts'
import { resolve_entity_locomotion_clip } from './entities.ts'
import type { CharacterAnimationName, CharacterAppearanceRender, CharacterEntityRender } from './types.ts'

const CHARACTER_HEIGHT = 2

type CrowdAnimation = Readonly<{ name: CharacterAnimationName; time_scale: number }>
type LoadedBatch = Readonly<{
  root: Group
  model: CharacterModel
  parts: ReturnType<typeof create_crowd_parts>
  mixer: AnimationMixer | null
  base_matrices: InstancedInterleavedBuffer
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

const crowd_topology = (appearance: CharacterAppearanceRender): string => appearance.body_url ?? 'placeholder'

export const character_crowd_key = (spec: Readonly<CharacterEntityRender>): string => {
  const animation = spec.animation ?? Object.freeze({ name: 'IDLE' as const, time_scale: 1 })
  return `${crowd_topology(spec.appearance)}:${animation.name}:${animation.time_scale === 0 ? 'frozen' : 'active'}`
}

const crowd_animation = (spec: Readonly<CharacterEntityRender>): CrowdAnimation =>
  spec.animation ?? Object.freeze({ name: 'IDLE', time_scale: 1 })

export const is_character_crowd_spec = (spec: Readonly<CharacterEntityRender>): spec is CrowdSpec =>
  spec.presentation === 'crowd' && spec.anchor.kind === 'world' && spec.visible !== false && !spec.visual_effect

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
  load_model: (appearance: CharacterAppearanceRender) => Promise<CharacterModel>,
  load_part: CharacterPartLoader
): Promise<LoadedBatch> => {
  const model = await load_model({ ...appearance, hair_url: null, worn: { head: null, back: null } })
  const root = new Group()
  root.name = `character-crowd:${key}`
  root.add(model.root)
  root.position.y = -model.min_y
  const textures = texture_rows(model.root)
  const { base_matrices, color_buffer, colors } = create_instance_buffers()
  const meshes: BatchMesh[] = []
  const source_meshes: Mesh[] = []
  model.root.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh) source_meshes.push(mesh)
  })
  source_meshes.forEach((mesh) => {
    const attachment = detach_attachment(mesh, model.root)
    const matrices = attachment
      ? new InstancedInterleavedBuffer(new Float32Array(BATCH_CAPACITY * 16), 16, 1).setUsage(DynamicDrawUsage)
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
  const parts = create_crowd_parts(model.root, scale, load_part)
  let disposed = false
  return Object.freeze({
    root,
    parts,
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
      meshes.forEach((mesh) => mesh.dispose())
      parts.dispose()
      model.dispose()
    },
  })
}

const attachment_matrices = (batch: LoadedBatch): readonly (Matrix4 | null)[] => {
  batch.model.root.updateWorldMatrix(true, true)
  const root_inverse = batch.model.root.matrixWorld.clone().invert()
  return batch.meshes.map(({ attachment }) =>
    attachment ? root_inverse.clone().multiply(attachment.bone.matrixWorld).multiply(attachment.offset) : null
  )
}

const apply_attachment_specs = (batch: LoadedBatch, specs: readonly CrowdSpec[]): void => {
  const matrix = new Matrix4()
  const attachments = attachment_matrices(batch)
  batch.meshes.forEach(({ mesh }, mesh_index) => {
    const attachment = attachments[mesh_index]
    if (!attachment) return
    specs.forEach((_, index) => {
      matrix
        .fromArray(batch.base_matrices.array, index * 16)
        .multiply(attachment)
        .toArray(mesh.instance_matrix.array, index * 16)
    })
    upload_instances(mesh.instance_matrix, specs.length)
  })
}

const same_specs = (left: readonly CrowdSpec[], right: readonly CrowdSpec[]): boolean =>
  left.length === right.length && left.every((spec, index) => spec === right[index])

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
  load_part = load_character_part,
}: Readonly<{
  scene: Scene
  load_model?: (appearance: CharacterAppearanceRender) => Promise<CharacterModel>
  load_part?: CharacterPartLoader
}>) => {
  let disposed = false
  const batches = new Map<string, BatchSlot>()
  const anchors = new Map<string, Vector3>()
  let submitted_specs: readonly CrowdSpec[] = Object.freeze([])
  let previous_tick = performance.now()

  // Anchors become live with a loaded model and its instance data.
  const apply_specs = (batch: LoadedBatch, specs: readonly CrowdSpec[], update_colors = true): void => {
    batch.parts.set(specs)
    const base = new Matrix4()
    specs.forEach((spec, index) => {
      const [x, y, z] = spec.anchor.position
      anchors.set(spec.id, new Vector3(x, y + CHARACTER_HEIGHT, z))
      instance_matrix(spec, batch.scale, base)
      base.toArray(batch.base_matrices.array, index * 16)
      if (update_colors)
        spec.appearance.colors.forEach((color, color_index) => write_color(batch.colors[color_index]!, index, color))
    })
    upload_instances(batch.base_matrices, specs.length)
    batch.meshes.forEach(({ geometry }) => {
      geometry.instanceCount = specs.length
    })
    // Animated attachments consume the final pose in tick, immediately before rendering.
    if (!batch.mixer) apply_attachment_specs(batch, specs)
    if (update_colors) upload_colors(batch, specs.length)
  }

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
    if (disposed || same_specs(submitted_specs, specs)) return
    submitted_specs = specs
    anchors.clear()
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
      void load_batch(key, first.appearance, animation, load_model, load_part).then(
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
        loaded?.parts.tick()
        if (loaded?.mixer && loaded.meshes.some(({ attachment }) => attachment)) apply_attachment_specs(loaded, specs)
      })
    },
    live_crown: (id: string): Vector3 | null => anchors.get(id)?.clone() ?? null,
    world_anchor: (id: string): Vector3 | null => anchors.get(id)?.clone() ?? null,
    entity_height: (id: string): number | null => (anchors.has(id) ? CHARACTER_HEIGHT : null),
    stats: () =>
      Object.freeze({
        batches: batches.size,
        instances: [...batches.values()].reduce((count, batch) => count + batch.specs.length, 0),
      }),
    dispose: (): void => {
      disposed = true
      ;[...batches.keys()].forEach(remove)
      submitted_specs = Object.freeze([])
      anchors.clear()
    },
  })
}
