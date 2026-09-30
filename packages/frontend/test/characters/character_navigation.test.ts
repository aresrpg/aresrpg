// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { character_detail_path, character_detail_tab } from '../../src/characters/character_navigation.ts'

test('character detail tabs have stable deep links for level-up allocation', () => {
  expect(character_detail_tab('/characters/stats')).toBe('stats')
  expect(character_detail_tab('/characters/nope')).toBe('equipment')
  expect(character_detail_path('stats')).toBe('/characters/stats')
})
