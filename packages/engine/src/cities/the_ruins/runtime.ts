// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CityArea, CompiledCity } from '../types.ts'

import { THE_RUINS_MATERIALS } from './materials.ts'

export const THE_RUINS_MATERIAL_NAMES = Object.freeze(Object.values(THE_RUINS_MATERIALS))

const DEFAULT_NATURE = Object.freeze([
  Object.freeze({ kind: 'cobweb' as const, chance_bp: 420 }),
  Object.freeze({ kind: 'mushroom' as const, chance_bp: 520 }),
  Object.freeze({ kind: 'twig' as const, chance_bp: 460 }),
  Object.freeze({ kind: 'pebble' as const, chance_bp: 380 }),
])

export const compile_the_ruins = (area: CityArea): CompiledCity =>
  Object.freeze({
    id: 'the_ruins',
    area,
    nature_at: (land_use) =>
      land_use === 'ravine'
        ? Object.freeze([
            { kind: 'cobweb', chance_bp: 1_300 },
            { kind: 'mushroom', chance_bp: 740 },
            { kind: 'pebble', chance_bp: 680 },
          ])
        : land_use === 'ruins' || land_use === 'fortress' || land_use === 'ritual'
          ? Object.freeze([
              { kind: 'cobweb', chance_bp: 1_900 },
              { kind: 'mushroom', chance_bp: 420 },
              { kind: 'twig', chance_bp: 260 },
            ])
          : DEFAULT_NATURE,
    preserves_structure: (category, land_use) =>
      (category === 'trees' && land_use === null) || (category === 'ruins' && land_use === 'ruins'),
    clear_radius: 96,
  })
