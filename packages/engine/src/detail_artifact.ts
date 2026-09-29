// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CHUNK_EDGE } from './voxel_data.ts'

/** Baked, non-colliding architectural surfaces. Solid volumes remain voxel structures. */
export type DetailCell = Readonly<{
  origin: readonly [number, number, number]
  palette: readonly string[]
  vertices: string
}>
export const DETAIL_STRIDE = 9 // position.xyz, normal.xyz, uv.xy, local material index
export const DETAIL_LIMITS = Object.freeze({ cells: 512, triangles: 100_000, extent: CHUNK_EDGE })

// A city archive spans many independently resident columns; this is not a GPU allocation budget.
export const CITY_DETAIL_LIMITS = Object.freeze({ cells: 4096, triangles: 500_000 })

export const decode_detail_vertices = (encoded: string): Float32Array => {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  if (bytes.length % (DETAIL_STRIDE * 3 * 4) !== 0) throw new TypeError('Detail data must contain whole triangles')
  const view = new DataView(bytes.buffer)
  return Float32Array.from({ length: bytes.length / 4 }, (_, index) => view.getFloat32(index * 4, true))
}

const valid_vertices = (values: Float32Array, palette_size: number): boolean => {
  for (let index = 0; index < values.length; index += DETAIL_STRIDE) {
    const row = values.subarray(index, index + DETAIL_STRIDE)
    const length = Math.hypot(row[3]!, row[4]!, row[5]!)
    if (!row.every(Number.isFinite)) return false
    if (row.subarray(0, 3).some((value) => value < -0.001 || value > DETAIL_LIMITS.extent + 0.001)) return false
    if (Math.abs(length - 1) > 0.01) return false
    if (!Number.isInteger(row[8]) || row[8]! < 0 || row[8]! >= palette_size) return false
  }
  return true
}

const validate_cell = (value: unknown, names: ReadonlySet<string>, remaining: number): number => {
  if (!value || typeof value !== 'object') throw new TypeError('Detail cell must be an object')
  const row = value as DetailCell
  if (
    !Array.isArray(row.origin) ||
    row.origin.length !== 3 ||
    !row.origin.every((value) => Number.isSafeInteger(value) && value % CHUNK_EDGE === 0 && Math.abs(value) <= 20_000)
  )
    throw new TypeError('Detail origin must be a bounded chunk origin')
  if (!Array.isArray(row.palette) || row.palette.length === 0 || !row.palette.every((name) => names.has(name)))
    throw new TypeError('Detail palette must reference world materials')
  if (typeof row.vertices !== 'string' || row.vertices.length > remaining * DETAIL_STRIDE * 16)
    throw new TypeError('Detail data exceeds geometry budget')
  const vertices = decode_detail_vertices(row.vertices)
  if (!valid_vertices(vertices, row.palette.length)) throw new TypeError('Invalid detail vertex or normal')
  return vertices.length / (DETAIL_STRIDE * 3)
}

export const validate_details = (
  value: unknown,
  materials: unknown,
  limits: Readonly<{ cells: number; triangles: number }> = DETAIL_LIMITS
): readonly string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > limits.cells) return ['details exceeds cell budget']
  const names = new Set(Object.keys(materials instanceof Object ? materials : {}))
  try {
    value.reduce((sum: number, row: unknown) => sum + validate_cell(row, names, limits.triangles - sum), 0)
    if (new Set(value.map((row: DetailCell) => row.origin.join(','))).size !== value.length)
      return ['details contains duplicate cells']
    return []
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- The caught decode failure becomes recipe validation errors, never successful geometry.
  } catch (error) {
    return [`details: ${error instanceof Error ? error.message : String(error)}`]
  }
}
