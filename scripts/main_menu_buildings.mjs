// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import workshop from '../seed/structures/workshop.recipe.json' with { type: 'json' }
import source from '../seed/structures/main_menu_houses.recipe.json' with { type: 'json' }

import { bake_schematic } from './bake_schematic.mjs'
import { module_transform } from './module_transform.mjs'

const ASSETS = { ...workshop.assets, ...source.assets }
const ROOF_MATERIALS = new Set(['roof', 'roof_edge', 'tile_red'])

/** Snow occupies the free half above a ridge slab or the cell above a stair, never an arbitrary mesh offset. */
const snow_caps = (pieces) => {
  const columns = new Map()
  for (const piece of pieces) {
    const [, [x, y, z]] = piece,
      key = `${x},${z}`
    const top = columns.get(key)
    if (!top || y > top[1][1]) columns.set(key, piece)
  }
  return [...columns.values()]
    .filter(([, , material]) => ROOF_MATERIALS.has(material))
    .map(([shape, [x, y, z], , , half]) =>
      shape === 'slab' && half === 'bottom'
        ? ['slab', [x, y, z], 'snow', 0, 'top']
        : ['slab', [x, y + 1, z], 'snow', 0, 'bottom']
    )
}

export const house_footprint = (definition) => {
  const transform = module_transform(definition)
  const points = ASSETS[definition.asset].pieces.flatMap(([, [x, y, z]]) =>
    [
      [x, y, z],
      [x + 1, y + 1, z + 1],
    ].map(transform.point)
  )
  return {
    min_x: Math.min(...points.map(([x]) => x)) - 2,
    max_x: Math.max(...points.map(([x]) => x)) + 2,
    min_z: Math.min(...points.map(([, , z]) => z)) - 2,
    max_z: Math.max(...points.map(([, , z]) => z)) + 2,
    y: definition.position[1],
  }
}

/** Menu architecture is the city/workshop kit with a winter palette and snow, not a second house grammar. */
export const author_house = (definition, { set, glows, details, vines = [] }) => {
  const palette = { ...source.palette, ...definition.palette }
  const assets = Object.fromEntries(
    Object.entries(ASSETS).map(([name, asset]) => [
      name,
      {
        ...asset,
        pieces: [...(asset.pieces ?? []), ...snow_caps(asset.pieces ?? [])].map(
          ([shape, position, material, ...rest]) => [shape, position, palette[material] ?? material, ...rest]
        ),
        ...(asset.details && {
          details: asset.details.map((operation) => [
            ...operation.slice(0, -1),
            palette[operation.at(-1)] ?? operation.at(-1),
          ]),
        }),
      },
    ])
  )
  const root = {
    kind: 'building',
    parts: [{ asset: definition.asset, position: definition.position, rotation: definition.rotation }],
  }
  const baked = bake_schematic({ ...assets, menu_house: root }, 'menu_house', [0, 0, 0], details)
  baked.blocks.forEach(([x, y, z, material]) => set(x, y, z, material))
  vines.push(...baked.vines)
  const transform = module_transform(definition)
  for (const part of ASSETS[definition.asset].parts.filter(({ asset }) => asset === 'lantern'))
    glows.push({
      center: transform.point([part.position[0], part.position[1] + 0.8, part.position[2]]),
      size: 2,
      color: [2.4, 1.2, 0.45],
    })
}
