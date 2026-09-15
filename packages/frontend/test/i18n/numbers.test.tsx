// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { useNumbers } from '../../src/i18n/useNumbers.ts'
import { parse_sui_amount } from '../../src/wallet_amount.ts'

const Numbers = () => {
  const numbers = useNumbers()
  return (
    <span>
      {numbers.amount(1_234_567_890_123n, 4)} / {numbers.compact(20_500)} / {numbers.daily(1_500_000_000n)}
    </span>
  )
}

test('money and compact quantities follow the selected language without changing exact input parsing', () => {
  const english = renderToStaticMarkup(
    <LocaleScope locale="en">
      <Numbers />
    </LocaleScope>
  )
  const german = renderToStaticMarkup(
    <LocaleScope locale="de">
      <Numbers />
    </LocaleScope>
  )
  expect(english).toContain('1,234.5678')
  expect(english).toContain('20.5K')
  expect(english).toContain('1.500')
  expect(german).toContain('1,500')
  expect(german).toContain('1.234,5678')
  expect(parse_sui_amount('1.23456789')).toBe(1_234_567_890n)
})
