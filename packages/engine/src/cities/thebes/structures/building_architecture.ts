// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { THEBES_MATERIALS as M } from '../materials.ts'

import type { ThebesBuildingStyle } from './building.ts'

const WEST = 1
const EAST = 2
const NORTH = 4
const SOUTH = 8

export type BuildingPainter = Readonly<{
  set: (x: number, y: number, z: number, material: string) => void
  clear: (x: number, y: number, z: number) => void
}>
export type BuildingArchitecture = Readonly<{
  style: ThebesBuildingStyle
  origin_x: number
  origin_z: number
  datum: number
  width: number
  depth: number
  floors: number
  wall: string
  roof: string
  entrance: number
  seed: number
}>

const accent_for = ({ wall }: BuildingArchitecture): string => (wall === 'temperate_wood' ? M.copper : 'temperate_wood')

const framed_window_x = (painter: BuildingPainter, x: number, y: number, z: number, accent: string): void => {
  for (let offset = -1; offset <= 1; offset += 1) {
    painter.set(x + offset, y - 1, z, accent)
    painter.set(x + offset, y + 2, z, accent)
  }
  for (let height = 0; height <= 1; height += 1) {
    painter.set(x, y + height, z, M.tile)
    painter.set(x - 2, y + height, z, accent)
    painter.set(x + 2, y + height, z, accent)
  }
}

const framed_window_z = (painter: BuildingPainter, x: number, y: number, z: number, accent: string): void => {
  for (let offset = -1; offset <= 1; offset += 1) {
    painter.set(x, y - 1, z + offset, accent)
    painter.set(x, y + 2, z + offset, accent)
  }
  for (let height = 0; height <= 1; height += 1) {
    painter.set(x, y + height, z, M.tile)
    painter.set(x, y + height, z - 2, accent)
    painter.set(x, y + height, z + 2, accent)
  }
}

const on_entrance_wall = (entrance: number, side: number, position: number, middle: number): boolean =>
  entrance === side && Math.abs(position - middle) < 4

const add_windows_x = (
  painter: BuildingPainter,
  spec: BuildingArchitecture,
  y: number,
  middle_x: number,
  accent: string
): void => {
  for (let x = spec.origin_x + 3; x < spec.origin_x + spec.width - 2; x += 5) {
    if (!on_entrance_wall(spec.entrance, NORTH, x, middle_x)) framed_window_x(painter, x, y, spec.origin_z, accent)
    if (!on_entrance_wall(spec.entrance, SOUTH, x, middle_x))
      framed_window_x(painter, x, y, spec.origin_z + spec.depth, accent)
  }
}

const add_windows_z = (
  painter: BuildingPainter,
  spec: BuildingArchitecture,
  y: number,
  middle_z: number,
  accent: string
): void => {
  for (let z = spec.origin_z + 3; z < spec.origin_z + spec.depth - 2; z += 5) {
    if (!on_entrance_wall(spec.entrance, WEST, z, middle_z)) framed_window_z(painter, spec.origin_x, y, z, accent)
    if (!on_entrance_wall(spec.entrance, EAST, z, middle_z))
      framed_window_z(painter, spec.origin_x + spec.width, y, z, accent)
  }
}

const WINDOWLESS_STYLES: readonly ThebesBuildingStyle[] = Object.freeze(['market', 'monument', 'ruin'])
const add_windows = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  if (WINDOWLESS_STYLES.includes(spec.style)) return
  const middle_x = spec.origin_x + Math.floor(spec.width / 2)
  const middle_z = spec.origin_z + Math.floor(spec.depth / 2)
  const accent = accent_for(spec)
  for (let floor = 0; floor < spec.floors; floor += 1) {
    const y = spec.datum + floor * 5 + 2
    add_windows_x(painter, spec, y, middle_x, accent)
    add_windows_z(painter, spec, y, middle_z, accent)
  }
}

const BEAM_STYLES: readonly ThebesBuildingStyle[] = Object.freeze(['wood', 'barracks', 'town_hall'])
const add_x_beams = (painter: BuildingPainter, spec: BuildingArchitecture, top: number): void => {
  for (let x = spec.origin_x; x <= spec.origin_x + spec.width; x += 5)
    for (const z of [spec.origin_z, spec.origin_z + spec.depth])
      for (let y = spec.datum + 1; y < top; y += 1) painter.set(x, y, z, 'temperate_wood')
}

const add_z_beams = (painter: BuildingPainter, spec: BuildingArchitecture, top: number): void => {
  for (let z = spec.origin_z; z <= spec.origin_z + spec.depth; z += 5)
    for (const x of [spec.origin_x, spec.origin_x + spec.width])
      for (let y = spec.datum + 1; y < top; y += 1) painter.set(x, y, z, 'temperate_wood')
}

const add_vertical_beams = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  if (!BEAM_STYLES.includes(spec.style)) return
  const top = spec.datum + spec.floors * 5
  add_x_beams(painter, spec, top)
  add_z_beams(painter, spec, top)
}

