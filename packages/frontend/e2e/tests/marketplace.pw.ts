// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('different rolls retain their exact tooltip and individual buy action', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html')
  await page
    .locator('[data-marketplace-item-types]')
    .getByRole('button', { name: /^hat\b/i })
    .click()
  await page.locator('[data-marketplace-template-options] button').first().click()
  const rows = page.locator('[data-marketplace-listings] [data-marketplace-listing-row]')
  await expect(rows).toHaveCount(3)
  await expect(page.locator('[data-marketplace-lot-market]')).toHaveCount(0)
  await expect(page.locator('[data-marketplace-listings]')).not.toContainText('×1')
  await rows.nth(2).locator('[data-marketplace-item]').hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('tooltip')).toHaveCSS('pointer-events', 'none')
  await expect(page.getByRole('tooltip')).not.toContainText('unavailable')
  await rows.nth(0).locator('[data-marketplace-item]').hover()
  await expect(page.getByRole('tooltip')).toContainText('+11')
  await expect(page.getByRole('tooltip')).toContainText('3 - 7 damages Fire')
  await page.mouse.move(0, 0)
  await rows.nth(1).locator('[data-marketplace-item]').focus()
  await expect(page.getByRole('tooltip')).toContainText('+27')
  await expect(page.locator('body')).not.toHaveAttribute('data-read-item')
  await rows.nth(1).getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.locator('[data-pending-listing]')).toHaveAttribute('data-pending-listing', '0xitem2')
})

test('stackable listings expose the cheapest offers for each fixed lot', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?stackable')
  await expect(page.locator('[data-marketplace-cheapest-lot]')).toHaveCount(4)
  await expect(page.locator('[data-marketplace-cheapest-lot="1"]')).toHaveCount(1)
  const single = page.locator('[data-marketplace-cheapest-lot="1"]').first()
  await expect(single).toContainText('1.10')
  await single.getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.locator('[data-pending-listing]')).toHaveAttribute('data-pending-listing', '0xitem1')
})

test('stackable price history uses TradingView with responsive columns and range controls without footer clutter', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/e2e/fixtures/marketplace.html?stackable&tiny')
  const chart = page.locator('[data-marketplace-price-history]')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await chart
    .locator('canvas')
    .first()
    .evaluate((canvas) => canvas.setAttribute('data-chart-instance', 'original'))
  const lots = page.locator('[data-marketplace-listings]')
  const lot_bounds = await lots.boundingBox()
  const chart_bounds = await chart.boundingBox()
  expect(chart_bounds!.x).toBeGreaterThan(lot_bounds!.x + lot_bounds!.width)
  await expect(chart.getByText('Show daily prices', { exact: true })).toHaveCount(0)
  await expect(chart.getByText(/Weighted by units|Tracking since/)).toHaveCount(0)
  await chart.getByRole('button', { name: '7D', exact: true }).click()
  await expect(chart.getByRole('button', { name: '7D', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator('canvas').first()).toHaveAttribute('data-chart-instance', 'original')
  await page.evaluate(() => window.dispatchEvent(new Event('market-price-fixture-update')))
  await expect(chart.locator('canvas').first()).toHaveAttribute('data-chart-instance', 'original')
  const plot = chart.locator('[data-tradingview-prices]')
  const plot_bounds = await plot.boundingBox()
  await plot.hover({ position: { x: plot_bounds!.width / 2, y: 100 } })
  await expect(chart.locator('[data-price-inspection]')).toContainText('1,000 units sold')
  await expect(chart.locator('[data-price-inspection]')).toContainText('0.000000000001 SUI')

  await chart.getByRole('button', { name: '1Y', exact: true }).click()
  await expect(chart.getByRole('button', { name: '1Y', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 736, height: 1080 })
  await expect(async () => {
    const left = await lots.boundingBox()
    const right = await chart.boundingBox()
    expect(right!.y).toBeGreaterThan(left!.y + left!.height)
  }).toPass()
  expect(errors).toEqual([])
})

test('items outside the latest listing window remain selectable and fetch their own asks', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?stackable&all-types')
  const name = await page.locator('body').getAttribute('data-older-item')
  await page.locator('[data-marketplace-template-options]').getByRole('button', { name: name!, exact: true }).click()
  await page.locator('[data-marketplace-listings]').getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.locator('[data-pending-listing]')).toHaveAttribute('data-pending-listing', '0xolder')
})

