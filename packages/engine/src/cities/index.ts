// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MaterialUse } from '../world_materials.ts'
import type { StructureAreaSource } from '../structures.ts'

import { city_definition } from './registry.ts'
import type { CityArea, CompiledCity } from './types.ts'

const is_city_area = (area: StructureAreaSource): area is CityArea =>
  Number.isFinite(area.anchor_x) && Number.isFinite(area.anchor_z)

export const city_material_uses = (areas: readonly StructureAreaSource[]): readonly MaterialUse[] =>
  areas.flatMap(({ id }) =>
    (city_definition(id)?.material_names ?? []).map((name) => Object.freeze({ name, role: 'filler' as const }))
  )

export const compile_cities = (areas: readonly StructureAreaSource[]): readonly CompiledCity[] =>
  Object.freeze(
    areas.flatMap((area) => {
      const definition = city_definition(area.id)
      return definition && is_city_area(area) ? [definition.compile(area)] : []
    })
  )
