// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Matrix4, Vector3, type Camera } from 'three'

import type { FightBoardRender, Vec3 } from './types.ts'
import type { SpellEffectRecipe } from './spell_effect_recipe.ts'

export const spell_space = (board: FightBoardRender, from: Vec3, to: Vec3, recipe: SpellEffectRecipe) => {
  const scale = board.cell_size
  const direction = new Vector3(to[0] - from[0], 0, to[2] - from[2])
  const distance = direction.length() / scale
  if (distance < 0.001) direction.set(1, 0, 0)
  else direction.normalize()
  const x = direction.multiplyScalar(scale)
  const z = new Vector3(-x.z, 0, x.x)
  const local_to_world = new Matrix4().makeBasis(x, new Vector3(0, scale, 0), z)
  local_to_world.setPosition(new Vector3(...from).addScaledVector(x, -recipe.preset.cx))
  const world_to_local = local_to_world.clone().invert()
  const cells = new Uint8Array(board.width * board.height * 4)
  const area = new Set(recipe.areas.flatMap((row) => row.cells))
  board.cells.forEach((cell) => {
    const offset = (cell.y * board.width + cell.x) * 4
    cells[offset] = cell.kind === 'hole' || cell.kind === 'obstacle' ? 0 : 255
    cells[offset + 1] = area.has(cell.cell) ? 255 : 0
    cells[offset + 3] = 255
  })
  const spots = board.cells
    .filter((cell) => area.has(cell.cell))
    .map(
      (cell) => new Vector3(board.origin.x + (cell.x + 0.5) * scale, from[1], board.origin.z + (cell.y + 0.5) * scale)
    )
    .sort((left, right) => left.distanceToSquared(new Vector3(...to)) - right.distanceToSquared(new Vector3(...to)))
    .slice(0, 7)
    .map((point) => point.applyMatrix4(world_to_local).toArray())
  const packed_spots = Array.from({ length: 7 }, (_, index) => spots[index] ?? [0, 0, 0]).flat()
  return {
    vector: (x_offset: number, y_offset: number): Vec3 => [x.x * x_offset, scale * y_offset, x.z * x_offset],
    distance,
    cells,
    width: board.width,
    height: board.height,
    point: (world: Vec3): number[] => new Vector3(...world).applyMatrix4(world_to_local).toArray(),
    uniforms: (camera: Camera) => {
      const projection = new Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(local_to_world)
      return {
        aresSpots: packed_spots,
        aresSpotCount: spots.length,
        aresProjection: projection.elements,
        aresInverseProjection: projection.clone().invert().elements,
        aresLocalToWorld: local_to_world.elements,
        aresBoard: [board.origin.x, board.origin.z, scale, 0],
        aresBoardSize: [board.width, board.height],
        aresVerticalScale: (camera.projectionMatrix.elements[5]! * scale) / 2,
      }
    },
  }
}
