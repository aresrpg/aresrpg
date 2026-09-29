// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CityStructureSource } from './cities/city_structure.ts'
import { STRUCTURE_TYPES } from './structures.ts'
import type { MaterialUse } from './world_materials.ts'

/** Explicit placements use the same compiled voxels as procedural structures and cities. */
export type FixedStructure = Readonly<{
  source: string | CityStructureSource
  origin: readonly [number, number, number]
  rotation: 0 | 1 | 2 | 3
  scale?: number
}>

const material_names = (source: FixedStructure['source']): readonly string[] =>
  typeof source === 'string' ? (STRUCTURE_TYPES[source]?.palette ?? []) : source.blocks.map((block) => block[3])

export const fixed_structure_materials = (rows: readonly FixedStructure[] = []): readonly MaterialUse[] =>
  [...new Set(rows.flatMap(({ source }) => material_names(source)))]
    .filter((name) => name !== 'air')
    .map((name) => ({ name, role: 'filler' as const }))

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' ? (value as Readonly<Record<string, unknown>>) : {}
const tuple = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger)

const valid_source = (value: unknown): value is FixedStructure['source'] => {
  if (typeof value === 'string') return STRUCTURE_TYPES[value] !== undefined
  const source = record(value)
  if (!tuple(source.size) || !tuple(source.anchor) || !Array.isArray(source.blocks)) return false
  return (
    source.size.every((size) => size > 0 && size <= 255) &&
    typeof source.name === 'string' &&
    source.blocks.every(
      (block: unknown) =>
        Array.isArray(block) &&
        block.length === 4 &&
        block.slice(0, 3).every(Number.isSafeInteger) &&
        typeof block[3] === 'string'
    )
  )
}

const validate_placement = (value: unknown, index: number, materials: unknown): readonly string[] => {
  const row = record(value)
  const prefix = `fixed_structures[${index}]`
  const errors = [
    [tuple(row.origin), `${prefix}.origin must contain three integer coordinates`],
    [
      [0, 1, 2, 3].includes(Number(row.rotation)) && typeof row.rotation === 'number',
      `${prefix}.rotation must be 0..3`,
    ],
    [
      row.scale === undefined || (Number.isSafeInteger(row.scale) && Number(row.scale) >= 1 && Number(row.scale) <= 5),
      `${prefix}.scale must be an integer in 1..5`,
    ],
    [valid_source(row.source), `${prefix}.source must be an existing structure or valid voxel source`],
  ].flatMap(([valid, message]) => (valid ? [] : [String(message)]))
  if (!valid_source(row.source)) return errors
  const available = record(materials)
  return [
    ...errors,
    ...material_names(row.source)
      .filter((name) => name !== 'air' && !(name in available))
      .map((name) => `${prefix} references missing material ${name}`),
  ]
}

export const validate_fixed_structures = (value: unknown, materials: unknown): readonly string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) return ['fixed_structures must be an array']
  return [...new Set(value.flatMap((row: unknown, index) => validate_placement(row, index, materials)))]
}
