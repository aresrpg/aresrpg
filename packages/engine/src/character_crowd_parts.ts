// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DynamicDrawUsage, InstancedInterleavedBuffer, Matrix4, type Mesh, type Object3D } from 'three'

import {
  find_character_bone,
  mount_character_part,
  type CharacterPart,
  type CharacterPartSlot,
} from './character_model.ts'
import {
  BATCH_CAPACITY,
  create_instance_buffers,
  instance_matrix,
  prepare_mesh,
  same_colors,
  texture_rows,
  upload_colors,
  upload_instances,
  write_color,
  type CrowdSpec,
} from './character_crowd_mesh.ts'
import type { WornModelRender } from './types.ts'

export type CharacterPartLoader = (slot: CharacterPartSlot, spec: WornModelRender) => Promise<CharacterPart>
type PartSource = Readonly<{ slot: CharacterPartSlot; model: WornModelRender }>
const part_key = ({ slot, model }: PartSource): string => JSON.stringify([slot, model.url, model.variant])
const appearance_parts = ({ appearance }: CrowdSpec): readonly PartSource[] => [
  ...(appearance.hair_url ? [{ slot: 'hair' as const, model: { url: appearance.hair_url, variant: null } }] : []),
  ...(['head', 'back'] as const).flatMap((slot) =>
    appearance.worn[slot] ? [{ slot, model: appearance.worn[slot]! }] : []
  ),
]
const groups = (specs: readonly CrowdSpec[]) => {
  const result = new Map<string, { source: PartSource; specs: CrowdSpec[] }>()
  specs.forEach((spec) =>
    appearance_parts(spec).forEach((source) => {
      const key = part_key(source)
      const group = result.get(key) ?? { source, specs: [] }
      group.specs.push(spec)
      result.set(key, group)
    })
  )
  return result
}
const prepare_part = (part: CharacterPart) => {
  const buffers = create_instance_buffers()
  const textures = texture_rows(part.root)
  const source_meshes: Mesh[] = []
  part.root.traverse((object) => {
    if ((object as Mesh).isMesh) source_meshes.push(object as Mesh)
  })
  const meshes: ReturnType<typeof prepare_mesh>[] = []
  const dispose = (): void => {
    meshes.forEach((mesh) => mesh.dispose())
    part.dispose()
  }
  try {
    source_meshes.forEach((mesh, index) =>
      meshes.push(
        prepare_mesh(
          mesh,
          textures,
          index === 0
            ? buffers.base_matrices
            : new InstancedInterleavedBuffer(new Float32Array(BATCH_CAPACITY * 16), 16, 1).setUsage(DynamicDrawUsage),
          buffers.colors,
          null
        )
      )
    )
    return { ...buffers, meshes, part, rows: [] as readonly CrowdSpec[], dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
type PartBatch = ReturnType<typeof prepare_part>
type PartSlot = { source: PartSource; specs: readonly CrowdSpec[]; loaded: PartBatch | null }

/** Parts share their body's exact pose, while each part selects only its wearing instances. */
export const create_crowd_parts = (body: Object3D, scale: number, load_part: CharacterPartLoader) => {
  const slots = new Map<string, PartSlot>()
  let disposed = false
  const remove = (key: string): void => {
    slots.get(key)?.loaded?.dispose()
    slots.delete(key)
  }
  const has_head = (spec: CrowdSpec): boolean => {
    const model = spec.appearance.worn.head
    return !!model && !!slots.get(part_key({ slot: 'head', model }))?.loaded
  }
  const root_inverse = new Matrix4()
  const local = new Matrix4()
  const inverse = new Matrix4()
  const base = new Matrix4()
  const matrix = new Matrix4()
  const update = ({ source, specs, loaded }: PartSlot): void => {
    if (!loaded) return
    const rows = source.slot === 'hair' ? specs.filter((spec) => !has_head(spec)) : specs
    if (!same_colors(loaded.rows, rows)) {
      rows.forEach((spec, index) =>
        spec.appearance.colors.forEach((color, slot) => write_color(loaded.colors[slot]!, index, color))
      )
      upload_colors(loaded, rows.length)
    }
    loaded.rows = rows
    loaded.meshes.forEach(({ mesh, geometry }) => {
      geometry.instanceCount = rows.length
      // Keep the original rigid/skinned hierarchy. Conjugation places each instance in body space
      // without changing bind matrices, inherited bone transforms, or authored attachment offsets.
      local.copy(root_inverse).multiply(mesh.matrixWorld)
      inverse.copy(local).invert()
      rows.forEach((spec, index) => {
        instance_matrix(spec, scale, base)
        matrix
          .copy(inverse)
          .multiply(base)
          .multiply(local)
          .toArray(mesh.instance_matrix.array, index * 16)
      })
      upload_instances(mesh.instance_matrix, rows.length)
    })
  }
  return Object.freeze({
    set: (specs: readonly CrowdSpec[]): void => {
      if (disposed) return
      const wanted = groups(specs)
      for (const key of slots.keys()) if (!wanted.has(key)) remove(key)
      wanted.forEach(({ source, specs: rows }, key) => {
        const existing = slots.get(key)
        if (existing) {
          existing.specs = rows
          return
        }
        const slot: PartSlot = { source, specs: rows, loaded: null }
        slots.set(key, slot)
        const mount = source.slot === 'back' ? 'back' : 'head'
        if (!find_character_bone(body, mount === 'head' ? 'head' : 'cape')) return
        void load_part(source.slot, source.model)
          .then((part) => {
            if (disposed || slots.get(key) !== slot) {
              part.dispose()
              return
            }
            if (!mount_character_part({ body, part: part.root, slot: mount, hair: null })) {
              part.dispose()
              return
            }
            slot.loaded = prepare_part(part)
          })
          .catch((error: unknown) => console.warn(`Failed to load crowd ${source.slot} ${source.model.url}.`, error))
      })
    },
    tick: (): void => {
      if (disposed || !slots.size) return
      body.updateWorldMatrix(true, true)
      root_inverse.copy(body.matrixWorld).invert()
      slots.forEach(update)
    },
    dispose: (): void => {
      disposed = true
      ;[...slots.keys()].forEach(remove)
    },
  })
}
