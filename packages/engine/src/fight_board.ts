// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared tactical substrate and picking for simulator, world fights, duels, and kolizeum.
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  StaticDrawUsage,
  Vector3,
  WebGPUCoordinateSystem,
  type Camera,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

import {
  BOARD_CELL_FLOOR,
  BOARD_CELL_HOLE,
  BOARD_CELL_OBSTACLE,
  BOARD_CELL_VOID,
  BOARD_FLOOR_THICKNESS,
  bake_fight_board_surface,
  build_fight_board_pits,
  build_fight_board_slab,
} from './fight_board_surface.ts'
import { create_fight_blob_layer } from './fight_blobs.ts'
import type { FightBoardRender, FightBoardRenderCell } from './types.ts'

export type FightBoardInstance = Readonly<{
  cell: number
  position: readonly [number, number, number]
}>
export type FightBoardInstances = Readonly<{
  floor: readonly FightBoardInstance[]
  obstacle: readonly FightBoardInstance[]
  hole: readonly FightBoardInstance[]
  start_a: readonly FightBoardInstance[]
  start_b: readonly FightBoardInstance[]
}>

const position_of = (
  board: Readonly<FightBoardRender>,
  cell: Readonly<FightBoardRenderCell>,
  lift: number
): readonly [number, number, number] =>
  Object.freeze([
    board.origin.x + (cell.x + 0.5) * board.cell_size,
    board.origin.y + lift,
    board.origin.z + (cell.y + 0.5) * board.cell_size,
  ])

export const fight_board_instances = (board: Readonly<FightBoardRender>): FightBoardInstances => {
  const rows = (kind: FightBoardRenderCell['kind'], lift: number): readonly FightBoardInstance[] =>
    Object.freeze(
      board.cells
        .filter((cell) => cell.kind === kind)
        .map((cell) => Object.freeze({ cell: cell.cell, position: position_of(board, cell, lift) }))
    )
  return Object.freeze({
    floor: Object.freeze(
      board.cells
        .filter(({ kind }) => kind !== 'hole')
        .map((cell) => Object.freeze({ cell: cell.cell, position: position_of(board, cell, 0) }))
    ),
    obstacle: rows('obstacle', board.cell_size * 0.38),
    hole: rows('hole', -board.cell_size * 0.24),
    start_a: rows('start_a', 0.2),
    start_b: rows('start_b', 0.2),
  })
}

type BoardResources = Readonly<{
  geometries: readonly { dispose: () => void }[]
  materials: readonly Material[]
  textures: readonly { dispose: () => void }[]
}>

const OBSTACLE_HEIGHT_RATIO = 0.58
const OBSTACLE_INSET = 0.14
const OBSTACLE_TONES = Object.freeze([0x847a5e, 0x746c56, 0x94886a])

const board_mask = (board: Readonly<FightBoardRender>): Uint8Array => {
  const mask = new Uint8Array(board.width * board.height).fill(BOARD_CELL_VOID)
  board.cells.forEach((cell) => {
    const value =
      cell.kind === 'obstacle' ? BOARD_CELL_OBSTACLE : cell.kind === 'hole' ? BOARD_CELL_HOLE : BOARD_CELL_FLOOR
    mask[cell.x + cell.y * board.width] = value
  })
  return mask
}

const cell_hash = (x: number, y: number): number => {
  let value = (x | 0) * 374761393 + (y | 0) * 668265263
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  value ^= value >>> 16
  return (value >>> 0) / 4294967296
}