const roof_layer_x = (
  painter: BuildingPainter,
  spec: BuildingArchitecture,
  y: number,
  min_z: number,
  max_z: number
): void => {
  for (let z = min_z; z <= max_z; z += 1)
    for (let x = spec.origin_x - 2; x <= spec.origin_x + spec.width + 2; x += 1) painter.set(x, y, z, spec.roof)
}

const roof_layer_z = (
  painter: BuildingPainter,
  spec: BuildingArchitecture,
  y: number,
  min_x: number,
  max_x: number
): void => {
  for (let x = min_x; x <= max_x; x += 1)
    for (let z = spec.origin_z - 2; z <= spec.origin_z + spec.depth + 2; z += 1) painter.set(x, y, z, spec.roof)
}

const add_pitched_roof = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  const roof_y = spec.datum + spec.floors * 5
  const ridge_x = spec.width > spec.depth || (spec.width === spec.depth && (spec.seed & 1) === 0)
  const span = ridge_x ? spec.depth : spec.width
  for (let inset = 0; inset <= Math.floor((span + 4) / 2); inset += 1) {
    const y = roof_y + inset
    if (ridge_x) roof_layer_x(painter, spec, y, spec.origin_z - 2 + inset, spec.origin_z + spec.depth + 2 - inset)
    else roof_layer_z(painter, spec, y, spec.origin_x - 2 + inset, spec.origin_x + spec.width + 2 - inset)
  }
}

const balcony_x = (painter: BuildingPainter, spec: BuildingArchitecture, center_x: number, y: number): void => {
  const north = spec.entrance === NORTH
  const z = north ? spec.origin_z - 2 : spec.origin_z + spec.depth + 2
  const rail_z = z + (north ? -1 : 1)
  for (let offset = -4; offset <= 4; offset += 1) {
    for (let depth = -1; depth <= 1; depth += 1) painter.set(center_x + offset, y, z + depth, M.copper)
    if (offset % 2 === 0) painter.set(center_x + offset, y + 1, rail_z, 'temperate_wood')
  }
}

const balcony_z = (painter: BuildingPainter, spec: BuildingArchitecture, center_z: number, y: number): void => {
  const west = spec.entrance === WEST
  const x = west ? spec.origin_x - 2 : spec.origin_x + spec.width + 2
  const rail_x = x + (west ? -1 : 1)
  for (let offset = -4; offset <= 4; offset += 1) {
    for (let depth = -1; depth <= 1; depth += 1) painter.set(x + depth, y, center_z + offset, M.copper)
    if (offset % 2 === 0) painter.set(rail_x, y + 1, center_z + offset, 'temperate_wood')
  }
}

const BALCONY_STYLES: readonly ThebesBuildingStyle[] = Object.freeze(['villa', 'town_hall', 'tower'])
const add_balcony = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  if (spec.floors < 2 || !BALCONY_STYLES.includes(spec.style)) return
  const center_x = spec.origin_x + Math.floor(spec.width / 2)
  const center_z = spec.origin_z + Math.floor(spec.depth / 2)
  const y = spec.datum + 5
  if (spec.entrance === NORTH || spec.entrance === SOUTH) balcony_x(painter, spec, center_x, y)
  else balcony_z(painter, spec, center_z, y)
}

const add_entrance_awning = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  const center_x = spec.origin_x + Math.floor(spec.width / 2)
  const center_z = spec.origin_z + Math.floor(spec.depth / 2)
  const y = spec.datum + 4
  for (let offset = -3; offset <= 3; offset += 1)
    for (let depth = 1; depth <= 3; depth += 1) {
      if (spec.entrance === NORTH) painter.set(center_x + offset, y, spec.origin_z - depth, spec.roof)
      else if (spec.entrance === SOUTH) painter.set(center_x + offset, y, spec.origin_z + spec.depth + depth, spec.roof)
      else if (spec.entrance === WEST) painter.set(spec.origin_x - depth, y, center_z + offset, spec.roof)
      else painter.set(spec.origin_x + spec.width + depth, y, center_z + offset, spec.roof)
    }
}

const add_chimney = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  if (spec.style !== 'house' && spec.style !== 'wood' && spec.style !== 'barracks') return
  const roof_y = spec.datum + spec.floors * 5 + Math.ceil(Math.min(spec.width, spec.depth) / 2) + 2
  const x = spec.origin_x + 3 + (spec.seed % Math.max(1, spec.width - 7))
  const z = spec.origin_z + 3
  for (let y = roof_y - 4; y <= roof_y; y += 1)
    for (let dx = 0; dx <= 1; dx += 1) for (let dz = 0; dz <= 1; dz += 1) painter.set(x + dx, y, z + dz, M.sandstone)
}

export const decorate_thebes_building = (painter: BuildingPainter, spec: BuildingArchitecture): void => {
  add_windows(painter, spec)
  add_vertical_beams(painter, spec)
  if (['house', 'wood', 'villa', 'barracks', 'temple', 'town_hall'].includes(spec.style))
    add_pitched_roof(painter, spec)
  add_balcony(painter, spec)
  add_entrance_awning(painter, spec)
  add_chimney(painter, spec)
}
