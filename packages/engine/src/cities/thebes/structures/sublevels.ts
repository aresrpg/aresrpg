// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  city_blocks,
  compile_positioned_city_structure,
  type CityBlockBuilder,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import { sample_world_column, type CompiledWorld } from '../../../world_recipe.ts'
import type { CompiledCity } from '../../types.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'
import { thebes_layout } from '../plan.ts'

export const thebes_catacomb_layout = (world: CompiledWorld, city: CompiledCity) => {
  const x = city.area.anchor_x,
    z = city.area.anchor_z
  const samples = [-64, 0, 64].flatMap((dx) =>
    [-48, 0, 64].map((dz) => sample_world_column(world, x + dx, z + dz).surface_y)
  )
  const y = Math.max(8, Math.min(...samples) - 16)
  return {
    x,
    y,
    z,
    rooms: [
      [-48, -32],
      [0, -32],
      [48, -32],
      [-48, 32],
      [0, 32],
      [48, 32],
    ] as const,
  }
}

const vaulted_passage = (
  builder: CityBlockBuilder,
  x: number,
  y: number,
  z: number,
  length: number,
  along_x: boolean
): void => {
  const point = (along: number, across: number): readonly [number, number] =>
    along_x ? [x + along, z + across] : [x + across, z + along]
  for (let along = 0; along <= length; along++) {
    for (let across = -4; across <= 4; across++) {
      const [px, pz] = point(along, across)
      const roof = y + 5 + Math.floor(Math.sqrt(16 - across * across))
      builder.fill(px, px, y, roof, pz, pz, M.limestone)
      if (Math.abs(across) < 4) builder.fill(px, px, y + 1, roof - 1, pz, pz, 'air')
    }
  }
}

const crypt = (world: CompiledWorld, x: number, y: number, z: number, index: number): PositionedCityStructure => {
  const builder = city_blocks()
  builder.fill(x - 10, x + 10, y, y + 9, z - 10, z + 10, M.sandstone)
  builder.fill(x - 9, x + 9, y + 1, y + 8, z - 9, z + 9, 'air')
  for (const offset of [-6, 0, 6]) {
    builder.fill(x - 9, x - 6, y + 1, y + 2, z + offset - 1, z + offset + 1, M.limestone)
    builder.fill(x + 6, x + 9, y + 1, y + 2, z + offset - 1, z + offset + 1, M.limestone)
    builder.set(x + offset, y + 6, z - 9, M.lantern)
  }
  builder.fill(x - 2, x + 2, y + 1, y + 5, z - 10, z + 10, 'air')
  return compile_positioned_city_structure(`thebes_crypt_${index}`, builder.finish(), world.materials)
}

const entrance = (world: CompiledWorld, x: number, y: number, z: number, side: number): PositionedCityStructure => {
  const builder = city_blocks()
  const surface = sample_world_column(world, x, z).surface_y - 1
  const drop = surface - y
  const length = Math.max(64, drop + 4)
  for (let step = 0; step <= length; step++) {
    const floor = surface - Math.min(step, drop)
    builder.fill(x - 3, x + 3, floor, floor + 6, z + step, z + step, M.limestone)
    builder.fill(x - 2, x + 2, floor + 1, floor + 5, z + step, z + step, 'air')
  }
  builder.fill(x - 3, x + 3, y + 1, y + 6, z + length - 4, z + length, 'air')
  // Open the street mouth; the underground flight remains roofed after the first steps.
  builder.fill(x - 2, x + 2, surface + 1, surface + 8, z, z + 4, 'air')
  builder.fill(x - 4, x - 3, surface, surface + 6, z, z + 1, M.sandstone)
  builder.fill(x + 3, x + 4, surface, surface + 6, z, z + 1, M.sandstone)
  builder.fill(x - 3, x + 3, surface + 6, surface + 7, z, z + 1, M.limestone)
  builder.set(x, surface + 6, z - 1, M.lantern)
  return compile_positioned_city_structure(`thebes_catacomb_entry_${side}`, builder.finish(), world.materials)
}

/** Air is an explicit voxel operation: entrances, tunnels and collision share the same baked source. */
export const build_thebes_sublevels = (
  world: CompiledWorld,
  city: CompiledCity
): readonly PositionedCityStructure[] => {
  const { x, y, z, rooms } = thebes_catacomb_layout(world, city)
  const [entry_x, entry_z] = thebes_layout(city).cemetery_entry
  const entry_length = Math.max(64, sample_world_column(world, entry_x, entry_z).surface_y - 1 - y + 4)
  const junction_z = entry_z + entry_length
  const cemetery_hall = city_blocks()
  vaulted_passage(cemetery_hall, entry_x, y, junction_z, z + 64 - junction_z, false)
  cemetery_hall.fill(entry_x - 3, entry_x + 3, y + 1, y + 6, junction_z, junction_z + 4, 'air')
  cemetery_hall.fill(entry_x - 4, entry_x + 4, y + 1, y + 6, z + 60, z + 64, 'air')
  const halls = city_blocks()
  vaulted_passage(halls, x - 64, y, z + 64, 128, true)
  for (const dx of [-48, 0, 48]) vaulted_passage(halls, x + dx, y, z - 48, 112, false)
  for (const dx of [-48, 0, 48]) halls.fill(x + dx - 4, x + dx + 4, y + 1, y + 6, z + 60, z + 68, 'air')
  return [
    ...rooms.map(([dx, dz], index) => crypt(world, x + dx, y, z + dz, index)),
    compile_positioned_city_structure('thebes_catacomb_halls', halls.finish(), world.materials),
    compile_positioned_city_structure('thebes_cemetery_hall', cemetery_hall.finish(), world.materials),
    entrance(world, x - 64, y, z, -1),
    entrance(world, x + 64, y, z, 1),
    entrance(world, entry_x, y, entry_z, 2),
  ]
}
