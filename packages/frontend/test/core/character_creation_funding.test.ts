// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  character_creation_failure_message,
  character_creation_funding_text,
  character_creation_insufficient,
} from '../../src/character_creation_funding.ts'

test('character creation retains the full SDK gas reserve after its 1 SUI payment', () => {
  expect(character_creation_insufficient(1_110_000_000n)).toBeTrue()
  expect(character_creation_insufficient(1_199_999_999n)).toBeTrue()
  expect(character_creation_insufficient(1_200_000_000n)).toBeFalse()
  expect(character_creation_insufficient(null)).toBeFalse()
})

test('character funding copy names the actual reserved fee balance', () => {
  expect(character_creation_funding_text('Keep {{fee}} SUI for fees.')).toBe('Keep 0.2 SUI for fees.')
})

test('a split-coin resolution failure is recognized only at the character creation boundary', () => {
  const other_error = new Error('Transaction resolution failed: MoveAbort')
  expect(
    character_creation_failure_message(
      new Error('Transaction resolution failed: InsufficientCoinBalance in command 1'),
      { insufficient_sui: 'Keep {{fee}} SUI for fees.' }
    )
  ).toBe('Keep 0.2 SUI for fees.')
  expect(character_creation_failure_message(other_error, null)).toBe(other_error)
})
