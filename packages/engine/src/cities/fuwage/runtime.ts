// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CityArea, CompiledCity } from '../types.ts'

import { FUWAGE_MATERIALS } from './materials.ts'

export const FUWAGE_MATERIAL_NAMES = Object.freeze(Object.values(FUWAGE_MATERIALS))

const DEFAULT_NATURE = Object.freeze([
  Object.freeze({ kind: 'tuft' as const, chance_bp: 420 }),
  Object.freeze({ kind: 'pebble' as const, chance_bp: 540 }),
])

export const compile_fuwage = (area: CityArea): CompiledCity =>
  Object.freeze({
    id: 'fuwage',
    area,
    nature_at: (land_use) =>
      land_use === 'plateau' ? Object.freeze([{ kind: 'pebble', chance_bp: 180 }]) : DEFAULT_NATURE,
    preserves_structure: () => false,
    clear_radius: 112,
  })
