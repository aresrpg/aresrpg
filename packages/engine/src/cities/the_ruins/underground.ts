// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { city_blocks, type CityBlock, type CityBlockBuilder } from '../city_structure.ts'
import type { CompiledCity } from '../types.ts'

import { THE_RUINS_MATERIALS as M } from './materials.ts'

type Point = readonly [x: number, z: number]
type Route = Readonly<{ from: Point; to: Point; kind: 'gallery' | 'cave' }>
export type RuinsBlockDraft = Readonly<{ id: string; blocks: readonly CityBlock[] }>

const ROUTES: readonly Route[] = Object.freeze([
  { from: [0, 20], to: [0, 230], kind: 'gallery' },
  { from: [0, 220], to: [0, 440], kind: 'gallery' },
  { from: [0, 430], to: [0, 640], kind: 'cave' },
  { from: [-220, 180], to: [0, 180], kind: 'gallery' },
  { from: [0, 180], to: [220, 180], kind: 'gallery' },
  { from: [-300, 360], to: [-150, 360], kind: 'cave' },
  { from: [-150, 360], to: [0, 360], kind: 'cave' },
  { from: [0, 360], to: [250, 360], kind: 'gallery' },
  { from: [-180, 540], to: [0, 540], kind: 'gallery' },
  { from: [0, 540], to: [160, 540], kind: 'cave' },
  { from: [160, 540], to: [320, 540], kind: 'cave' },
])

const CHAMBERS = Object.freeze([
  { point: [0, 180] as const, radius: 20 },
  { point: [-210, 180] as const, radius: 17 },
  { point: [210, 180] as const, radius: 18 },
  { point: [0, 360] as const, radius: 24 },
  { point: [-286, 360] as const, radius: 19 },
  { point: [238, 360] as const, radius: 18 },
  { point: [0, 540] as const, radius: 23 },
  { point: [-168, 540] as const, radius: 17 },
  { point: [306, 540] as const, radius: 26 },
  { point: [0, 630] as const, radius: 21 },
])

const tunnel_air = (city: CompiledCity, floor_y: number, { from, to, kind }: Route): readonly CityBlock[] => {
  const [from_x, from_z] = from
  const [to_x, to_z] = to
  const along_x = from_z === to_z
  const half_width = kind === 'cave' ? 5 : 3
  const height = kind === 'cave' ? 10 : 7
  const min_x = city.area.anchor_x + Math.min(from_x, to_x) - (along_x ? 0 : half_width)
  const max_x = city.area.anchor_x + Math.max(from_x, to_x) + (along_x ? 0 : half_width)
  const min_z = city.area.anchor_z + Math.min(from_z, to_z) - (along_x ? half_width : 0)
  const max_z = city.area.anchor_z + Math.max(from_z, to_z) + (along_x ? half_width : 0)
  const blocks = city_blocks()
  blocks.fill(min_x, max_x, floor_y, floor_y + height, min_z, max_z, 'air')
  return blocks.finish()
}

const chamber_air = (
  city: CompiledCity,
  floor_y: number,
  [offset_x, offset_z]: Point,
  radius: number
): readonly CityBlock[] => {
  const center_x = city.area.anchor_x + offset_x
  const center_z = city.area.anchor_z + offset_z
  const center_y = floor_y + Math.floor(radius / 3)
  const blocks: CityBlock[] = []
  for (let y = center_y - Math.floor(radius / 2); y <= center_y + Math.floor(radius / 2); y += 1)
    for (let z = center_z - radius; z <= center_z + radius; z += 1)
      for (let x = center_x - radius; x <= center_x + radius; x += 1)
        if (Math.hypot(x - center_x, (y - center_y) * 1.65, z - center_z) <= radius) blocks.push([x, y, z, 'air'])
  return Object.freeze(blocks)
}

const route_point = (route: Route, distance: number): Point => {
  const [from_x, from_z] = route.from
  const [to_x, to_z] = route.to
  const length = Math.max(Math.abs(to_x - from_x), Math.abs(to_z - from_z))
  const amount = Math.min(1, distance / length)
  return [Math.round(from_x + (to_x - from_x) * amount), Math.round(from_z + (to_z - from_z) * amount)]
}

const add_support = (
  blocks: CityBlockBuilder,
  x: number,
  z: number,
  floor_y: number,
  along_x: boolean,
  broken: boolean
): void => {
  if (along_x) {
    blocks.fill(x, x, floor_y, floor_y + (broken ? 3 : 7), z - 3, z - 3, M.timber)
    blocks.fill(x, x, floor_y, floor_y + 7, z + 3, z + 3, M.timber)
    if (!broken) blocks.fill(x, x, floor_y + 7, floor_y + 7, z - 3, z + 3, M.timber)
    return
  }
  blocks.fill(x - 3, x - 3, floor_y, floor_y + (broken ? 3 : 7), z, z, M.timber)
  blocks.fill(x + 3, x + 3, floor_y, floor_y + 7, z, z, M.timber)
  if (!broken) blocks.fill(x - 3, x + 3, floor_y + 7, floor_y + 7, z, z, M.timber)
}

