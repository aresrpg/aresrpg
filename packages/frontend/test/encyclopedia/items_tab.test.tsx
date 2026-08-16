// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { loot_box_is_random } from '../../src/encyclopedia/loot_box.ts'

describe('encyclopedia consumable rewards', () => {
  test('treats one positive-weight outcome as guaranteed', () =>
    expect(loot_box_is_random([{ weight: 1 }])).toBeFalse())

  test('treats competing outcomes as random', () =>
    expect(loot_box_is_random([{ weight: 100 }, { weight: 1 }])).toBeTrue())

  test('does not call an invalid zero-weight outcome guaranteed', () =>
    expect(loot_box_is_random([{ weight: 0 }])).toBeTrue())
})