export const create_fight_board_layer = ({
  scene,
  camera,
  canvas,
}: Readonly<{ scene: Scene; camera: Camera; canvas: HTMLCanvasElement }>) => {
  const group = new Group()
  group.name = 'fight_board'
  scene.add(group)
  const blobs = create_fight_blob_layer(scene)
  const near_point = new Vector3()
  const far_point = new Vector3()
  const ray_direction = new Vector3()
  const quaternion = new Quaternion()
  const position = new Vector3()
  const scale = new Vector3()
  const matrix = new Matrix4()
  let board: FightBoardRender | null = null
  let pick_cells: Readonly<Record<number, number>> | null = null
  let resources: BoardResources | null = null

  const clear = (): void => {
    group.clear()
    resources?.geometries.forEach((geometry) => geometry.dispose())
    resources?.materials.forEach((material) => material.dispose())
    resources?.textures.forEach((texture) => texture.dispose())
    resources = null
    pick_cells = null
  }

  const build_instances = (
    geometry: BufferGeometry | RoundedBoxGeometry,
    material: Material,
    rows: readonly FightBoardRenderCell[],
    dimensions: readonly [number, number, number],
    y: (cell: Readonly<FightBoardRenderCell>) => number
  ): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, rows.length))
    mesh.instanceMatrix.setUsage(StaticDrawUsage)
    rows.forEach((cell, index) => {
      position.set(
        board!.origin.x + (cell.x + 0.5) * board!.cell_size,
        y(cell),
        board!.origin.z + (cell.y + 0.5) * board!.cell_size
      )
      scale.set(...dimensions)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
    })
    mesh.count = rows.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    return mesh
  }

  const set = (next: FightBoardRender | null): void => {
    clear()
    board = next
    blobs.set_board(next)
    if (!next) return
    const mask = board_mask(next)
    const surface_texture = bake_fight_board_surface(mask, next.width, next.height)
    const slab_geometry = build_fight_board_slab(mask, next.width, next.height, next.cell_size, next.origin)
    const slab_top = new MeshStandardMaterial({
      map: surface_texture,
      roughness: 0.96,
      metalness: 0,
    })
    const slab_side = new MeshStandardMaterial({ color: 0x827a60, roughness: 0.95, metalness: 0 })
    const slab = new Mesh(slab_geometry, [slab_top, slab_side])
    slab.name = 'board_floor'
    slab.receiveShadow = true
    slab.frustumCulled = false

    const obstacle_rows = next.cells.filter(({ kind }) => kind === 'obstacle')
    const obstacle_height = next.cell_size * OBSTACLE_HEIGHT_RATIO
    const obstacle_geometry = new RoundedBoxGeometry(
      next.cell_size - OBSTACLE_INSET,
      obstacle_height,
      next.cell_size - OBSTACLE_INSET,
      1,
      next.cell_size * 0.06
    )
    obstacle_geometry.translate(0, obstacle_height / 2, 0)
    const obstacle_material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
    const obstacles = build_instances(
      obstacle_geometry,
      obstacle_material,
      obstacle_rows,
      [1, 1, 1],
      () => next.origin.y + BOARD_FLOOR_THICKNESS
    )
    const obstacle_color = new Color()
    obstacle_rows.forEach((cell, index) => {
      const tone = OBSTACLE_TONES[Math.floor(cell_hash(cell.x, cell.y) * OBSTACLE_TONES.length)] ?? OBSTACLE_TONES[0]
      obstacles.setColorAt(index, obstacle_color.set(tone))
    })
    if (obstacles.instanceColor) obstacles.instanceColor.needsUpdate = true
    obstacles.name = 'board_obstacle'
    // Large exploration shadow maps quantize this small static geometry while the fight camera moves.
    // The blocker material still carries its shape; excluding it from that map removes the visible shimmer.
    obstacles.castShadow = false
    obstacles.receiveShadow = false

    const hole_geometry = build_fight_board_pits(mask, next.width, next.height, next.cell_size, next.origin)
    const hole_material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    const holes = new Mesh(hole_geometry, hole_material)
    holes.frustumCulled = false
    holes.name = 'board_hole'
    holes.receiveShadow = true

    pick_cells = Object.freeze(
      Object.fromEntries(
        next.cells.flatMap(({ cell, kind, x, y }) => (kind === 'hole' ? [] : [[x + y * next.width, cell]]))
      )
    )

    group.add(slab, obstacles, holes)
    resources = Object.freeze({
      geometries: Object.freeze([slab_geometry, obstacle_geometry, hole_geometry]),
      materials: Object.freeze([slab_top, slab_side, obstacle_material, hole_material]),
      textures: Object.freeze([surface_texture]),
    })
  }

  return Object.freeze({
    set,
    upsert_blob: blobs.upsert,
    remove_blob: blobs.remove,
    tick: blobs.tick,
    pick: (client_x: number, client_y: number): number | null => {
      if (!board || !pick_cells) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const x = ((client_x - rect.left) / rect.width) * 2 - 1
      const y = -((client_y - rect.top) / rect.height) * 2 + 1
      const near_z = camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1
      near_point.set(x, y, near_z).unproject(camera)
      far_point.set(x, y, 1).unproject(camera)
      ray_direction.subVectors(far_point, near_point).normalize()
      if (Math.abs(ray_direction.y) < Number.EPSILON) return null
      const distance = (board.origin.y + BOARD_FLOOR_THICKNESS - near_point.y) / ray_direction.y
      if (distance < 0) return null
      const world_x = near_point.x + ray_direction.x * distance
      const world_z = near_point.z + ray_direction.z * distance
      const cell_x = Math.floor((world_x - board.origin.x) / board.cell_size)
      const cell_y = Math.floor((world_z - board.origin.z) / board.cell_size)
      if (cell_x < 0 || cell_x >= board.width || cell_y < 0 || cell_y >= board.height) return null
      return pick_cells[cell_x + cell_y * board.width] ?? null
    },
    dispose: (): void => {
      clear()
      blobs.dispose()
      scene.remove(group)
    },
  })
}
