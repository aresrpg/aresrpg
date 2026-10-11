// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import items from '../../../../seed/content/items.json'
import profiles from '../../../../seed/content/pet_wings.json'
import { WING_SHAPES, WING_TRAILS } from '../../../engine/src/pet_wing_style.ts'
import { pet_wing_style } from '../../src/content/pet_wings.ts'

test('every pet has one complete, bounded wing profile in seed', () => {
  expect(Object.keys(profiles).sort()).toEqual(
    items
      .filter(({ category }) => category === 'pet')
      .map(({ item_type }) => item_type)
      .sort()
  )
  for (const [id, profile] of Object.entries(profiles)) {
    expect(WING_SHAPES as readonly string[]).toContain(profile.shape)
    expect(WING_TRAILS as readonly string[]).toContain(profile.trail)
    expect(profile.scale).toBeGreaterThan(0)
    expect(profile.scale).toBeLessThanOrEqual(2)
    expect(profile.variant).toBeGreaterThanOrEqual(0)
    expect(profile.variant).toBeLessThanOrEqual(1)
    for (const color of [profile.primary, profile.secondary, profile.shade]) {
      expect(color).toHaveLength(3)
      expect(color.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    }
    expect(pet_wing_style(id) as unknown).toEqual(profile)
  }
  expect(pet_wing_style('not_a_pet')).toBeUndefined()
})
