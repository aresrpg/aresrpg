// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One fight-board paint API for placement, ranges, glyphs, and short-lived combat cues.
import {
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three'

import { BOARD_FLOOR_THICKNESS } from './fight_board_surface.ts'
import type { FightBlobRender, FightBlobSpec, FightBoardRender } from './types.ts'

const PER_CELL_FRACTION = 0.84
const POP_MS = 180
const FADE_MS = 280
const DEFAULT_OPACITY = 0.8
const DEFAULT_REVEAL_STEP_MS = 32
const TEXTURE_CELL_PX = 48
const START_A_ID = '__fight_start_a'
const START_B_ID = '__fight_start_b'
const START_COLORS = Object.freeze({ start_a: 0x2f6bd8, start_b: 0xff7a2c })

type FightPlacementBlob = Readonly<{ id: string; blob: FightBlobSpec }>

export const fight_placement_blobs = (
  board: Readonly<FightBoardRender>,
  visible = true
): readonly FightPlacementBlob[] => {
  if (!visible) return Object.freeze([])
  const overlay = (kind: 'start_a' | 'start_b', color: number): FightPlacementBlob | null => {
    const cells = board.cells.filter((cell) => cell.kind === kind).map(({ cell }) => cell)
    return cells.length === 0
      ? null
      : Object.freeze({
          id: kind === 'start_a' ? START_A_ID : START_B_ID,
          blob: Object.freeze({
            cells: Object.freeze(cells),
            shape: 'per_cell' as const,
            color,
            origin_cell: cells[0],
            reveal_step_ms: 35,
          }),
        })
  }
  return Object.freeze(
    [overlay('start_a', START_COLORS.start_a), overlay('start_b', START_COLORS.start_b)].filter(
      (row): row is FightPlacementBlob => row !== null
    )
  )
}

export type FightBlobPlanCell = Readonly<{
  cell: number
  x: number
  y: number
  world_x: number
  world_z: number
  delay_ms: number
}>

export type FightBlobPlan = Readonly<{
  kind: FightBlobRender['shape']
  cell_size: number
  cells: readonly FightBlobPlanCell[]
}>

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export const fight_blob_cartoon_scale = (progress: number): number => {
  const amount = clamp01(progress)
  if (amount === 0 || amount === 1) return amount
  const shifted = amount - 1
  const overshoot = 1.70158
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted
}

export const plan_fight_blob = (board: Readonly<FightBoardRender>, blob: Readonly<FightBlobRender>): FightBlobPlan => {
  const wanted = new Set(blob.cells)
  const cells = board.cells.filter(({ cell }) => wanted.has(cell))
  const origin = board.cells.find(({ cell }) => cell === blob.origin_cell) ?? cells[0]
  const reveal_step_ms = Math.max(0, blob.reveal_step_ms ?? DEFAULT_REVEAL_STEP_MS)
  return Object.freeze({
    kind: blob.shape,
    cell_size: board.cell_size * (blob.shape === 'per_cell' ? PER_CELL_FRACTION : 1),
    cells: Object.freeze(
      cells.map((cell) =>
        Object.freeze({
          cell: cell.cell,
          x: cell.x,
          y: cell.y,
          world_x: board.origin.x + (cell.x + 0.5) * board.cell_size,
          world_z: board.origin.z + (cell.y + 0.5) * board.cell_size,
          delay_ms:
            blob.shape === 'per_cell' && origin
              ? (Math.abs(cell.x - origin.x) + Math.abs(cell.y - origin.y)) * reveal_step_ms
              : 0,
        })
      )
    ),
  })
}

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const amount = clamp01((value - edge0) / (edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

const rounded_coverage = (
  u: number,
  v: number,
  connected: Readonly<{ left: boolean; right: boolean; top: boolean; bottom: boolean }>
): number => {
  const signed_x = u - 0.5
  const signed_y = v - 0.5
  const merged_x = signed_x < 0 ? connected.left : connected.right
  const merged_y = signed_y < 0 ? connected.bottom : connected.top
  const px = merged_x ? 0 : Math.abs(signed_x)
  const py = merged_y ? 0 : Math.abs(signed_y)
  const radius = 0.13
  const qx = Math.max(px - (0.5 - radius), 0)
  const qy = Math.max(py - (0.5 - radius), 0)
  return 1 - smoothstep(0, 0.035, Math.hypot(qx, qy) - radius)
}

const make_blob_texture = (cells: readonly FightBlobPlanCell[], merged: boolean): DataTexture => {
  const min_x = Math.min(...cells.map(({ x }) => x))
  const max_x = Math.max(...cells.map(({ x }) => x))
  const min_y = Math.min(...cells.map(({ y }) => y))
  const max_y = Math.max(...cells.map(({ y }) => y))
  const width_cells = merged ? max_x - min_x + 1 : 1
  const height_cells = merged ? max_y - min_y + 1 : 1
  const width = width_cells * TEXTURE_CELL_PX
  const height = height_cells * TEXTURE_CELL_PX
  const pixels = new Uint8Array(width * height * 4)
  const membership = new Set(cells.map(({ x, y }) => `${x},${y}`))

  for (let pixel_y = 0; pixel_y < height; pixel_y += 1)
    for (let pixel_x = 0; pixel_x < width; pixel_x += 1) {
      const local_cell_x = Math.floor(pixel_x / TEXTURE_CELL_PX)
      const local_cell_y = Math.floor(pixel_y / TEXTURE_CELL_PX)
      const cell_x = merged ? min_x + local_cell_x : cells[0]!.x
      const cell_y = merged ? max_y - local_cell_y : cells[0]!.y
      if (!membership.has(`${cell_x},${cell_y}`)) continue
      const u = (pixel_x % TEXTURE_CELL_PX) / (TEXTURE_CELL_PX - 1)
      const v = (pixel_y % TEXTURE_CELL_PX) / (TEXTURE_CELL_PX - 1)
      const connected = merged
        ? {
            left: membership.has(`${cell_x - 1},${cell_y}`),
            right: membership.has(`${cell_x + 1},${cell_y}`),
            top: membership.has(`${cell_x},${cell_y - 1}`),
            bottom: membership.has(`${cell_x},${cell_y + 1}`),
          }
        : { left: false, right: false, top: false, bottom: false }
      const coverage = rounded_coverage(u, v, connected)
      const rim = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2
      const alpha = coverage * (0.58 + rim * 0.42)
      const offset = (pixel_x + pixel_y * width) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(alpha * 255)
    }

  const texture = new DataTexture(pixels, width, height)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

type BlobVisual = Readonly<{
  root: Group
  material: MeshBasicMaterial
  geometry: PlaneGeometry
  texture: DataTexture
  drawable: Mesh | InstancedMesh
  cells: readonly Readonly<{
    cell: number | null
    world_x: number
    world_z: number
    started_at: number
  }>[]
  board_y: number
  blob: FightBlobRender
}>

type BlobTransformScratch = Readonly<{
  matrix: Matrix4
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}>

const dispose_visual = (group: Group, visual: BlobVisual): void => {
  group.remove(visual.root)
  visual.geometry.dispose()
  visual.material.dispose()
  visual.texture.dispose()
}

const blob_material = (blob: Readonly<FightBlobRender>, texture: DataTexture): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color: blob.color,
    map: texture,
    transparent: true,
    opacity: blob.opacity ?? DEFAULT_OPACITY,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })

const place_blob_mesh = (
  mesh: Mesh,
  cell: number | null,
  world_x: number,
  world_y: number,
  world_z: number,
  priority: number
): void => {
  // Keep the overlay on the board plane. Any vertical lift becomes a visible screen-space
  // displacement under the fight camera; polygon offset already resolves the coplanar depth.
  mesh.name = cell === null ? 'fight_blob_shape' : `fight_blob_cell:${cell}`
  mesh.position.set(world_x, world_y, world_z)
  mesh.renderOrder = 3 + priority
  mesh.frustumCulled = false
  mesh.scale.set(0.001, 1, 0.001)
}

const blob_scale = (blob: Readonly<FightBlobRender>, now: number, started_at: number): number => {
  if (blob.animate === false) return 1
  const progress = (now - started_at) / POP_MS
  return blob.shape === 'per_cell' ? smoothstep(0, 1, progress) : fight_blob_cartoon_scale(progress)
}

const set_instance_transform = (
  mesh: InstancedMesh,
  index: number,
  cell: Readonly<{ world_x: number; world_z: number }>,
  board_y: number,
  scale: number,
  scratch: BlobTransformScratch
): void => {
  scratch.position.set(cell.world_x, board_y, cell.world_z)
  scratch.scale.set(Math.max(0.001, scale), 1, Math.max(0.001, scale))
  scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
  mesh.setMatrixAt(index, scratch.matrix)
}

const build_visual = (
  board: Readonly<FightBoardRender>,
  blob: Readonly<FightBlobRender>,
  scratch: BlobTransformScratch
): BlobVisual | null => {
  const plan = plan_fight_blob(board, blob)
  if (plan.cells.length === 0) return null
  const root = new Group()
  root.name = `fight_blob:${blob.id}`
  const merged = blob.shape === 'single'
  const texture = make_blob_texture(plan.cells, merged)
  const material = blob_material(blob, texture)
  const min_x = Math.min(...plan.cells.map(({ x }) => x))
  const max_x = Math.max(...plan.cells.map(({ x }) => x))
  const min_y = Math.min(...plan.cells.map(({ y }) => y))
  const max_y = Math.max(...plan.cells.map(({ y }) => y))
  const geometry = new PlaneGeometry(
    merged ? (max_x - min_x + 1) * board.cell_size : plan.cell_size,
    merged ? (max_y - min_y + 1) * board.cell_size : plan.cell_size
  )
  geometry.rotateX(-Math.PI / 2)
  const board_y = board.origin.y + BOARD_FLOOR_THICKNESS
  const cells = merged
    ? [
        Object.freeze({
          cell: null,
          world_x: board.origin.x + ((min_x + max_x + 1) * board.cell_size) / 2,
          world_z: board.origin.z + ((min_y + max_y + 1) * board.cell_size) / 2,
          started_at: blob.created_at,
        }),
      ]
    : plan.cells.map(({ cell, world_x, world_z, delay_ms }) =>
        Object.freeze({ cell, world_x, world_z, started_at: blob.created_at + delay_ms })
      )
  const drawable = merged ? new Mesh(geometry, material) : new InstancedMesh(geometry, material, board.cells.length)
  if (drawable instanceof InstancedMesh) {
    drawable.name = 'fight_blob_cells'
    drawable.instanceMatrix.setUsage(DynamicDrawUsage)
    drawable.count = cells.length
    drawable.renderOrder = 3 + (blob.priority ?? 0)
    drawable.frustumCulled = false
    cells.forEach((cell, index) =>
      set_instance_transform(
        drawable,
        index,
        cell,
        board_y,
        blob_scale(blob, blob.created_at, cell.started_at),
        scratch
      )
    )
    drawable.instanceMatrix.needsUpdate = true
  } else {
    const cell = cells[0]!
    place_blob_mesh(drawable, null, cell.world_x, board_y, cell.world_z, blob.priority ?? 0)
  }
  root.add(drawable)
  return Object.freeze({
    root,
    material,
    geometry,
    texture,
    drawable,
    cells: Object.freeze(cells),
    board_y,
    blob,
  })
}

const reconcile_per_cell_visual = (
  visual: Readonly<BlobVisual>,
  board: Readonly<FightBoardRender>,
  blob: Readonly<FightBlobRender>,
  scratch: BlobTransformScratch
): BlobVisual | null => {
  const plan = plan_fight_blob(board, blob)
  if (plan.cells.length === 0 || !(visual.drawable instanceof InstancedMesh)) return null
  const previous = new Map(visual.cells.map((row) => [row.cell, row]))
  const cells = plan.cells.map(({ cell, world_x, world_z, delay_ms }) => {
    const existing = previous.get(cell)
    if (existing) return Object.freeze({ ...existing, world_x, world_z })
    return Object.freeze({
      cell,
      world_x,
      world_z,
      started_at: blob.animate_updates === false ? blob.created_at - POP_MS : blob.created_at + delay_ms,
    })
  })
  visual.material.color.setHex(blob.color)
  visual.drawable.count = cells.length
  visual.drawable.renderOrder = 3 + (blob.priority ?? 0)
  cells.forEach((cell, index) =>
    set_instance_transform(
      visual.drawable as InstancedMesh,
      index,
      cell,
      visual.board_y,
      blob_scale(blob, performance.now(), cell.started_at),
      scratch
    )
  )
  visual.drawable.instanceMatrix.needsUpdate = true
  return Object.freeze({ ...visual, cells: Object.freeze(cells), blob })
}

export const create_fight_blob_layer = (scene: Scene) => {
  const group = new Group()
  group.name = 'fight_blobs'
  scene.add(group)
  const transform_scratch = Object.freeze({
    matrix: new Matrix4(),
    position: new Vector3(),
    quaternion: new Quaternion(),
    scale: new Vector3(),
  })
  const blobs = new Map<string, FightBlobRender>()
  const visuals = new Map<string, BlobVisual>()
  const settled_transforms = new Set<string>()
  let board: FightBoardRender | null = null

  const remove_visual = (id: string): void => {
    const visual = visuals.get(id)
    if (!visual) return
    dispose_visual(group, visual)
    visuals.delete(id)
    settled_transforms.delete(id)
  }
  const materialize = (blob: Readonly<FightBlobRender>): void => {
    remove_visual(blob.id)
    if (!board) return
    const visual = build_visual(board, blob, transform_scratch)
    if (!visual) return
    visuals.set(blob.id, visual)
    group.add(visual.root)
  }
  const upsert = (blob: FightBlobRender): void => {
    blobs.set(blob.id, blob)
    settled_transforms.delete(blob.id)
    const visual = visuals.get(blob.id)
    if (board && visual?.blob.shape === 'per_cell' && blob.shape === 'per_cell') {
      const reconciled = reconcile_per_cell_visual(visual, board, blob, transform_scratch)
      if (reconciled) visuals.set(blob.id, reconciled)
      else remove_visual(blob.id)
      return
    }
    materialize(blob)
  }
  const remove = (id: string): void => {
    blobs.delete(id)
    settled_transforms.delete(id)
    remove_visual(id)
  }

  return Object.freeze({
    set_board: (next: FightBoardRender | null): void => {
      visuals.forEach((visual) => dispose_visual(group, visual))
      visuals.clear()
      blobs.clear()
      settled_transforms.clear()
      board = next
      if (!next) return
      const now = performance.now()
      fight_placement_blobs(next, next.show_start_cells !== false).forEach(({ id, blob }) =>
        blobs.set(id, Object.freeze({ ...blob, id, created_at: now }))
      )
      blobs.forEach(materialize)
    },
    upsert,
    remove,
    tick: (now: number): void => {
      visuals.forEach((visual, id) => {
        const age = now - visual.blob.created_at
        const duration = visual.blob.duration_ms
        const fade = duration === undefined ? 1 : clamp01((duration - age) / FADE_MS)
        visual.material.opacity = (visual.blob.opacity ?? DEFAULT_OPACITY) * fade
        visual.drawable.visible = fade > 0
        if (visual.drawable instanceof InstancedMesh) {
          if (!settled_transforms.has(id)) {
            visual.cells.forEach((cell, index) =>
              set_instance_transform(
                visual.drawable as InstancedMesh,
                index,
                cell,
                visual.board_y,
                now < cell.started_at ? 0 : blob_scale(visual.blob, now, cell.started_at),
                transform_scratch
              )
            )
            visual.drawable.instanceMatrix.needsUpdate = true
            if (visual.blob.animate === false || visual.cells.every(({ started_at }) => now >= started_at + POP_MS))
              settled_transforms.add(id)
          }
          return
        }
        const cell = visual.cells[0]
        if (!cell) return
        const scale = blob_scale(visual.blob, now, cell.started_at)
        visual.drawable.visible = (visual.blob.animate === false || now >= cell.started_at) && fade > 0
        visual.drawable.scale.set(Math.max(0.001, scale), 1, Math.max(0.001, scale))
      })
    },
    dispose: (): void => {
      visuals.forEach((visual) => dispose_visual(group, visual))
      visuals.clear()
      blobs.clear()
      settled_transforms.clear()
      scene.remove(group)
    },
  })
}
