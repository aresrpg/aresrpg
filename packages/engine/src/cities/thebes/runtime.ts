// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CityArea, CompiledCity } from '../types.ts'

import { THEBES_MATERIALS } from './materials.ts'

export const THEBES_MATERIAL_NAMES = Object.freeze([
  ...Object.values(THEBES_MATERIALS),
  'thebes_carved_stone',
  'thebes_oak',
  'thebes_window',
  'temperate_wood',
  'temperate_foliage',
  'dirt',
  'rich_soil',
  'sand',
  'grass',
])

export const THEBES_LAND_USES = Object.freeze({
  thebes_temple: 'street',
  thebes_castle: 'street',
  thebes_farmstead: 'street',
  thebes_street: 'street',
  thebes_urban: 'street',
  thebes_field: 'field',
  thebes_garden: 'garden',
  thebes_grove: 'grove',
  thebes_river: 'river',
  thebes_bridge: 'bridge',
  thebes_road: 'street',
  thebes_wall: 'street',
  thebes_gate: 'street',
  thebes_dungeon_plaza: 'street',
})

const DEFAULT_NATURE = Object.freeze([
  Object.freeze({ kind: 'city_shrub' as const, chance_bp: 120 }),
  Object.freeze({ kind: 'dry_reed' as const, chance_bp: 180 }),
  Object.freeze({ kind: 'flower' as const, chance_bp: 170 }),
  Object.freeze({ kind: 'twig' as const, chance_bp: 90 }),
  Object.freeze({ kind: 'pebble' as const, chance_bp: 280 }),
])

export const compile_thebes = (area: CityArea): CompiledCity =>
  Object.freeze({
    id: 'thebes',
    area,
    nature_at: (land_use) => {
      if (land_use === 'street') return Object.freeze([])
      if (land_use === 'grove')
        return Object.freeze([
          { kind: 'mushroom', chance_bp: 180 },
          { kind: 'tuft', chance_bp: 500 },
          { kind: 'city_shrub', chance_bp: 130 },
        ])
      if (land_use === 'field') return Object.freeze([{ kind: 'field_crop', chance_bp: 6_800 }])
      if (land_use === 'garden')
        return Object.freeze([
          { kind: 'flower', chance_bp: 650 },
          { kind: 'mushroom', chance_bp: 160 },
          { kind: 'tuft', chance_bp: 400 },
          { kind: 'city_shrub', chance_bp: 1_100 },
          { kind: 'pebble', chance_bp: 120 },
        ])
      if (land_use === 'river' || land_use === 'bridge') return Object.freeze([{ kind: 'dry_reed', chance_bp: 900 }])
      return DEFAULT_NATURE
    },
    preserves_structure: () => false,
    clear_radius: 144,
  })
