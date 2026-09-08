// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { spectator_changes } from '../../src/modules/fight_identity.ts'

test('leaving clears only the departing spectator subscription once', () => {
  expect(spectator_changes({ b: 'fight' }, { a: 'fight', b: 'fight' }, false)).toEqual([
    { character_id: 'a', fight: null },
  ])
  expect(spectator_changes({ b: 'fight' }, { b: 'fight' }, false)).toEqual([])
})

test('switching sends the new fight without a later unsubscribe cancelling it', () => {
  expect(spectator_changes({ a: 'new' }, { a: 'old' }, false)).toEqual([{ character_id: 'a', fight: 'new' }])
})

test('reconnection restores current watches without restoring departed spectators', () => {
  expect(spectator_changes({ b: 'fight' }, { a: 'old', b: 'fight' }, true)).toEqual([
    { character_id: 'b', fight: 'fight' },
  ])
})
