// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { piece_cells } from './building_kit.mjs'
import { module_transform } from './module_transform.mjs'

const FACES = Object.freeze({
  'x-': [-1, 0, 0],
  'x+': [1, 0, 0],
  'y-': [0, -1, 0],
  'y+': [0, 1, 0],
  'z-': [0, 0, -1],
  'z+': [0, 0, 1],
})
const equal = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-6)
const vector = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
export const validate_module = (asset) => {
  const { size, ports } = asset.module
  if (!vector(size) || !size.every((value) => Number.isInteger(value) && value > 0))
    throw new TypeError('Module size must be positive integer cells')
  if (new Set(ports.map(({ name }) => name)).size !== ports.length)
    throw new TypeError('Module port names must be unique')
  for (const port of ports) validate_port(port, size)
  const cells = asset.pieces.flatMap(piece_cells)
  const occupied = new Set(cells.map((cell) => cell.slice(0, 3).join(',')))
  ports.filter((port) => port.sealed).forEach((port) => validate_seal(port, size, occupied))
  validate_clearances(asset.module.clearances ?? [], cells)
  for (const piece of asset.pieces)
    if (piece_cells(piece).some((cell) => cell.slice(0, 3).some((value, axis) => value < 0 || value >= size[axis] * 2)))
      throw new TypeError('Module geometry leaves its declared cell volume')
}

const validate_clearances = (clearances, cells) => {
  for (const { min, max } of clearances) {
    if (!vector(min) || !vector(max) || min.some((value, axis) => value >= max[axis]))
      throw new TypeError('Invalid module clearance')
    if (![...min, ...max].every((value) => Number.isInteger(value * 2)))
      throw new TypeError('Module clearances require half-cell alignment')
    if (cells.some((cell) => min.every((value, axis) => cell[axis] >= value * 2 && cell[axis] < max[axis] * 2)))
      throw new TypeError('Blocked module clearance')
  }
}

const validate_seal = ({ position, span, face }, size, occupied) => {
  const normal = FACES[face]
  const axis = normal.findIndex((value) => value !== 0)
  const [u, v] = [0, 1, 2].filter((i) => i !== axis)
  const start = position.map((value, i) => 2 * value - span[i])
  const end = position.map((value, i) => 2 * value + span[i])
  if (![...start, ...end].every(Number.isInteger)) throw new TypeError('Sealed boundaries require half-cell alignment')
  for (let a = start[u]; a < end[u]; a++) {
    for (let b = start[v]; b < end[v]; b++) {
      const cell = [0, 0, 0]
      cell[axis] = normal[axis] < 0 ? 0 : size[axis] * 2 - 1
      cell[u] = a
      cell[v] = b
      if (!occupied.has(cell.join(','))) throw new TypeError('Unsealed module boundary')
    }
  }
}

const validate_port = ({ name, position, span, face, profile }, size) => {
  if (
    ![
      typeof name === 'string',
      typeof profile === 'string',
      Object.hasOwn(FACES, face),
      vector(position),
      vector(span),
    ].every(Boolean)
  )
    throw new TypeError('Invalid module port')
  const normal = FACES[face]
  const axis = normal.findIndex((value) => value !== 0)
  if (span[axis] !== 0 || position[axis] !== (normal[axis] < 0 ? 0 : size[axis]))
    throw new TypeError('Port must lie on its declared boundary face')
  const tangents = [0, 1, 2].filter((i) => i !== axis)
  if (tangents.some((i) => span[i] <= 0 || position[i] - span[i] / 2 < 0 || position[i] + span[i] / 2 > size[i]))
    throw new TypeError('Port opening leaves the module boundary')
}

const world_port = (assets, parts, [index, name]) => {
  const part = parts[index]
  if (!part) throw new TypeError('Connection references an absent placement')
  const asset = assets[part.asset]
  if (!asset?.module) throw new TypeError('Connection references a non-module asset')
  const port = asset.module.ports.find((candidate) => candidate.name === name)
  if (!port) throw new TypeError('Connection references an absent port')
  const placement = module_transform(part)
  return {
    ...port,
    position: placement.point(port.position),
    normal: placement.direction(FACES[port.face]),
    span: placement.direction(port.span).map(Math.abs),
  }
}

/** The placement plan owns links. Solvers may choose placements; they cannot reinterpret their geometry. */
export const validate_connections = (assets, { parts, connections }) => {
  const used = new Set()
  for (const [from, to] of connections) {
    const a = world_port(assets, parts, from),
      b = world_port(assets, parts, to)
    if (
      ![
        a.profile === b.profile,
        equal(a.position, b.position),
        equal(a.span, b.span),
        equal(
          a.normal,
          b.normal.map((value) => -value)
        ),
      ].every(Boolean)
    )
      throw new TypeError('Module ports do not match in position, orientation, profile and opening')
    for (const endpoint of [from, to]) {
      const key = endpoint.join(':')
      if (used.has(key)) throw new TypeError('A module port cannot connect twice')
      used.add(key)
    }
  }
}
