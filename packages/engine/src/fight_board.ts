// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared tactical substrate and picking for simulator, world fights, duels, and kolizeum.
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  WebGPUCoordinateSystem,
  type Camera,
  type Material,
  type Scene,
} from 'three'

import {
  BOARD_CELL_FLOOR,
  BOARD_CELL_HOLE,
  BOARD_CELL_OBSTACLE,
  BOARD_CELL_VOID,
  BOARD_FLOOR_THICKNESS,
  bake_fight_board_surface,
  bake_fight_board_water_surface,
  build_fight_board_pits,
  build_fight_board_slab,
  build_fight_board_water,
} from './fight_board_surface.ts'
import { bake_stone_texture, build_obstacle_rocks } from './fight_board_rocks.ts'
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

const board_mask = (board: Readonly<FightBoardRender>): Uint8Array => {
  const mask = new Uint8Array(board.width * board.height).fill(BOARD_CELL_VOID)
  board.cells.forEach((cell) => {
    const value =
      cell.kind === 'obstacle' ? BOARD_CELL_OBSTACLE : cell.kind === 'hole' ? BOARD_CELL_HOLE : BOARD_CELL_FLOOR
    mask[cell.x + cell.y * board.width] = value
  })
  return mask
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
    const obstacle_geometry = build_obstacle_rocks({
      cells: obstacle_rows,
      cell_size: next.cell_size,
      origin: { x: next.origin.x, z: next.origin.z },
      floor_y: next.origin.y + BOARD_FLOOR_THICKNESS,
    })
    const stone_texture = bake_stone_texture()
    const obstacle_material = new MeshStandardMaterial({
      map: stone_texture,
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    })
    const obstacles = new Mesh(obstacle_geometry, obstacle_material)
    obstacles.frustumCulled = false
    obstacles.name = 'board_obstacle'
    // Large exploration shadow maps quantize this small static geometry while the fight camera moves.
    // The blocker material still carries its shape; excluding it from that map removes the visible shimmer.
    obstacles.castShadow = false
    obstacles.receiveShadow = false

    const hole_geometry = build_fight_board_pits(mask, next.width, next.height, next.cell_size, next.origin)
    // The pit stays inside the board's ground clearance and participates in normal depth. Drawing
    // it as an overlay projects its walls across fighters and floor tiles as giant black prisms.
    const hole_material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    const holes = new Mesh(hole_geometry, hole_material)
    holes.frustumCulled = false
    holes.name = 'board_hole'
    holes.receiveShadow = true

    // a hole is water: an OPAQUE still sheet just under the paving — the basin swallows whatever
    // terrain or herbs the world grows beneath it instead of letting them show through
    const water_geometry = build_fight_board_water(mask, next.width, next.height, next.cell_size, next.origin)
    const water_texture = bake_fight_board_water_surface(mask, next.width, next.height)
    const water_material = new MeshStandardMaterial({
      map: water_texture,
      roughness: 0.14,
      metalness: 0,
    })
    const water = new Mesh(water_geometry, water_material)
    water.frustumCulled = false
    water.name = 'board_water'

    pick_cells = Object.freeze(
      Object.fromEntries(
        next.cells.flatMap(({ cell, kind, x, y }) => (kind === 'hole' ? [] : [[x + y * next.width, cell]]))
      )
    )

    group.add(slab, obstacles, holes, water)
    resources = Object.freeze({
      geometries: Object.freeze([slab_geometry, obstacle_geometry, hole_geometry, water_geometry]),
      materials: Object.freeze([slab_top, slab_side, obstacle_material, hole_material, water_material]),
      textures: Object.freeze([surface_texture, stone_texture, water_texture]),
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
