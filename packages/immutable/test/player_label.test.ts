// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { display_suins_name } from '../src/player_label.ts'

test.each([
  ['login905.sui', '@login905'],
  ['player-one.sui', '@player-one'],
  ['Login905.SUI', '@Login905'],
  ['dhuts.dhuts.sui', '@dhuts'],
  ['dhuts@dhuts', '@dhuts'],
  ['player-one.player-one.sui', '@player-one'],
  ['Dhuts.dhuts.sui', '@Dhuts'],
])('formats %s as %s without changing the stored identity', (name, label) => {
  expect(display_suins_name(name)).toBe(label)
  expect(display_suins_name(label)).toBe(label)
})

test.each([
  'other.sceat.sui',
  'other@sceat',
  'deep.sceat.sceat.sui',
  '@login905',
  'login905',
  '',
  '.sui',
  'login905.sui.extra',
  ' login905.sui',
])('preserves names outside the root and self-subname display forms: %s', (name) => {
  expect(display_suins_name(name)).toBe(name)
})
