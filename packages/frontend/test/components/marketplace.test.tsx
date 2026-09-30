// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MarketplaceDisclaimer } from '../../src/marketplace/MarketplaceDisclaimer.tsx'
import { MarketVolumeBadge } from '../../src/marketplace/marketplace_model.tsx'

test('rolling volume distinguishes an unavailable total from a confirmed zero', () => {
  const text = (key: string) => key
  const unknown = renderToStaticMarkup(<MarketVolumeBadge window="24h" mist={null} text={text} />)
  const zero = renderToStaticMarkup(<MarketVolumeBadge window="30d" mist="0" text={text} />)
  const traded = renderToStaticMarkup(<MarketVolumeBadge window="30d" mist="123450000000" text={text} />)
  expect(unknown).toContain('—')
  expect(zero).toContain('0.00')
  expect(traded).toContain('123.45')
  expect(traded).toContain('data-sui-logo')
})

test('the first marketplace visit explains item supply and wallet custody before trading', () => {
  const values: Readonly<Record<string, string>> = Object.freeze({
    disclaimer_kicker: 'Before you trade',
    disclaimer_title: 'Trade for progression, not profit',
    disclaimer_body: 'Items are traded directly between players for SUI.',
    disclaimer_supply: 'Farming increases supply and can dilute prices.',
    disclaimer_fun: 'Trade alongside your progression for fun.',
    disclaimer_wallet: 'Keep savings in a wallet whose recovery keys you control.',
    disclaimer_acknowledge: 'I understand',
  })
  const html = renderToStaticMarkup(
    <MarketplaceDisclaimer acknowledge={() => undefined} text={(key) => values[key] ?? key} />
  )

  expect(html).toContain('data-marketplace-disclaimer=""')
  expect(html).toContain('Trade for progression, not profit')
  expect(html).toContain('Farming increases supply and can dilute prices')
  expect(html).toContain('recovery keys you control')
  expect(html).toContain('I understand')
})
