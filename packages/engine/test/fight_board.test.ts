// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import {
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  Vector4,
  WebGPUCoordinateSystem,
} from 'three'

import { create_fight_board_layer, fight_board_instances } from '../src/fight_board.ts'
import { create_fight_blob_layer, fight_blob_cartoon_scale, plan_fight_blob } from '../src/fight_blobs.ts'
import {
  BOARD_CELL_FLOOR,
  BOARD_CELL_HOLE,
  BOARD_CELL_OBSTACLE,
  BOARD_FLOOR_THICKNESS,
  bake_fight_board_surface,
  build_fight_board_pits,
  build_fight_board_slab,
} from '../src/fight_board_surface.ts'
import { write_orthographic_projection } from '../src/webgpu_backend.ts'

const instance_transform = (mesh: InstancedMesh, index: number) => {
  const matrix = new Matrix4()
  mesh.getMatrixAt(index, matrix)
  const position = new Vector3()
  const scale = new Vector3()
  matrix.decompose(position, new Quaternion(), scale)
  return Object.freeze({ position, scale })
}

describe('fight board rendering projection', () => {
  test('per-cell blobs reveal as an outward wave, without overshoot, and skip the wave when told to', () => {
    // 1 — the plan staggers each cell by its distance from the origin cell.
    const wave_board = {
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
    const plan = plan_fight_blob(wave_board, {
      id: 'range',
      cells: [10, 11, 12],
      shape: 'per_cell',
      color: 0x35b34a,
      origin_cell: 10,
      reveal_step_ms: 50,
      created_at: 0,
    })

    expect(plan.kind).toBe('per_cell')
    expect(plan.cell_size).toBeLessThan(wave_board.cell_size)
    expect(plan.cells.map(({ delay_ms }) => delay_ms)).toEqual([0, 50, 100])

    // 2 — a per-cell reveal never takes the single-shape cartoon overshoot.
    const overshoot_scene = new Scene()
    const overshoot_blobs = create_fight_blob_layer(overshoot_scene)
    overshoot_blobs.set_board({
      width: 1,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [{ cell: 33, x: 0, y: 0, kind: 'floor' as const }],
    })
    overshoot_blobs.upsert({ id: 'range', cells: [33], shape: 'per_cell', color: 0x35b34a, created_at: 1_000 })
    overshoot_blobs.upsert({ id: 'glyph', cells: [33], shape: 'single', color: 0xe0791e, created_at: 1_000 })
    overshoot_blobs.tick(1_126)

    const range_cell = overshoot_scene.getObjectByName('fight_blob:range')?.children[0] as InstancedMesh
    const glyph = overshoot_scene.getObjectByName('fight_blob:glyph')?.children[0]
    expect(instance_transform(range_cell, 0).scale.x).toBeLessThanOrEqual(1)
    expect(glyph?.scale.x).toBeGreaterThan(1)
    overshoot_blobs.dispose()

    // 3 — a pointer hover has no reveal at all, and settles its uploads.
    const hover_scene = new Scene()
    const hover_blobs = create_fight_blob_layer(hover_scene)
    hover_blobs.set_board({
      width: 2,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 34, x: 0, y: 0, kind: 'floor' as const },
        { cell: 35, x: 1, y: 0, kind: 'floor' as const },
      ],
    })
    hover_blobs.upsert({
      id: 'hover',
      cells: [34],
      shape: 'per_cell',
      color: 0xd73545,
      animate: false,
      created_at: 1_000,
    })
    hover_blobs.tick(1_000)

    const hovered_cell = hover_scene.getObjectByName('fight_blob:hover')?.children[0] as InstancedMesh
    expect(hovered_cell?.visible).toBeTrue()
    expect(instance_transform(hovered_cell, 0).scale.x).toBe(1)
    const first_upload = hovered_cell.instanceMatrix.version
    hover_blobs.upsert({
      id: 'hover',
      cells: [34, 35],
      shape: 'per_cell',
      color: 0xd73545,
      animate: false,
      created_at: 1_008,
    })
    expect(instance_transform(hovered_cell, 0).scale.x).toBe(1)
    expect(instance_transform(hovered_cell, 1).scale.x).toBe(1)
    hover_blobs.tick(1_016)
    expect(hovered_cell.instanceMatrix.version).toBeGreaterThan(first_upload)
    expect(instance_transform(hovered_cell, 0).scale.x).toBe(1)
    hover_blobs.tick(1_032)
    expect(hovered_cell.instanceMatrix.version).toBeGreaterThan(first_upload)
    hover_blobs.tick(1_188)
    const settled_upload = hovered_cell.instanceMatrix.version
    hover_blobs.tick(1_204)
    expect(hovered_cell.instanceMatrix.version).toBe(settled_upload)
    hover_blobs.dispose()

    // 4 — the first reveal animates while later cell additions arrive instantly.
    const layer_scene = new Scene()
    const layer_blobs = create_fight_blob_layer(layer_scene)
    layer_blobs.set_board({
      width: 2,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 37, x: 0, y: 0, kind: 'floor' as const },
        { cell: 38, x: 1, y: 0, kind: 'floor' as const },
      ],
    })
    layer_blobs.upsert({
      id: 'targetable',
      cells: [37],
      shape: 'per_cell',
      color: 0x185ca8,
      animate_updates: false,
      created_at: 1_000,
    })
    layer_blobs.tick(1_000)
    const targetable = layer_scene.getObjectByName('fight_blob:targetable')?.children[0] as InstancedMesh
    expect(instance_transform(targetable, 0).scale.x).toBeCloseTo(0.001)

    layer_blobs.upsert({
      id: 'targetable',
      cells: [37, 38],
      shape: 'per_cell',
      color: 0x185ca8,
      animate_updates: false,
      created_at: 1_100,
    })
    layer_blobs.tick(1_100)
    expect(instance_transform(targetable, 1).scale.x).toBe(1)
    layer_blobs.dispose()
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
    expect(range?.children).toHaveLength(1)
    const range_cells = range?.children[0] as InstancedMesh
    expect(range_cells.count).toBe(3)
    const first_position = instance_transform(range_cells, 0).position
    expect(first_position.x).toBeCloseTo(0.665)
    expect(first_position.y).toBeCloseTo(BOARD_FLOOR_THICKNESS)
    expect(first_position.z).toBeCloseTo(0.665)
    expect(instance_transform(range_cells, 0).scale.x).toBeCloseTo(0.001)
    expect(instance_transform(range_cells, 1).scale.x).toBeCloseTo(0.001)
    expect(scene.getObjectByName('fight_blob:glyph')?.children).toHaveLength(1)
    blobs.tick(1_060)
    expect(instance_transform(range_cells, 1).scale.x).toBeGreaterThan(0.001)
    blobs.tick(1_500)
    expect(range_cells.visible).toBeFalse()
    blobs.set_board(board)
    expect(scene.getObjectByName('fight_blob:spell_range')).toBeUndefined()
    blobs.dispose()
  })

  test('batches a per-cell area into one instanced draw', () => {
    const scene = new Scene()
    const blobs = create_fight_blob_layer(scene)
    blobs.set_board({
      width: 3,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 30, x: 0, y: 0, kind: 'floor' as const },
        { cell: 31, x: 1, y: 0, kind: 'floor' as const },
        { cell: 32, x: 2, y: 0, kind: 'floor' as const },
      ],
    })
    blobs.upsert({ id: 'range', cells: [30, 31, 32], shape: 'per_cell', color: 0x35b34a, created_at: 1_000 })

    const range = scene.getObjectByName('fight_blob:range')
    expect(range?.children).toHaveLength(1)
    expect(range?.children[0]).toBeInstanceOf(InstancedMesh)
    expect((range?.children[0] as InstancedMesh | undefined)?.count).toBe(3)
    blobs.dispose()
  })

  test('renders a multi-cell trap as one seamless area with one spike at its anchor', () => {
    const scene = new Scene()
    const blobs = create_fight_blob_layer(scene)
    blobs.set_board({
      width: 2,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 30, x: 0, y: 0, kind: 'floor' as const },
        { cell: 31, x: 1, y: 0, kind: 'floor' as const },
      ],
    })
    blobs.upsert({
      id: 'traps',
      cells: [30, 31],
      shape: 'single',
      color: 0x14110b,
      decoration: 'trap',
      origin_cell: 30,
      animate: false,
      created_at: 1_000,
    })

    const trap = scene.getObjectByName('fight_blob:traps')
    expect(trap?.children.map(({ name }) => name)).toEqual(['fight_blob_shape', 'fight_trap_spikes'])
    const trap_spikes = trap?.getObjectByName('fight_trap_spikes') as InstancedMesh | undefined
    expect(trap_spikes?.count).toBe(1)
    expect(instance_transform(trap_spikes!, 0).position.x).toBeCloseTo(0.665)
    blobs.dispose()
  })

  test('renders higher-priority blobs above translucent range layers', () => {
    const scene = new Scene()
    const blobs = create_fight_blob_layer(scene)
    blobs.set_board({
      width: 1,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [{ cell: 34, x: 0, y: 0, kind: 'floor' as const }],
    })
    blobs.upsert({ id: 'range', cells: [34], shape: 'per_cell', color: 0x67b7ed, priority: 0, created_at: 1_000 })
    blobs.upsert({ id: 'hover', cells: [34], shape: 'single', color: 0xd73545, priority: 2, created_at: 1_000 })

    const range = scene.getObjectByName('fight_blob:range')?.children[0]
    const hover = scene.getObjectByName('fight_blob:hover')?.children[0]
    expect(hover?.renderOrder).toBeGreaterThan(range?.renderOrder ?? Number.POSITIVE_INFINITY)
    blobs.dispose()
  })

  test('reconciles a per-cell overlay without remounting shared cells', () => {
    const scene = new Scene()
    const blobs = create_fight_blob_layer(scene)
    const board = {
      width: 3,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      cells: [
        { cell: 34, x: 0, y: 0, kind: 'floor' as const },
        { cell: 35, x: 1, y: 0, kind: 'floor' as const },
        { cell: 36, x: 2, y: 0, kind: 'floor' as const },
      ],
    }
    blobs.set_board(board)
    blobs.upsert({ id: 'path', cells: [34, 35], shape: 'per_cell', color: 0x176b3a, created_at: 1_000 })
    blobs.tick(1_200)
    const first_path = scene.getObjectByName('fight_blob:path')
    const shared_draw = first_path?.children[0]

    blobs.upsert({ id: 'path', cells: [35, 36], shape: 'per_cell', color: 0x176b3a, created_at: 1_200 })
    const next_path = scene.getObjectByName('fight_blob:path')

    expect(next_path).toBe(first_path)
    expect(next_path?.children[0]).toBe(shared_draw)
    expect((next_path?.children[0] as InstancedMesh | undefined)?.count).toBe(2)
    blobs.dispose()
  })

  test('does not materialize placement bands when the board hides starting cells', () => {
    const scene = new Scene()
    const blobs = create_fight_blob_layer(scene)

    blobs.set_board({
      width: 2,
      height: 1,
      cell_size: 1.33,
      origin: { x: 0, y: 0, z: 0 },
      show_start_cells: false,
      cells: [
        { cell: 40, x: 0, y: 0, kind: 'start_a' },
        { cell: 41, x: 1, y: 0, kind: 'start_b' },
      ],
    })

    expect(scene.getObjectByName('fight_blob:__fight_start_a')).toBeUndefined()
    expect(scene.getObjectByName('fight_blob:__fight_start_b')).toBeUndefined()
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

  test('removes internal walls between adjacent board holes', () => {
    const mask = new Uint8Array([BOARD_CELL_HOLE, BOARD_CELL_HOLE])
    const pits = build_fight_board_pits(mask, 2, 1, 1.33, { x: 0, y: 0, z: 0 })

    expect(pits.getIndex()?.count).toBe(48)
    pits.dispose()
  })

  test('assigns hole walls only to the pit geometry', () => {
    const mask = new Uint8Array([
      BOARD_CELL_FLOOR,
      BOARD_CELL_FLOOR,
      BOARD_CELL_FLOOR,
      BOARD_CELL_FLOOR,
      BOARD_CELL_HOLE,
      BOARD_CELL_FLOOR,
      BOARD_CELL_FLOOR,
      BOARD_CELL_FLOOR,
      BOARD_CELL_FLOOR,
    ])
    const slab = build_fight_board_slab(mask, 3, 3, 1.33, { x: 0, y: 0, z: 0 })

    expect(slab.groups[1]?.count).toBe(72)
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
    camera.position.set(2, 10, 10)
    camera.lookAt(2, 0, 0)
    camera.updateMatrixWorld()
    expect(layer.pick(100, 100)).toBe(12)
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
