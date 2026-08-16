// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { Matrix4, PerspectiveCamera, Scene, Vector4, WebGPUCoordinateSystem } from 'three'

import { create_fight_board_layer, fight_board_instances } from '../src/fight_board.ts'
import { create_fight_blob_layer, fight_blob_cartoon_scale, plan_fight_blob } from '../src/fight_blobs.ts'
import {
  BOARD_CELL_FLOOR,
  BOARD_CELL_HOLE,
  BOARD_CELL_OBSTACLE,
  BOARD_FLOOR_THICKNESS,
  bake_fight_board_surface,
  build_fight_board_slab,
} from '../src/fight_board_surface.ts'
import { write_orthographic_projection } from '../src/webgpu_backend.ts'

describe('fight board rendering projection', () => {
  test('plans inset per-cell blobs as an outward distance wave', () => {
    const board = {
      width: 3,
      height: 1,
      cell_size: 2,
      origin: { x: -3, y: 0, z: -1 },
      cells: [
        { cell: 10, x: 0, y: 0, kind: 'floor' as const },
        { cell: 11, x: 1, y: 0, kind: 'floor' as const },
        { cell: 12, x: 2, y: 0, kind: 'floor' as const },
      ],
    }
    const plan = plan_fight_blob(board, {
      id: 'range',
      cells: [10, 11, 12],
      shape: 'per_cell',
      color: 0x35b34a,
      origin_cell: 10,
      reveal_step_ms: 50,
      created_at: 0,
    })

    expect(plan.kind).toBe('per_cell')
    expect(plan.cell_size).toBeLessThan(board.cell_size)
    expect(plan.cells.map(({ delay_ms }) => delay_ms)).toEqual([0, 50, 100])
  })

  test('plans a merged blob as one surface and gives its growth a cartoon overshoot', () => {
    const board = {
      width: 2,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 20, x: 0, y: 0, kind: 'floor' as const },
        { cell: 21, x: 1, y: 0, kind: 'floor' as const },
      ],
    }
    const plan = plan_fight_blob(board, {
      id: 'glyph',
      cells: [20, 21],
      shape: 'single',
      color: 0xe0791e,
      created_at: 0,
    })

    expect(plan.kind).toBe('single')
    expect(plan.cells).toHaveLength(2)
    expect(fight_blob_cartoon_scale(0)).toBe(0)
    expect(fight_blob_cartoon_scale(0.7)).toBeGreaterThan(1)
    expect(fight_blob_cartoon_scale(1)).toBe(1)
  })

  test('routes starting cells and caller areas through the same blob layer', () => {
    const scene = new Scene()
    const blobs = create_fight_blob_layer(scene)
    const board = {
      width: 3,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 30, x: 0, y: 0, kind: 'start_a' as const },
        { cell: 31, x: 1, y: 0, kind: 'floor' as const },
        { cell: 32, x: 2, y: 0, kind: 'start_b' as const },
      ],
    }
    blobs.set_board(board)
    blobs.upsert({
      id: 'spell_range',
      cells: [30, 31, 32],
      shape: 'per_cell',
      color: 0x35b34a,
      origin_cell: 30,
      reveal_step_ms: 50,
      duration_ms: 500,
      created_at: 1_000,
    })
    blobs.upsert({
      id: 'glyph',
      cells: [30, 31],
      shape: 'single',
      color: 0xe0791e,
      created_at: 1_000,
    })
    blobs.tick(1_000)

    const group = scene.getObjectByName('fight_blobs')
    const range = scene.getObjectByName('fight_blob:spell_range')
    expect(group?.children.some(({ name }) => name.includes('fight_start_a'))).toBeTrue()
    expect(group?.children.some(({ name }) => name.includes('fight_start_b'))).toBeTrue()
    expect(range?.children).toHaveLength(3)
    expect(range?.children[0]?.position.toArray()).toEqual([0.665, BOARD_FLOOR_THICKNESS, 0.665])
    expect(range?.children[0]?.visible).toBeTrue()
    expect(range?.children[1]?.visible).toBeFalse()
    expect(scene.getObjectByName('fight_blob:glyph')?.children).toHaveLength(1)
    blobs.tick(1_060)
    expect(range?.children[1]?.visible).toBeTrue()
    blobs.tick(1_500)
    expect(range?.children[0]?.visible).toBeFalse()
    blobs.set_board(board)
    expect(scene.getObjectByName('fight_blob:spell_range')).toBeUndefined()
    blobs.dispose()
  })

  test('restores the contiguous checker substrate while cutting real holes from the slab', () => {
    const mask = new Uint8Array([BOARD_CELL_FLOOR, BOARD_CELL_FLOOR, BOARD_CELL_HOLE, BOARD_CELL_OBSTACLE])
    const texture = bake_fight_board_surface(mask, 2, 2)
    const pixels = texture.image.data as Uint8Array
    const center = (cell_x: number, cell_y: number): number => {
      const x = cell_x * 64 + 32
      const y = cell_y * 64 + 32
      const offset = (x + y * 128) * 4
      return (pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0)
    }
    const slab = build_fight_board_slab(mask, 2, 2, 1.33, { x: 0, y: 0, z: 0 })

    expect(center(0, 0)).not.toBe(center(1, 0))
    expect(slab.groups[0]?.count).toBe(18)
    texture.dispose()
    slab.dispose()
  })

  test('keeps floor, blockers, pits, and both starting bands distinct', () => {
    const instances = fight_board_instances({
      width: 3,
      height: 2,
      cell_size: 2,
      origin: { x: -3, y: 10, z: -2 },
      cells: [
        { cell: 0, x: 0, y: 0, kind: 'start_a' },
        { cell: 1, x: 1, y: 0, kind: 'floor' },
        { cell: 2, x: 2, y: 0, kind: 'obstacle' },
        { cell: 20, x: 0, y: 1, kind: 'hole' },
        { cell: 21, x: 1, y: 1, kind: 'start_b' },
      ],
    })

    expect(instances.floor.map(({ cell }) => cell)).toEqual([0, 1, 2, 21])
    expect(instances.obstacle.map(({ cell }) => cell)).toEqual([2])
    expect(instances.hole.map(({ cell }) => cell)).toEqual([20])
    expect(instances.start_a.map(({ cell }) => cell)).toEqual([0])
    expect(instances.start_b.map(({ cell }) => cell)).toEqual([21])
    expect(instances.start_a[0]?.position).toEqual([-2, 10.2, -1])
  })

  test('picks distinct cells through the fight camera custom orthographic projection', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(60, 2, 0.1, 100)
    camera.position.set(0, 10, 10)
    camera.lookAt(0, 0, 0)
    camera.projectionMatrix.copy(new Matrix4().makeOrthographic(-2, 2, 1, -1, camera.near, camera.far))
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.updateMatrixWorld()
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
    } as unknown as HTMLCanvasElement
    const layer = create_fight_board_layer({ scene, camera, canvas })
    layer.set({
      width: 2,
      height: 1,
      cell_size: 2,
      origin: { x: -2, y: 0, z: -1 },
      cells: [
        { cell: 11, x: 0, y: 0, kind: 'start_a' },
        { cell: 12, x: 1, y: 0, kind: 'start_b' },
      ],
    })

    expect(layer.pick(100, 100)).toBe(11)
    expect(layer.pick(300, 100)).toBe(12)
    const obstacles = scene.getObjectByName('board_obstacle')
    expect(obstacles?.castShadow).toBeFalse()
    expect(obstacles?.receiveShadow).toBeFalse()
    layer.dispose()
  })

  test('builds the fight orthographic matrix in the renderer coordinate system', () => {
    const projection = write_orthographic_projection(new Matrix4(), -2, 2, 1, -1, 0.1, 100, WebGPUCoordinateSystem)
    const near = new Vector4(0, 0, -0.1, 1).applyMatrix4(projection)
    const far = new Vector4(0, 0, -100, 1).applyMatrix4(projection)

    expect(near.z / near.w).toBeCloseTo(0)
    expect(far.z / far.w).toBeCloseTo(1)
  })
})
