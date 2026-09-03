// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Deterministic simple-tiled Wave Function Collapse, based on Maxim Gumin's MIT-licensed model.
// The city compiler owns the tiles and constraints; this file only propagates matching sockets.

import { hash_position } from '../world_noise.ts'

export const WFC_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: -1, dy: 0, dz: 0, opposite: 1 }),
  Object.freeze({ dx: 1, dy: 0, dz: 0, opposite: 0 }),
  Object.freeze({ dx: 0, dy: -1, dz: 0, opposite: 3 }),
  Object.freeze({ dx: 0, dy: 1, dz: 0, opposite: 2 }),
  Object.freeze({ dx: 0, dy: 0, dz: -1, opposite: 5 }),
  Object.freeze({ dx: 0, dy: 0, dz: 1, opposite: 4 }),
] as const)

export type WfcDirection = 0 | 1 | 2 | 3 | 4 | 5
export type WfcTile = Readonly<{
  id: string
  weight: number
  sockets: readonly [number, number, number, number, number, number]
}>
export type WfcSize = readonly [width: number, height: number, depth: number]
export type WfcConstraint = Readonly<{ index: number; allowed: readonly string[] }>
export type WfcModel = Readonly<{
  seed: number
  size: WfcSize
  tiles: readonly WfcTile[]
  constraints?: readonly WfcConstraint[]
  attempts?: number
}>

const coordinates = (index: number, [width, , depth]: WfcSize): readonly [number, number, number] => {
  const layer = width * depth
  const y = Math.floor(index / layer)
  const within = index - y * layer
  return [within % width, y, Math.floor(within / width)]
}

const cell_index = (x: number, y: number, z: number, [width, , depth]: WfcSize): number =>
  y * width * depth + z * width + x

const inside = (x: number, y: number, z: number, [width, height, depth]: WfcSize): boolean =>
  x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth

const tile_bit = (index: number): number => 2 ** index
const has_bit = (mask: number, index: number): boolean => (mask & tile_bit(index)) !== 0
const bit_count = (mask: number): number => {
  let remaining = mask >>> 0
  let count = 0
  while (remaining !== 0) {
    remaining &= remaining - 1
    count += 1
  }
  return count
}

const compatible_masks = (tiles: readonly WfcTile[]): readonly (readonly number[])[] =>
  Object.freeze(
    WFC_DIRECTIONS.map(({ opposite }, direction) =>
      Object.freeze(
        tiles.map((tile) =>
          tiles.reduce(
            (mask, neighbour, neighbour_index) =>
              neighbour.sockets[opposite] === tile.sockets[direction] ? mask | tile_bit(neighbour_index) : mask,
            0
          )
        )
      )
    )
  )

const neighbour_mask = (mask: number, compatibility: readonly number[]): number =>
  compatibility.reduce(
    (allowed, compatible, tile_index) => (has_bit(mask, tile_index) ? allowed | compatible : allowed),
    0
  )

const constraint_mask = (tiles: readonly WfcTile[], allowed: readonly string[]): number =>
  tiles.reduce((mask, { id }, index) => (allowed.includes(id) ? mask | tile_bit(index) : mask), 0)

const boundary_mask = (tiles: readonly WfcTile[], direction: WfcDirection): number =>
  tiles.reduce((mask, tile, index) => (tile.sockets[direction] === 0 ? mask | tile_bit(index) : mask), 0)

const cell_boundary_mask = (model: WfcModel, index: number, full_mask: number): number => {
  const [x, y, z] = coordinates(index, model.size)
  return WFC_DIRECTIONS.reduce((mask, { dx, dy, dz }, direction) => {
    if (inside(x + dx, y + dy, z + dz, model.size)) return mask
    return mask & boundary_mask(model.tiles, direction as WfcDirection)
  }, full_mask)
}

const apply_constraints = (
  wave: Uint32Array,
  tiles: readonly WfcTile[],
  constraints: readonly WfcConstraint[]
): boolean =>
  constraints.every(({ index, allowed }) => {
    if (index < 0 || index >= wave.length) return false
    wave[index]! &= constraint_mask(tiles, allowed)
    return wave[index] !== 0
  })

