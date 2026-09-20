// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { format_sui } from '../../src/wallet_amount.ts'
import {
  character_creation_failure_message,
  character_creation_funding_text,
  character_creation_insufficient,
} from '../../src/character_creation_funding.ts'

test('character creation retains the full SDK gas reserve after its 1 SUI payment', () => {
  expect(character_creation_insufficient(1_000_000_000n)).toBeTrue()
  expect(character_creation_insufficient(1_049_999_999n)).toBeTrue()
  expect(character_creation_insufficient(1_050_000_000n)).toBeFalse()
  expect(character_creation_insufficient(null)).toBeFalse()
})

test('character funding copy names the actual reserved fee balance', () => {
  expect(character_creation_funding_text('Keep {{fee}} SUI for fees.')).toBe('Keep 0.05 SUI for fees.')
})

test('welcome and creation prompts retain the full fee amount in every locale', async () => {
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    const amount_text = (mist: bigint, digits = 2): string => format_sui(mist, digits, code)
    const expected = new Intl.NumberFormat(code).format(0.05)
    for (const template of [copy.welcome_need_sui, copy.insufficient_sui]) {
      const rendered = character_creation_funding_text(template, amount_text)
      expect(rendered).toContain(expected)
      expect(rendered).not.toContain('{{fee}}')
    }
    expect(character_creation_failure_message(new Error('InsufficientCoinBalance'), copy, code)).toMatchObject({
      message: character_creation_funding_text(copy.insufficient_sui, amount_text),
    })
  }
})

test('a split-coin resolution failure is recognized only at the character creation boundary', () => {
  const other_error = new Error('Transaction resolution failed: MoveAbort')
  expect(
    character_creation_failure_message(
      new Error('Transaction resolution failed: InsufficientCoinBalance in command 1'),
      { insufficient_sui: 'Keep {{fee}} SUI for fees.' }
    )
  ).toMatchObject({ name: 'LocalizedError', message: 'Keep 0.05 SUI for fees.' })
  expect(character_creation_failure_message(other_error, null)).toBe(other_error)
})
