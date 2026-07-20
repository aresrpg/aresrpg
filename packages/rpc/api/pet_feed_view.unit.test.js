// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { pet_projection_fields } from './views.js'

describe('pet-feed row enrichment', () => {
  test('an unprojected pet is authoritatively never fed and available now', () => {
    expect(pet_projection_fields('pet', null, '0xpet')).toEqual({
      feed_count: 0,
      next_feed_at_ms: 0,
    })
  })

  test('a fed pet passes through its absolute projected cadence state', () => {
    expect(
      pet_projection_fields('pet', {
        pet: '0xpet',
        feed_count: 7,
        next_feed_at_ms: 1_700_064_000_000,
      })
    ).toEqual({ feed_count: 7, next_feed_at_ms: 1_700_064_000_000 })
  })

  test('resource food eligibility is exact allowlist membership', () => {
    const allowed = new Set(['0xapple'])
    expect(pet_projection_fields('resource', null, '0xapple', allowed)).toEqual({ pet_feed_allowed: true })
    expect(pet_projection_fields('resource', null, '0xstone', allowed)).toEqual({ pet_feed_allowed: false })
  })
})
