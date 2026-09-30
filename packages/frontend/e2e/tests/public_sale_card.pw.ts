// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('sale cards reflect funding and move to claims at the deadline without a reload', async ({ page }) => {
  await page.clock.install()
  await page.goto('/e2e/fixtures/public_sale_card.html')
  const cards = page.locator('[data-public-sale-card]')
  await expect(cards).toHaveCount(6)
  await expect(cards.filter({ hasText: 'GET YOUR SPOT NOW' })).toHaveCount(3)
  await expect(page.locator('.sale-card-overflow')).toHaveText('Oversubscribed+485 SUI')
  await expect(page.locator('.sale-card-target[data-reached="true"]')).toHaveCount(2)
  await expect(page.locator('.sale-card-target[data-reached="false"]')).toContainText('Minimum raise · 500 SUI')
  for (const card of await cards.all())
    await expect(card).toHaveAttribute('href', 'https://launchpad.aresrpg.world/#contribute')
  await page.clock.fastForward(93_785_000)
  await expect(page.locator('[data-phase="open"]')).toHaveCount(0)
  await expect(page.locator('[data-phase="successful"]')).toHaveCount(3)
  await expect(page.locator('[data-phase="refundable"]')).toHaveCount(2)
  await expect(page.locator('[data-phase="upcoming"]')).toHaveCount(1)
})
