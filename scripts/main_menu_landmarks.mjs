// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { module_transform } from './module_transform.mjs'
import { building_kit } from './building_kit.mjs'
import { author_house } from './main_menu_buildings.mjs'
import { harbor_lamp, harbor_banner } from './harbor_details.mjs'

const TOWER_WINDOW = ['sssss', 'swtws', 'swtws', 'swtws', 'swtws', 'swtws', 'sssss']
const WINDOW_PIECES = { s: ['stone', -6], w: ['window_dark', -5], t: ['trim', -6] }

const tower_details = (set, kit, x, y, z, height) => {
  const levels = Array.from({ length: Math.floor((height - 3) / 10) }, (_, index) => 6 + index * 10)
  const facade = [
    ...Array.from({ length: height + 1 }, (_, level) => [-5, 5].map((corner) => [corner, level, -6, 'rock'])).flat(),
    ...levels.flatMap((level) =>
      TOWER_WINDOW.flatMap((row, dy) =>
        [...row].map((symbol, dx) => {
          const [material, depth] = WINDOW_PIECES[symbol]
          return [dx - 2, level + dy - 1, depth, material]
        })
      )
    ),
    ...levels.flatMap((level) => Array.from({ length: 7 }, (_, index) => [index - 3, level - 2, -6, 'brass'])),
    ...Array.from({ length: 13 }, (_, index) => [index - 6, height, -6, 'stone']),
  ]
  for (const rotation of [0, 1, 2, 3]) {
    const transform = module_transform({ position: [x, y, z], rotation })
    facade.forEach(([dx, dy, dz, material]) => set(...transform.point([dx, dy, dz]), material))
    for (const dx of [-3, 0, 3])
      kit.add(['stair', [dx, height - 1, -6], 'stone', 1, 'top'], transform.point, 'tower corbel')
  }
}

const harbor_standard = ({ position: [x, y, z], scale }, { set, fill, ground, details }) => {
  const mast_x = Math.ceil(x + 1.6 * scale),
    top = Math.ceil(y + 4.6 * scale)
  const base = Math.max(45, Math.floor(ground(mast_x, z)))
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      fill(mast_x + dx, mast_x + dx, Math.floor(ground(mast_x + dx, z + dz)) - 1, base, z + dz, z + dz, 'stone')
  fill(mast_x, mast_x, base + 1, top + 1, z, z, 'trim')
  fill(Math.floor(x - 1.6 * scale), mast_x, top, top, z, z, 'wood')
  set(mast_x, top + 2, z, 'snow')
  harbor_banner(details, x, y, z, scale)
}

