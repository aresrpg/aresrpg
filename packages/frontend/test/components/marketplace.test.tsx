// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MarketplaceDisclaimer } from '../../src/marketplace/MarketplaceDisclaimer.tsx'

const source = readFileSync(new URL('../../src/marketplace/MarketplacePage.tsx', import.meta.url), 'utf8')
const browse = readFileSync(new URL('../../src/marketplace/BrowsePanel.tsx', import.meta.url), 'utf8')
const sell = readFileSync(new URL('../../src/marketplace/SellPanel.tsx', import.meta.url), 'utf8')
const history = readFileSync(new URL('../../src/marketplace/HistoryPanel.tsx', import.meta.url), 'utf8')
const content = readFileSync(new URL('../../src/editor/ContentPage.tsx', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../../src/tailwind.css', import.meta.url), 'utf8')
const model = readFileSync(new URL('../../src/marketplace/marketplace_model.tsx', import.meta.url), 'utf8')

test('the restored marketplace keeps BUY, SELL, and HISTORY without the retired send inbox', () => {
  expect(source).toContain("const tabs: readonly Tab[] = ['BUY', 'SELL', 'HISTORY']")
  expect(source).not.toContain('INBOX')
  expect(source).not.toContain('SEND')
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
  expect(html).toContain('border-t-[#c8963c]')
  expect(html).toContain('Trade for progression, not profit')
  expect(html).toContain('Farming increases supply and can dilute prices')
  expect(html).toContain('recovery keys you control')
  expect(html).toContain('I understand')
})

test('BUY restores the archived four-column browser and listing-row presentation', () => {
  expect(browse).toContain('data-marketplace-general-categories')
  expect(browse).toContain('data-marketplace-item-types')
  expect(browse).toContain('data-marketplace-template-options')
  expect(browse).toContain('data-marketplace-listing-row')
  expect(browse).toContain('data-marketplace-buy-confirm')
  expect(browse).toContain('data-marketplace-lot-market')
  expect(browse).toContain('data-marketplace-cheapest-lot')
  expect(browse).not.toContain('data-marketplace-ask-ladder')
})

test('marketplace and demo content consume the one dark-purple surface palette', () => {
  const surfaces = [source, browse, sell, history, content].join('\n')
  expect(theme).toContain('--color-surface: #12121a')
  expect(theme).toContain('--color-border: #1e1e2e')
  expect(source).toContain('bg-surface')
  expect(content).toContain('bg-surface-low')
  expect(surfaces).not.toContain('#101315')
  expect(surfaces).not.toContain('#141719')
  expect(surfaces).not.toContain('#181c1f')
  expect(surfaces).not.toContain('#1e2327')
  expect(surfaces).not.toContain('#242a2f')
})

test('fixed lots stay centered, spacious, and internally bounded', () => {
  expect(browse).toContain('max-w-[560px]')
  expect(browse).toContain('grid-cols-[72px_minmax(100px,180px)_minmax(80px,110px)]')
  expect(browse).toContain('min-h-18')
  expect(browse).toContain('truncate')
})

test('every marketplace SUI unit carries the shared Sui logo', () => {
  expect(model).toContain('data-sui-logo')
  expect(model).toContain('text-[#4a9eff]')
  expect(browse).toContain('<SuiUnit')
  expect(sell).toContain('<SuiUnit')
  expect(history).toContain('<SuiUnit')
  expect([browse, sell, history].join('\n')).not.toMatch(/\bSUI\b/)
})