const route_supports = (city: CompiledCity, floor_y: number, route: Route, order: number): readonly CityBlock[] => {
  const blocks = city_blocks()
  const along_x = route.from[1] === route.to[1]
  const length = Math.max(Math.abs(route.to[0] - route.from[0]), Math.abs(route.to[1] - route.from[1]))
  for (let distance = 4; distance < length; distance += 12) {
    const [offset_x, offset_z] = route_point(route, distance)
    const x = city.area.anchor_x + offset_x
    const z = city.area.anchor_z + offset_z
    const broken = (distance / 12 + order) % 5 === 2
    add_support(blocks, x, z, floor_y, along_x, broken)
  }
  return blocks.finish()
}

const route_rails = (city: CompiledCity, floor_y: number, route: Route): readonly CityBlock[] => {
  const blocks = city_blocks()
  const along_x = route.from[1] === route.to[1]
  const length = Math.max(Math.abs(route.to[0] - route.from[0]), Math.abs(route.to[1] - route.from[1]))
  for (let distance = 0; distance <= length; distance += 1) {
    const [offset_x, offset_z] = route_point(route, distance)
    const x = city.area.anchor_x + offset_x
    const z = city.area.anchor_z + offset_z
    blocks.set(x, floor_y - 1, z, M.timber)
    if (along_x) {
      blocks.set(x, floor_y, z - 2, M.iron)
      blocks.set(x, floor_y, z + 2, M.iron)
      if (distance % 4 === 0) blocks.fill(x, x, floor_y - 1, floor_y - 1, z - 3, z + 3, M.timber)
    } else {
      blocks.set(x - 2, floor_y, z, M.iron)
      blocks.set(x + 2, floor_y, z, M.iron)
      if (distance % 4 === 0) blocks.fill(x - 3, x + 3, floor_y - 1, floor_y - 1, z, z, M.timber)
    }
  }
  return blocks.finish()
}

const mineshaft_detail = (city: CompiledCity, floor_y: number, route: Route, order: number): readonly CityBlock[] =>
  Object.freeze([...route_supports(city, floor_y, route, order), ...route_rails(city, floor_y, route)])

const chamber_detail = (
  city: CompiledCity,
  floor_y: number,
  { point: [offset_x, offset_z], radius }: (typeof CHAMBERS)[number],
  order: number
): readonly CityBlock[] => {
  const blocks = city_blocks()
  const x = city.area.anchor_x + offset_x
  const z = city.area.anchor_z + offset_z
  blocks.fill(x - 4, x + 4, floor_y - 1, floor_y - 1, z - 4, z + 4, M.timber)
  blocks.fill(x - 1, x + 1, floor_y, floor_y + 2, z - 1, z + 1, M.stone)
  for (let ray = 0; ray < 8; ray += 1) {
    const angle = (ray / 8) * Math.PI * 2
    for (let distance = 5; distance < radius - 2; distance += 3)
      blocks.set(
        Math.round(x + Math.cos(angle) * distance),
        floor_y + 3 + ((distance + order) % 3),
        Math.round(z + Math.sin(angle) * distance),
        M.silk
      )
  }
  return blocks.finish()
}

export const ruins_underground = (city: CompiledCity, floor_y: number): readonly RuinsBlockDraft[] =>
  Object.freeze([
    ...ROUTES.map((route, index) =>
      Object.freeze({
        id: `city:the_ruins:10:air:gallery:${String(index).padStart(2, '0')}`,
        blocks: tunnel_air(city, floor_y, route),
      })
    ),
    ...CHAMBERS.map(({ point, radius }, index) =>
      Object.freeze({
        id: `city:the_ruins:10:air:cavern:${String(index).padStart(2, '0')}`,
        blocks: chamber_air(city, floor_y, point, radius),
      })
    ),
    ...ROUTES.map((route, index) =>
      Object.freeze({
        id: `city:the_ruins:20:mineshaft:${String(index).padStart(2, '0')}`,
        blocks: mineshaft_detail(city, floor_y, route, index),
      })
    ),
    ...CHAMBERS.map((chamber, index) =>
      Object.freeze({
        id: `city:the_ruins:30:cavern-webs:${String(index).padStart(2, '0')}`,
        blocks: chamber_detail(city, floor_y, chamber, index),
      })
    ),
  ])

export const RUINS_MINE_BOUNDS = Object.freeze({ min_x: -330, max_x: 350, min_z: 12, max_z: 670 })
