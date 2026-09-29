// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { MATERIAL_TEXTURE_BLOCK_SPAN } from '../packages/engine/src/material_texture.ts'

// Half-cell masks: every architectural ingredient occupies one integer-aligned unit cell.
const MASKS = Object.freeze({
  block: [0, 1, 2, 3, 4, 5, 6, 7],
  slab: [0, 1, 2, 3],
  stair: [0, 1, 2, 3, 5, 7],
  stair_inner: [0, 1, 2, 3, 5, 6, 7],
  stair_outer: [0, 1, 2, 3, 7],
})

export const piece_cells = ([shape, origin, material, rotation, half]) => {
  if (!Object.hasOwn(MASKS, shape)) throw new TypeError(`Unsupported building piece: ${shape}`)
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isSafeInteger))
    throw new TypeError('Building pieces require integer cell origins')
  if (![0, 1, 2, 3].includes(rotation) || !['bottom', 'top'].includes(half))
    throw new TypeError('Building pieces require quarter turns and bottom/top halves')
  if (![typeof material === 'string', material !== 'air'].every(Boolean))
    throw new TypeError('Building pieces require a solid material')
  return MASKS[shape].map((index) => {
    const x = index & 1,
      z = (index >> 1) & 1,
      y = index >> 2
    const [rx, rz] = [
      [x, z],
      [1 - z, x],
      [1 - x, 1 - z],
      [z, 1 - x],
    ][rotation]
    return [origin[0] * 2 + rx, origin[1] * 2 + (half === 'top' ? 1 - y : y), origin[2] * 2 + rz, material]
  })
}

const FACES = [
  { axis: 0, sign: -1, u: 2, v: 1 },
  { axis: 0, sign: 1, u: 1, v: 2 },
  { axis: 1, sign: -1, u: 0, v: 2 },
  { axis: 1, sign: 1, u: 2, v: 0 },
  { axis: 2, sign: -1, u: 1, v: 0 },
  { axis: 2, sign: 1, u: 0, v: 1 },
]
const key = (point) => point.join(',')

const face_layers = (cells, face) => {
  const layers = new Map()
  for (const [position, material, full] of cells.values()) {
    if (full) continue
    const neighbour = [...position]
    neighbour[face.axis] += face.sign
    if (cells.has(key(neighbour))) continue
    const plane = position[face.axis] + Number(face.sign > 0)
    const identity = `${plane}:${material}`
    const layer = layers.get(identity) ?? { plane, material, tiles: new Set() }
    layer.tiles.add(`${position[face.u]},${position[face.v]}`)
    layers.set(identity, layer)
  }
  return [...layers.values()]
}

const emit_layer = (details, face, { plane, material, tiles }) => {
  const remaining = new Set(tiles)
  const ordered = [...tiles]
    .map((tile) => tile.split(',').map(Number))
    .toSorted(([ax, ay], [bx, by]) => ay - by || ax - bx)
  for (const [u, v] of ordered) {
    const tile = `${u},${v}`
    if (!remaining.has(tile)) continue
    let width = 1
    while (remaining.has(`${u + width},${v}`)) width++
    const row = Array.from({ length: width }, (_, offset) => u + offset)
    let height = 1
    while (row.every((x) => remaining.has(`${x},${v + height}`))) height++
    for (let y = v; y < v + height; y++) row.forEach((x) => remaining.delete(`${x},${y}`))
    const point = (x, y) => {
      const result = [0, 0, 0]
      result[face.axis] = plane / 2
      result[face.u] = x / 2
      result[face.v] = y / 2
      return result
    }
    const corners = [point(u, v), point(u + width, v), point(u + width, v + height), point(u, v + height)]
    const texture_coordinates = corners.map((p) => [
      p[face.axis === 0 ? 1 : 0] / MATERIAL_TEXTURE_BLOCK_SPAN,
      -p[face.axis === 2 ? 1 : 2] / MATERIAL_TEXTURE_BLOCK_SPAN,
    ])
    details.quad(...corners, material, texture_coordinates)
  }
}

/** Strict occupancy and exposed-face merging happen offline. Runtime sees ordinary detail cells. */
export const building_kit = () => {
  const cells = new Map()
  const clearances = []
  const reserve = ({ min, max }, transform, owner) => {
    const corners = [transform(min), transform(max)]
    clearances.push({
      min: min.map((_, axis) => Math.min(...corners.map((point) => point[axis])) * 2),
      max: max.map((_, axis) => Math.max(...corners.map((point) => point[axis])) * 2),
      owner,
    })
  }
  const add = (piece, transform, owner) => {
    for (const [x, y, z, material] of piece_cells(piece)) {
      const transformed = transform([(x + 0.5) / 2, (y + 0.5) / 2, (z + 0.5) / 2]).map((value) => value * 2 - 0.5)
      if (transformed.some((value) => Math.abs(value - Math.round(value)) > 1e-6))
        throw new TypeError(`Building placement leaves the half-block grid: ${owner}`)
      const point = transformed.map(Math.round)
      const identity = key(point)
      if (cells.has(identity)) throw new TypeError(`Overlapping building pieces at ${identity}: ${owner}`)
      cells.set(identity, [point, material, piece[0] === 'block'])
    }
  }
  const finish = (details) => {
    for (const { min, max, owner } of clearances) {
      for (const [point] of cells.values()) {
        if (min.every((value, axis) => point[axis] >= value && point[axis] < max[axis]))
          throw new TypeError(`Blocked assembled clearance: ${owner}`)
      }
    }
    FACES.forEach((face) => face_layers(cells, face).forEach((layer) => emit_layer(details, face, layer)))
    const blocks = new Map()
    for (const [point, material, full] of cells.values()) {
      if (!full) continue
      const position = point.map((value) => Math.floor(value / 2))
      blocks.set(key(position), [...position, material])
    }
    return [...blocks.values()]
  }
  return { add, reserve, finish }
}
