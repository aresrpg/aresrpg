// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { same_fight_turn } from '../../src/modules/fight_lifecycle.ts'

test('a queue pointer change is a new turn even inside the same chain millisecond', () => {
  const current = { round: 1n, turn_ptr: 0n, turn_started_ms: 10_000n }
  expect(same_fight_turn(current, { ...current })).toBeTrue()
  expect(same_fight_turn(current, { ...current, turn_ptr: 1n })).toBeFalse()
})
