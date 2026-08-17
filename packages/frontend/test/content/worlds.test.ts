// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { world_terrain, worlds_source } from '../../src/content/worlds.ts'

describe('world terrain projection', () => {
  test('resolves a named world exactly and never borrows another world recipe', () => {
    expect(world_terrain('01_first_shore')).toBe(worlds_source[0]!.terrain)
    expect(world_terrain('02_verdant_hollow')).toBeNull()
    expect(world_terrain('unknown_world')).toBeNull()
  })

  test('uses the first authored terrain only when no world is selected', () => {
    expect(world_terrain(null)).toBe(worlds_source[0]!.terrain)
  })
})
