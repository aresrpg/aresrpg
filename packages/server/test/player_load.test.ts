// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { account_snapshot_warning } from '../src/modules/player_load.ts'

test('account snapshot warnings detect extra kiosks without making them illegal', () => {
  expect(account_snapshot_warning(1, 21)).toBeNull()
  expect(account_snapshot_warning(2, 22)).toBe('multiple_kiosks')
})

test('account snapshot warnings detect unusually large payloads', () => {
  expect(account_snapshot_warning(1, 2_000)).toBe('large_snapshot')
  expect(account_snapshot_warning(3, 2_003)).toBe('multiple_kiosks_and_large_snapshot')
})
