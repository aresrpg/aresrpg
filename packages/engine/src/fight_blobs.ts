// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One fight-board paint API for placement, ranges, glyphs, and short-lived combat cues.
import {
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three'

import { BOARD_FLOOR_THICKNESS } from './fight_board_surface.ts'
import type { FightBlobRender, FightBoardRender, FightBoardRenderCell } from './types.ts'

const PER_CELL_FRACTION = 0.84
const POP_MS = 180
const FADE_MS = 280
const DEFAULT_OPACITY = 0.8
const DEFAULT_REVEAL_STEP_MS = 32
const TEXTURE_CELL_PX = 48
const START_A_ID = '__fight_start_a'
const START_B_ID = '__fight_start_b'
const START_COLORS = Object.freeze({ start_a: 0x2f6bd8, start_b: 0xff7a2c })

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
  meshes: readonly Readonly<{ mesh: Mesh; delay_ms: number }>[]
  blob: FightBlobRender
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

const build_visual = (board: Readonly<FightBoardRender>, blob: Readonly<FightBlobRender>): BlobVisual | null => {
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
  const rows = merged
    ? [
        {
          mesh: new Mesh(geometry, material),
          delay_ms: 0,
          world_x: board.origin.x + ((min_x + max_x + 1) * board.cell_size) / 2,
          world_z: board.origin.z + ((min_y + max_y + 1) * board.cell_size) / 2,
        },
      ]
    : plan.cells.map(({ world_x, world_z, delay_ms }) => ({
        mesh: new Mesh(geometry, material),
        delay_ms,
        world_x,
        world_z,
      }))
  rows.forEach(({ mesh, world_x, world_z }) => {
    // Keep the overlay on the board plane. Any vertical lift becomes a visible screen-space
    // displacement under the fight camera; polygon offset already resolves the coplanar depth.
    mesh.position.set(world_x, board.origin.y + BOARD_FLOOR_THICKNESS, world_z)
    mesh.renderOrder = 3
    mesh.frustumCulled = false
    mesh.scale.set(0.001, 1, 0.001)
    root.add(mesh)
  })
  return Object.freeze({
    root,
    material,
    geometry,
    texture,
    meshes: Object.freeze(rows.map(({ mesh, delay_ms }) => Object.freeze({ mesh, delay_ms }))),
    blob,
  })
}

const start_blob = (
  id: string,
  color: number,
  cells: readonly FightBoardRenderCell[],
  created_at: number
): FightBlobRender =>
  Object.freeze({
    id,
    color,
    cells: Object.freeze(cells.map(({ cell }) => cell)),
    shape: 'per_cell',
    origin_cell: cells[0]?.cell,
    reveal_step_ms: 35,
    created_at,
  })

export const create_fight_blob_layer = (scene: Scene) => {
  const group = new Group()
  group.name = 'fight_blobs'
  scene.add(group)
  const blobs = new Map<string, FightBlobRender>()
  const visuals = new Map<string, BlobVisual>()
  let board: FightBoardRender | null = null

  const remove_visual = (id: string): void => {
    const visual = visuals.get(id)
    if (!visual) return
    dispose_visual(group, visual)
    visuals.delete(id)
  }
  const materialize = (blob: Readonly<FightBlobRender>): void => {
    remove_visual(blob.id)
    if (!board) return
    const visual = build_visual(board, blob)
    if (!visual) return
    visuals.set(blob.id, visual)
    group.add(visual.root)
  }
  const upsert = (blob: FightBlobRender): void => {
    blobs.set(blob.id, blob)
    materialize(blob)
  }
  const remove = (id: string): void => {
    blobs.delete(id)
    remove_visual(id)
  }

  return Object.freeze({
    set_board: (next: FightBoardRender | null): void => {
      visuals.forEach((visual) => dispose_visual(group, visual))
      visuals.clear()
      blobs.clear()
      board = next
      if (!next) return
      const now = performance.now()
      const start_a = next.cells.filter(({ kind }) => kind === 'start_a')
      const start_b = next.cells.filter(({ kind }) => kind === 'start_b')
      if (start_a.length > 0) blobs.set(START_A_ID, start_blob(START_A_ID, START_COLORS.start_a, start_a, now))
      if (start_b.length > 0) blobs.set(START_B_ID, start_blob(START_B_ID, START_COLORS.start_b, start_b, now))
      blobs.forEach(materialize)
    },
    upsert,
    remove,
    tick: (now: number): void => {
      visuals.forEach((visual) => {
        const age = now - visual.blob.created_at
        const duration = visual.blob.duration_ms
        const fade = duration === undefined ? 1 : clamp01((duration - age) / FADE_MS)
        visual.material.opacity = (visual.blob.opacity ?? DEFAULT_OPACITY) * fade
        visual.meshes.forEach(({ mesh, delay_ms }) => {
          const scale = fight_blob_cartoon_scale((age - delay_ms) / POP_MS)
          mesh.visible = age >= delay_ms && fade > 0
          mesh.scale.set(Math.max(0.001, scale), 1, Math.max(0.001, scale))
        })
      })
    },
    dispose: (): void => {
      visuals.forEach((visual) => dispose_visual(group, visual))
      visuals.clear()
      blobs.clear()
      scene.remove(group)
    },
  })
}
