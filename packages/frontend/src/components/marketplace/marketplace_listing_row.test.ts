// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

// Portal modals are proven by source-contract in this repo (no jsdom/RTL — see item_detail_view.test.tsx;
// same idiom as sell_panel.test.ts). Design ruling 2026-07-18: clicking BUY must open a proper "are you sure you want to
// buy X for X SUI" confirm modal, NOT the old inline PAY-WITH-SUI strip.
const src = readFileSync(new URL('./marketplace_listing_row.tsx', import.meta.url), 'utf8')

describe('marketplace listing row buy confirmation', () => {
  test('BUY opens the shared confirm modal, never the inline pay strip', () => {
    // The inline confirmation strip (its structural marker) is gone.
    expect(src).not.toContain('data-marketplace-buy-confirm')
    // Reuses the house ConfirmDialog — never a second modal system.
    expect(src).toContain('ConfirmDialog')
    // The modal states item name + price explicitly.
    expect(src).toContain('marketplace.purchase.confirm_message')
    expect(src).toContain('item_name')
  })

  // Design ruling 2026-07-19: never write "pay with sui" in the marketplace — it's already a price in
  // Sui. The confirm modal's price is already SUI-denominated (price_label) — the label
  // must never restate the currency. Reuses the same generic BUY key as the row button, never a
  // dedicated pay-with-sui string.
  test('confirm label never restates the currency and reuses the generic BUY key', () => {
    expect(src).not.toContain('pay_sui')
    expect(src).not.toMatch(/pay\s*with\s*sui/i)
    expect(src).not.toMatch(/buy\s*with\s*sui/i)
    expect(src).toContain("t('marketplace.sui.buy')")
  })
})
