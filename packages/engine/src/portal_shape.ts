// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import profile from '../../../seed/structures/world_portal.recipe.json'
import dungeon from '../../../seed/structures/dungeon_portal.recipe.json'

import type { WorldMaterial } from './world_materials.ts'
import type { StructureAreaSource } from './structures.ts'
import type { CityBlock, CityStructureSource } from './cities/city_structure.ts'

export const PORTAL_ARCH = Object.freeze(profile)
export const portal_opening_columns = (): readonly Readonly<{ x: number; height: number }>[] =>
  Array.from({ length: profile.half_width * 2 }, (_, i) => {
    const x = i - profile.half_width
    return { x, height: profile.spring_height + Math.floor(Math.sqrt(profile.half_width ** 2 - (x + 0.5) ** 2)) }
  })

/** Opening columns own both the voxel cutout and the effect mesh's stepped boundary. */
export const portal_frame_source = (material: string): CityStructureSource => {
  const outer = profile.half_width + profile.thickness,
    height = profile.spring_height + outer + 2,
    blocks: CityBlock[] = []
  const openings = new Map(portal_opening_columns().map((c) => [c.x, c.height]))
  for (let x = -outer; x < outer; x++) {
    const top = profile.spring_height + Math.floor(Math.sqrt(outer ** 2 - (x + 0.5) ** 2))
    for (let y = -2; y <= top; y++) {
      if (y >= 0 && y < (openings.get(x) ?? 0)) continue
      for (let z = 0; z < profile.depth; z++) blocks.push([x + outer, y + 2, z, material])
    }
  }
  return {
    name: 'world_portal_frame',
    size: [outer * 2, height + 1, profile.depth],
    anchor: [outer, 2, Math.floor(profile.depth / 2)],
    blocks,
  }
}

export const DUNGEON_GATE = Object.freeze({ offset_z: dungeon.offset_z })
export const dungeon_gate_position = (x: number, z: number) => ({ x, z: z + DUNGEON_GATE.offset_z })

/** Material IDs remain identical whether terrain compilation includes structures or omits them. */
export const dungeon_gate_materials = (
  areas: readonly StructureAreaSource[] = []
): Readonly<Record<string, WorldMaterial>> =>
  areas.some(({ anchor_x, anchor_z }) => Number.isFinite(anchor_x) && Number.isFinite(anchor_z))
    ? (dungeon.materials as Readonly<Record<string, WorldMaterial>>)
    : {}

export const dungeon_gate_source = (): CityStructureSource => {
  const source = portal_frame_source('dungeon_basalt')
  const blocks = source.blocks.map(([x, y, z]): CityBlock => {
    const inlay =
      (z === 0 || z === profile.depth - 1) &&
      dungeon.inlay_heights.includes(y - source.anchor[1]) &&
      dungeon.inlay_columns.includes(x - source.anchor[0])
    const material = inlay ? 'dungeon_ember' : y % 3 === 0 ? 'dungeon_masonry' : 'dungeon_basalt'
    return [x, y, z, material]
  })
  return { ...source, name: 'dungeon_portal_frame', blocks }
}
