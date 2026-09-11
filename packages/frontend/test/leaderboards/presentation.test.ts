// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { display_suins_name } from '../../src/leaderboards/presentation.ts'

test('a self-subname displays as its root handle without changing other names', () => {
  expect(display_suins_name('sceat.sceat.sui')).toBe('@sceat')
  expect(display_suins_name('sceat@sceat')).toBe('@sceat')
  expect(display_suins_name('player-one.player-one.sui')).toBe('@player-one')
  expect(display_suins_name('other.sceat.sui')).toBe('other.sceat.sui')
  expect(display_suins_name('other@sceat')).toBe('other@sceat')
  expect(display_suins_name('sceat.sui')).toBe('sceat.sui')
  expect(display_suins_name('deep.sceat.sceat.sui')).toBe('deep.sceat.sceat.sui')
})
