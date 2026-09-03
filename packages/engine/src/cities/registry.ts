// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import the_ruins_map_source from './generated/the_ruins_map.json'
import fuwage_map_source from './generated/fuwage_map.json'
import thebes_map_source from './generated/thebes_map.json'
import { compile_the_ruins, THE_RUINS_MATERIAL_NAMES } from './the_ruins/runtime.ts'
import { compile_fuwage, FUWAGE_MATERIAL_NAMES } from './fuwage/runtime.ts'
import { compile_thebes, THEBES_MATERIAL_NAMES } from './thebes/runtime.ts'
import type { CityRuntimeDefinition, GeneratedCityMapArtifact } from './types.ts'

const definition = (
  id: string,
  material_names: readonly string[],
  compile: CityRuntimeDefinition['compile'],
  map: unknown,
  land_uses: Readonly<Record<string, string>>
): CityRuntimeDefinition =>
  Object.freeze({
    id,
    material_names,
    compile,
    artifact_url: new URL(`./generated/${id}.json`, import.meta.url),
    map: map as GeneratedCityMapArtifact,
    land_uses,
  })

export const CITY_DEFINITIONS = Object.freeze([
  definition('thebes', THEBES_MATERIAL_NAMES, compile_thebes, thebes_map_source, {
    thebes_field: 'field',
    thebes_garden: 'garden',
    thebes_river: 'river',
    thebes_bridge: 'bridge',
  }),
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
