// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = readFileSync(new URL('../../src/marketplace/MarketplacePage.tsx', import.meta.url), 'utf8')

test('the restored marketplace keeps BUY, SELL, and HISTORY without the retired send inbox', () => {
  expect(source).toContain("const tabs: readonly Tab[] = ['BUY', 'SELL', 'HISTORY']")
  expect(source).not.toContain('INBOX')
  expect(source).not.toContain('SEND')
})
