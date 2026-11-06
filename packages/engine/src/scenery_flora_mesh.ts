// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ore_vein } from './nature/ore_vein.ts'
import { rock_pebbles } from './nature/rock_pebbles.ts'
import { conifer_sprite } from './nature/conifer_sprite.ts'
import { hanging_ice } from './nature/hanging_ice.ts'
import { herb_tall_grass } from './nature/herb_tall_grass.ts'
import { herb_fern } from './nature/herb_fern.ts'
import { herb_bush } from './nature/herb_bush.ts'
import { mushroom_toadstool } from './nature/mushroom_toadstool.ts'
import { ice_spike } from './nature/ice_spike.ts'
import { mulberry, rotate_y, type SpriteBuilder } from './nature/sprite_kit.ts'
import { nature_uv, type NatureSurface } from './nature/surface.ts'
import type { SceneryPlant } from './scenery_data.ts'

const builders: Readonly<Record<SceneryPlant['kind'], Readonly<{ build: SpriteBuilder; surface: NatureSurface }>>> = {
  fern: { build: herb_fern, surface: 'plant' },
  bush: { build: herb_bush, surface: 'plant' },
  mushroom: { build: mushroom_toadstool, surface: 'mushroom' },
  spike: { build: ice_spike, surface: 'plain' },
  icicle: { build: hanging_ice, surface: 'plain' },
  grass: { build: herb_tall_grass, surface: 'plant' },
  pine: { build: conifer_sprite, surface: 'plain' },
  mineral: { build: ore_vein, surface: 'mineral' },
  rock: { build: rock_pebbles, surface: 'mineral' },
}

export const build_flora_mesh = (rows: readonly SceneryPlant[]) => {
  if (rows.length === 0) return null
  const vertices = rows.flatMap((row, index) =>
    builders[row.kind].build(mulberry(index * 977 + 43)).map((vertex) => {
      const [x, y, z, blend, sway] = rotate_y(vertex, index * 2.399)
      return {
        uv: nature_uv(builders[row.kind].surface, vertex),
        position: [x * row.scale + row.center[0], y * row.scale + row.center[1], z * row.scale + row.center[2]],
        color: row.color.map((channel, axis) => channel + (row.accent[axis]! - channel) * blend),
        sway: sway * row.scale,
        phase: row.center[0] + row.center[2],
        glow: (row.glow ?? 0) * blend,
        ice: Number(row.kind === 'icicle' || row.kind === 'spike' || row.kind === 'mineral'),
      }
    })
  )
  return {
    position: new Float32Array(vertices.flatMap((row) => row.position)),
    uv: new Float32Array(vertices.flatMap((row) => row.uv)),
    color: new Float32Array(vertices.flatMap((row) => row.color)),
    sway: new Float32Array(vertices.map((row) => row.sway)),
    phase: new Float32Array(vertices.map((row) => row.phase)),
    glow: new Float32Array(vertices.map((row) => row.glow)),
    ice: new Float32Array(vertices.map((row) => row.ice)),
  }
}
export type FloraMeshData = NonNullable<ReturnType<typeof build_flora_mesh>>
