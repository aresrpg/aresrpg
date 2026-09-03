// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CityArea, CompiledCity } from '../types.ts'

import { THEBES_MATERIALS } from './materials.ts'

export const THEBES_MATERIAL_NAMES = Object.freeze([
  ...Object.values(THEBES_MATERIALS),
  'temperate_wood',
  'temperate_foliage',
])

const DEFAULT_NATURE = Object.freeze([
  Object.freeze({ kind: 'city_shrub' as const, chance_bp: 120 }),
  Object.freeze({ kind: 'dry_reed' as const, chance_bp: 420 }),
  Object.freeze({ kind: 'pebble' as const, chance_bp: 280 }),
])

export const compile_thebes = (area: CityArea): CompiledCity =>
  Object.freeze({
    id: 'thebes',
    area,
    nature_at: (land_use) => {
      if (land_use === 'field') return Object.freeze([{ kind: 'field_crop', chance_bp: 6_800 }])
      if (land_use === 'garden')
        return Object.freeze([
          { kind: 'flower', chance_bp: 420 },
          { kind: 'city_shrub', chance_bp: 1_100 },
          { kind: 'pebble', chance_bp: 120 },
        ])
      if (land_use === 'river' || land_use === 'bridge') return Object.freeze([{ kind: 'dry_reed', chance_bp: 900 }])
      return DEFAULT_NATURE
    },
    preserves_structure: (category, land_use) => category === 'trees' && land_use === 'garden',
    clear_radius: 144,
  })