const initial_wave = (model: WfcModel): Uint32Array | null => {
  const [width, height, depth] = model.size
  const full_mask = 2 ** model.tiles.length - 1
  const wave = new Uint32Array(width * height * depth).fill(full_mask)
  wave.forEach((_, index) => {
    wave[index] = cell_boundary_mask(model, index, full_mask)
  })
  return wave.includes(0) || !apply_constraints(wave, model.tiles, model.constraints ?? []) ? null : wave
}

const restrict_neighbour = (
  wave: Uint32Array,
  size: WfcSize,
  compatibility: readonly (readonly number[])[],
  queue: number[],
  index: number,
  direction: number
): -1 | 0 | 1 => {
  const [x, y, z] = coordinates(index, size)
  const { dx, dy, dz } = WFC_DIRECTIONS[direction]!
  const neighbour_x = x + dx
  const neighbour_y = y + dy
  const neighbour_z = z + dz
  if (!inside(neighbour_x, neighbour_y, neighbour_z, size)) return 0
  const neighbour = cell_index(neighbour_x, neighbour_y, neighbour_z, size)
  const next = wave[neighbour]! & neighbour_mask(wave[index]!, compatibility[direction]!)
  if (next === wave[neighbour]) return 0
  if (next === 0) return -1
  wave[neighbour] = next
  queue.push(neighbour)
  return 1
}

const propagate = (
  wave: Uint32Array,
  size: WfcSize,
  compatibility: readonly (readonly number[])[],
  initial: readonly number[]
): boolean => {
  const queue = [...initial]
  while (queue.length > 0) {
    const index = queue.pop()!
    for (let direction = 0; direction < WFC_DIRECTIONS.length; direction += 1)
      if (restrict_neighbour(wave, size, compatibility, queue, index, direction) < 0) return false
  }
  return true
}

const pick_cell = (wave: Uint32Array, seed: number, step: number): number => {
  let selected = -1
  let possibilities = Number.POSITIVE_INFINITY
  let tie = Number.POSITIVE_INFINITY
  wave.forEach((mask, index) => {
    const count = bit_count(mask)
    if (count <= 1) return
    const candidate_tie = hash_position(seed, 'wfc-cell', index, step, 0x9e3779b9)
    if (count < possibilities || (count === possibilities && candidate_tie < tie)) {
      selected = index
      possibilities = count
      tie = candidate_tie
    }
  })
  return selected
}

const pick_tile = (mask: number, tiles: readonly WfcTile[], seed: number, cell: number, step: number): number => {
  const total = tiles.reduce((sum, tile, index) => (has_bit(mask, index) ? sum + tile.weight : sum), 0)
  let roll = (hash_position(seed, 'wfc-tile', cell, step, 0x85ebca6b) / 0x1_0000_0000) * total
  for (const [index, tile] of tiles.entries())
    if (has_bit(mask, index)) {
      roll -= tile.weight
      if (roll <= 0) return tile_bit(index)
    }
  return tile_bit(tiles.findIndex((_, index) => has_bit(mask, index)))
}

const collapse = (model: WfcModel, seed: number): readonly string[] | null => {
  const wave = initial_wave(model)
  if (!wave) return null
  const compatibility = compatible_masks(model.tiles)
  if (
    !propagate(
      wave,
      model.size,
      compatibility,
      Array.from(wave, (_, index) => index)
    )
  )
    return null
  for (let step = 0; step < wave.length; step += 1) {
    const cell = pick_cell(wave, seed, step)
    if (cell < 0)
      return Object.freeze(
        [...wave].map((mask) => model.tiles.find(({ id }, index) => has_bit(mask, index) && id)?.id ?? '')
      )
    wave[cell] = pick_tile(wave[cell]!, model.tiles, seed, cell, step)
    if (!propagate(wave, model.size, compatibility, [cell])) return null
  }
  return null
}

export const solve_tiled_wfc = (model: WfcModel): readonly string[] | null => {
  if (model.tiles.length === 0 || model.tiles.length > 31) return null
  for (let attempt = 0; attempt < (model.attempts ?? 8); attempt += 1) {
    const solved = collapse(model, hash_position(model.seed, 'wfc-attempt', attempt, model.tiles.length, 0xc2b2ae35))
    if (solved) return solved
  }
  return null
}

export const wfc_cell_index = cell_index
