// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import { entity_spec_from_fighter } from './voxel_fight_folds.js'

configure_assets({ aggregator: 'https://assets.test', classes: { character: { published: true } } })

describe('voxel fight appearance', () => {
  test('an unrigged female class uses the world avatar female placeholder and roster colors', () => {
    const colors = [0xc58b6a, 0x375a7f, 0xd6b36a]
    const spec = entity_spec_from_fighter({
      id: '0xfemale',
      is_player: true,
      class_id: 'iyashi',
      sex: 'female',
      male: false,
      colors,
      cell: { x: 4, y: 5 },
      team: 0,
    })

    expect(spec.glb_variant).toMatch(/senshi_female\.glb$/)
    expect(spec.hair_url).toMatch(/senshi_female_hair\.glb$/)
    expect(spec.colors).toEqual(colors)
  })

  test('an unresolved mob keeps its real id label on the built-in capsule without a fake GLB request', () => {
    const spec = entity_spec_from_fighter({
      id: 'mob-0',
      is_player: false,
      variant: '0xreal_mob_template',
      name: '0xreal_mob_template',
      identity_resolved: false,
      cell: { x: 4, y: 5 },
      team: 1,
    })

    expect(spec.glb_variant).toBeUndefined()
  })
})
