// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CITY_DETAIL_LIMITS, validate_detail_metadata, type DetailCell } from '../detail_artifact.ts'
import { CHUNK_EDGE } from '../voxel_data.ts'

import { city_definition, read_city_artifact } from './registry.ts'
import type { CompiledCity, GeneratedCityDetails } from './types.ts'

const loading = new Map<string, Promise<ReadonlyMap<string, readonly DetailCell[]>>>()
const column_key = (x: number, z: number): string => `${x},${z}`

const load_details = (id: string): Promise<ReadonlyMap<string, readonly DetailCell[]>> => {
  const pending = loading.get(id)
  if (pending) return pending
  const definition = city_definition(id)!
  const next = read_city_artifact<GeneratedCityDetails>(definition, definition.details_url)
    .then(({ details }) => {
      if (!Array.isArray(details)) throw new TypeError(`Generated ${id} is missing baked details`)
      const materials = Object.fromEntries(definition.material_names.map((name) => [name, {}]))
      const errors = validate_detail_metadata(details, materials, CITY_DETAIL_LIMITS)
      if (errors.length) throw new TypeError(`Generated ${id}: ${errors.join('; ')}`)
      return details.reduce((columns, cell) => {
        const key = column_key(cell.origin[0], cell.origin[2])
        columns.set(key, [...(columns.get(key) ?? []), cell])
        return columns
      }, new Map<string, readonly DetailCell[]>())
    })
    .catch((error: unknown) => {
      loading.delete(id)
      throw error
    })
  loading.set(id, next)
  return next
}

/** Main-thread presentation only; workers and collision never retain decorative vertices. */
export const load_city_details = async (
  cities: readonly CompiledCity[],
  x: number,
  z: number
): Promise<readonly DetailCell[]> => {
  const requested = cities.filter(
    ({ area }) => x <= area.max_x && x + CHUNK_EDGE > area.min_x && z <= area.max_z && z + CHUNK_EDGE > area.min_z
  )
  const columns = await Promise.all(
    requested.map(async ({ id }) => (await load_details(id)).get(column_key(x, z)) ?? [])
  )
  return columns.flat()
}
