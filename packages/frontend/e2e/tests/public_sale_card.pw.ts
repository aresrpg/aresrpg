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
  await page.screenshot({ path: 'test-results/public-sale-states.png', fullPage: true })
  await page.clock.fastForward(93_785_000)
  await expect(page.locator('[data-phase="open"]')).toHaveCount(0)
  await expect(page.locator('[data-phase="successful"]')).toHaveCount(3)
  await expect(page.locator('[data-phase="refundable"]')).toHaveCount(2)
  await expect(page.locator('[data-phase="upcoming"]')).toHaveCount(1)
})

test('all sale states fit the sidebar width in every locale and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    await page.goto(`/e2e/fixtures/public_sale_card.html?locale=${locale}`)
    await expect(page.locator('[data-public-sale-card]')).toHaveCount(6)
    const result = await page.locator('[data-public-sale-card]').evaluateAll((cards) =>
      cards.map((card) => ({
        width: card.getBoundingClientRect().width,
        fits: [
          card,
          ...card.querySelectorAll('strong, time, .sale-card-action, .sale-card-note, .sale-card-eyebrow'),
        ].every((element) => element.scrollWidth <= element.clientWidth),
        animation: getComputedStyle(card.querySelector('.sale-card-atmosphere')!, '::before').animationName,
      }))
    )
    expect(result, locale).toEqual(Array.from({ length: 6 }, () => ({ width: 200, fits: true, animation: 'none' })))
  }
})