/** Authored harbor masonry and working-waterfront props, compiled into ordinary voxel chunks. */
export const dress_harbor = ({ fill, set, ground, glows, details, recipe }) => {
  const lamp = (x, y, z) => harbor_lamp(details, glows, x, y, z)
  const foundation = (x0, x1, y, z0, z1, material) => {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) fill(x, x, Math.min(y, Math.floor(ground(x, z))) - 1, y, z, z, material)
  }
  const tower = (x, y, z, height) => {
    foundation(x - 5, x + 5, y, z - 5, z + 5, 'stone')
    fill(x - 5, x + 5, y - 14, y + height, z - 5, z + 5, 'stone')
    const kit = building_kit()
    tower_details(set, kit, x, y, z, height)
    const roof_pieces = Array.from({ length: 225 }, (_, index) => {
      const dx = (index % 15) - 7,
        dz = Math.floor(index / 15) - 7
      const radius = Math.max(Math.abs(dx), Math.abs(dz)),
        top = y + height + 8 - radius
      const rotation = Math.abs(dx) >= Math.abs(dz) ? (dx < 0 ? 0 : 2) : dz < 0 ? 1 : 3
      return [
        [radius === 0 ? 'block' : 'stair', [x + dx, top, z + dz], 'blue_roof', rotation, 'bottom'],
        [radius === 0 ? 'block' : 'slab', [x + dx, top + 1, z + dz], 'snow', 0, 'bottom'],
      ]
    }).flat()
    roof_pieces.forEach((piece) => kit.add(piece, (point) => point, 'harbor tower'))
    kit.finish(details).forEach(([px, py, pz, material]) => set(px, py, pz, material))
    fill(x, x, y + height + 10, y + height + 14, z, z, 'brass')
  }

  const citadel = ({ position: [x, y, z], tower_heights, keep_asset }) => {
    foundation(x, x + 43, y, z, z + 30, 'rock')
    fill(x, x + 43, y + 1, y + 12, z, z + 2, 'stone')
    fill(x, x + 2, y + 1, y + 12, z, z + 30, 'stone')
    fill(x + 41, x + 43, y + 1, y + 12, z, z + 30, 'stone')
    fill(x, x + 43, y + 1, y + 12, z + 28, z + 30, 'stone')
    fill(x + 3, x + 40, y + 1, y + 1, z + 3, z + 27, 'snow')
    for (let offset = 0; offset <= 42; offset += 4) {
      fill(x + offset, x + offset + 1, y + 13, y + 14, z, z + 2, 'stone')
      fill(x + offset, x + offset + 1, y + 15, y + 15, z, z + 2, 'snow')
    }
    for (const offset of [7, 13, 29, 35]) {
      fill(x + offset, x + offset, y - 5, y + 12, z - 1, z - 1, 'rock')
      fill(x + offset + 1, x + offset + 1, y + 5, y + 8, z - 1, z - 1, 'window_dark')
    }
    ;[
      [0, 0],
      [43, 0],
      [0, 30],
      [43, 30],
    ].forEach(([dx, dz], index) => tower(x + dx, y, z + dz, tower_heights[index]))
    author_house(
      {
        name: 'harbor keep',
        asset: keep_asset,
        position: [x + 10, y + 2, z + 8],
        rotation: 0,
        palette: { plaster: 'stone', roof: 'red_roof', window_dark: 'window' },
      },
      { set, glows, details }
    )
    // Gate arch and lower vaulted passage share the same explicit-air occupancy as collision.
    for (let dx = -5; dx <= 5; dx++) {
      const roof = y + 7 + Math.floor(Math.sqrt(25 - dx * dx))
      fill(x + 21 + dx, x + 21 + dx, y + 1, roof, z - 1, z + 5, 'air')
    }
    for (let dx = -7; dx <= 7; dx++) {
      const top = y + 8 + Math.floor(Math.sqrt(49 - dx * dx))
      fill(x + 21 + dx, x + 21 + dx, top, top + 1, z - 1, z - 1, 'rock')
    }
    fill(x + 13, x + 29, y + 1, y + 2, z - 12, z - 1, 'wood')
    lamp(x + 12, y + 2, z - 10)
    lamp(x + 30, y + 2, z - 10)
    harbor_banner(details, x + 9, y + 10.4, z - 0.2)
  }
  recipe.castles.forEach(citadel)
  const {
    position: [clock_x, clock_y, clock_z],
    height: clock_height,
  } = recipe.clock_tower
  tower(clock_x, clock_y, clock_z, clock_height)
  fill(clock_x - 2, clock_x + 2, clock_y + 20, clock_y + 24, clock_z - 7, clock_z - 7, 'window')
  fill(clock_x, clock_x, clock_y + 21, clock_y + 25, clock_z - 8, clock_z - 8, 'trim')
  fill(clock_x, clock_x + 3, clock_y + 22, clock_y + 22, clock_z - 8, clock_z - 8, 'trim')
  harbor_standard(recipe.harbor_banner, { set, fill, ground, details })
  // Snow trails and retaining walls follow the terraced village rather than a bare smooth hill.
  const trails = [-1, 1].flatMap((side) => Array.from({ length: 162 }, (_, index) => ({ side, z: index - 4 })))
  for (const { side, z } of trails) {
    const x = Math.round(side * (57 + z * 0.22 + Math.sin(z * 0.045) * 6))
    const y = Math.round(ground(x, z))
    fill(x - 3, x + 3, y - 3, y, z, z, 'stone')
    fill(x - 3, x + 3, y + 1, y + 1, z, z, 'snow')
    set(x, y + 1, z, 'stone')
    if (z % 23 === 0) lamp(x + side * 4, y + 1, z)
  }
  // A inhabited lower cave level, with warm shopfronts beneath the upper village.
  for (let dx = -7; dx <= 7; dx++) {
    const top = 53 + Math.floor(Math.sqrt(49 - dx * dx))
    fill(-88 + dx, -88 + dx, 47, top, 51, 77, 'air')
  }
  fill(-95, -81, 46, 46, 49, 78, 'stone')
  fill(-91, -85, 48, 54, 76, 76, 'wood')
  fill(-89, -87, 49, 52, 75, 75, 'window')
  lamp(-95, 47, 48)
  // Cargo crates, iron-banded casks and small fishing stages along both piers.
  for (let index = 0; index < 22; index++) {
    const x = index % 2 === 0 ? -45 : 48
    const z = -48 + index * 6
    const y = index % 2 === 0 ? 46 : Math.max(44, Math.round(ground(x, z)))
    fill(x, x + 2, y, y + 2, z, z + 2, 'wood')
    fill(x, x + 2, y + 1, y + 1, z - 1, z + 2, 'trim')
    fill(x, x + 2, y + 3, y + 3, z, z + 2, 'snow')
    if (index % 3 === 0) lamp(x - 3, y, z)
  }
  // Hand-composed broken plates, with shipping lanes left open between their groups.
  const shards = recipe.ice_groups.flatMap(({ center: [x, z], shards }) =>
    shards.map(([dx, dz, w, d, h]) => ({ x, z, dx, dz, w, d, h }))
  )
  for (const { x, z, dx, dz, w, d, h } of shards) {
    fill(x + dx, x + dx + w, 39, 42 + h, z + dz, z + dz + d, 'ice')
    fill(x + dx + 1, x + dx + w - 1, 43 + h, 43 + h, z + dz + 1, z + dz + d - 1, 'snow')
    set(x + dx, 42 + h, z + dz, 'snow')
  }
  // Shore-bound shelves and hanging blue ice teeth.
  const shores = [-1, 1].flatMap((side) => Array.from({ length: 74 }, (_, index) => ({ side, z: -50 + index * 3 })))
  for (const { side, z } of shores) {
    const x = Math.round(side * (40 + z * 0.075))
    const reach = 3 + Math.abs(z % 5)
    fill(x - reach, x + reach, 40, 42, z, z + 2, 'ice')
    fill(x - 2, x + 2, 43, 43, z, z + 1, 'snow')
  }
}
