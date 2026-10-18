// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { validate_height_grid } from '../height_grid.ts'

import the_ruins_map_source from './generated/the_ruins_map.json'
import fuwage_map_source from './generated/fuwage_map.json'
import thebes_map_source from './generated/thebes_map.json'
import { compile_the_ruins, THE_RUINS_MATERIAL_NAMES } from './the_ruins/runtime.ts'
import { compile_fuwage, FUWAGE_MATERIAL_NAMES } from './fuwage/runtime.ts'
import { compile_thebes, THEBES_MATERIAL_NAMES, THEBES_LAND_USES } from './thebes/runtime.ts'
import { CITY_ARTIFACT_VERSION, type CityRuntimeDefinition, type GeneratedCityMapArtifact } from './types.ts'

const definition = (
  id: string,
  material_names: readonly string[],
  compile: CityRuntimeDefinition['compile'],
  map: unknown,
  land_uses: Readonly<Record<string, string>>
): CityRuntimeDefinition => {
  const generated_map = map as GeneratedCityMapArtifact
  const errors = validate_height_grid(generated_map.terrain ?? null)
  if (errors.length) throw new TypeError(`Invalid ${id} terrain: ${errors.join('; ')}`)
  return Object.freeze({
    id,
    material_names,
    compile,
    artifact_url: new URL(`./generated/${id}.json`, import.meta.url),
    details_url: new URL(`./generated/${id}_details.json`, import.meta.url),
    map: generated_map,
    land_uses,
  })
}

export const CITY_DEFINITIONS = Object.freeze([
  definition('thebes', THEBES_MATERIAL_NAMES, compile_thebes, thebes_map_source, THEBES_LAND_USES),
  definition('the_ruins', THE_RUINS_MATERIAL_NAMES, compile_the_ruins, the_ruins_map_source, {
    the_ruins_ravine: 'ravine',
    the_ruins_ruin: 'ruins',
    the_ruins_fortress: 'fortress',
    the_ruins_ritual: 'ritual',
  }),
  definition('fuwage', FUWAGE_MATERIAL_NAMES, compile_fuwage, fuwage_map_source, {
    fuwage_plateau: 'plateau',
    fuwage_causeway: 'causeway',
  }),
])

export const city_definition = (id: string): CityRuntimeDefinition | undefined =>
  CITY_DEFINITIONS.find((candidate) => candidate.id === id)

/** Occupancy and decoration share provenance, but each consumer loads only its own artifact. */
export const read_city_artifact = async <T extends Pick<GeneratedCityMapArtifact, 'id' | 'version' | 'source_hash'>>(
  definition: CityRuntimeDefinition,
  url: URL
): Promise<T> => {
  const response = typeof Bun !== 'undefined' ? Bun.file(url) : await fetch(url)
  if ('ok' in response && !response.ok) throw new Error(`Generated city artifact failed to load: ${response.status}`)
  const artifact = (await response.json()) as T
  if (
    artifact.version !== CITY_ARTIFACT_VERSION ||
    artifact.id !== definition.id ||
    artifact.source_hash !== definition.map.source_hash
  )
    throw new TypeError(`Generated ${definition.id} artifacts do not share provenance`)
  return artifact
}