test('untraded stackables show an empty period without inventing a price', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?stackable&empty')
  const chart = page.locator('[data-marketplace-price-history]')
  await expect(chart).toContainText('No completed sales in this period.')
  await expect(chart.locator('canvas')).toHaveCount(0)
})

test('identical rolls retain backup offers and advance after the cheapest is removed', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?duplicates')
  await page
    .locator('[data-marketplace-item-types]')
    .getByRole('button', { name: /^hat\b/i })
    .click()
  await page.locator('[data-marketplace-template-options] button').first().click()
  const rows = page.locator('[data-marketplace-listings] [data-marketplace-listing-row]')
  await expect(rows).toHaveCount(3)
  await expect(rows.first().locator('[data-marketplace-item]')).toHaveAttribute('data-marketplace-item', '0xduplicate')
  await rows.first().locator('[data-marketplace-item]').hover()
  await expect(page.getByRole('tooltip')).toContainText('+11')
  await page.mouse.move(0, 0)
  await rows.first().getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.locator('[data-pending-listing]')).toHaveAttribute('data-pending-listing', '0xduplicate')
  await page.evaluate(() => window.dispatchEvent(new Event('market-fixture-remove-cheapest')))
  await expect(rows).toHaveCount(3)
  await expect(rows.first().locator('[data-marketplace-item]')).toHaveAttribute('data-marketplace-item', '0xitem1')
})

test('stackable capitalization shares chart prices and disappears without a sale or supply', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html?stackable')
  const card = page.locator('[data-marketplace-capitalization]')
  await expect(card).toContainText('1,000,000')
  await expect(card).toContainText('10.90')
  await page.getByRole('button', { name: '7D', exact: true }).click()
  await expect(card).toContainText('10.90')
  await page.screenshot({ path: 'test-results/market-capitalization.png' })
  await page.goto('/e2e/fixtures/marketplace.html?stackable&empty')
  await expect(page.locator('[data-marketplace-price-history]')).toBeVisible()
  await expect(card).toHaveCount(0)
  await page.goto('/e2e/fixtures/marketplace.html?stackable&supply-unavailable')
  await expect(page.locator('[data-marketplace-price-history] canvas').first()).toBeVisible()
  await expect(card).toHaveCount(0)
  await page.goto('/e2e/fixtures/marketplace.html?stackable&sparse')
  await expect(card).toContainText('10.00')
})

test('category badges count item types, aggregate subcategories, and leave characters unnumbered', async ({ page }) => {
  await page.goto('/e2e/fixtures/marketplace.html')
  const groups = page.locator('[data-marketplace-general-categories]')
  await expect(groups.getByRole('button', { name: /^Equipment/ }).locator('[data-marketplace-type-count]')).toHaveText(
    '3'
  )
  await expect(groups.getByRole('button', { name: /^Resources/ }).locator('[data-marketplace-type-count]')).toHaveText(
    '4'
  )
  await expect(
    groups.getByRole('button', { name: /^Characters/ }).locator('[data-marketplace-type-count]')
  ).toHaveCount(0)
  await expect(
    page
      .locator('[data-marketplace-item-types]')
      .getByRole('button', { name: /^Hat\b/i })
      .locator('[data-marketplace-type-count]')
  ).toHaveText('2')
  await page
    .locator('[data-marketplace-item-types]')
    .getByRole('button', { name: /^Hat\b/i })
    .click()
  await page.locator('[data-marketplace-template-options] button').first().click()
  await expect(page.locator('[data-marketplace-listing-row]')).toHaveCount(3)
  await expect(groups.getByRole('button', { name: /^Equipment/ }).locator('[data-marketplace-type-count]')).toHaveText(
    '3'
  )
  await page.screenshot({ path: 'test-results/market-type-counts.png' })
})
