// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('beginner quests are visible with default settings before any tutorial is completed', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey.html')
  await expect(page.locator('.journey-tracker')).toBeVisible()
  await expect(page.locator('.journey-tracker')).toHaveCSS('width', '360px')
  await expect(page.getByRole('button', { name: 'Start my first quest' })).toBeVisible()
})

test('real IndexedDB completion survives reload, ignores purchases for harvesting, and resets from Settings', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/journey.html')
  await page.getByRole('button', { name: 'Start my first quest' }).click()
  const journal = page.getByRole('dialog')
  await journal.getByRole('button', { name: 'Start my first quest' }).click()
  await expect(journal.locator('h3')).toHaveText('We all need a hoe.')
  await expect
    .poll(() =>
      journal
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (image) => (image as HTMLImageElement).naturalWidth > 0 && image.getAttribute('src')?.endsWith('_hd.png')
          )
        )
    )
    .toBe(true)
  await expect(journal.locator('.journey-objective')).toContainText('Own Scrap Hoe')
  await expect(journal.locator('.journey-progress-caption')).toContainText('0 / 10')
  await journal.getByRole('button', { name: 'Close journal' }).click()
  await page.getByRole('button', { name: 'Receive hoe' }).click()
  await expect(page.locator('.journey-complete')).toContainText('Quest complete!')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(journal).toBeVisible()
  await expect(journal.locator('.journey-copy h3')).toHaveText('Let’s get our hands dirty.')
  await journal.getByRole('button', { name: 'Close journal' }).click()
  await page.getByRole('button', { name: 'Buy wheat' }).click()
  await expect(page.locator('[data-completion]')).toHaveText('["welcome","hoe"]')
  await page.getByRole('button', { name: 'Harvest wheat', exact: true }).click()
  await expect(page.locator('[data-completion]')).toHaveText('["welcome","hoe","wheat"]')
  await expect(page.locator('.journey-complete')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-completion]')).toHaveText('["welcome","hoe","wheat"]')
  await expect(page.locator('.journey-complete')).toHaveCount(0)
  await expect(page.locator('.journey-copy h3')).toHaveText('Your next rock star.')
  await page.goto('/e2e/fixtures/journey.html?account=journey-test-b')
  await expect(page.getByRole('button', { name: 'Start my first quest' })).toBeVisible()
  await expect(page.locator('[data-completion]')).toHaveText('[]')
  await page.goto('/e2e/fixtures/journey.html')
  await expect(page.locator('[data-completion]')).toHaveText('["welcome","hoe","wheat"]')
  await page.getByRole('button', { name: 'Reset quests', exact: true }).click()
  await expect(page.locator('[data-completion]')).toHaveText('[]')
  await expect(page.getByRole('button', { name: 'Reset quests', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Start my first quest' })).toBeVisible()
})

test('HD journal and compact tracker fit narrow screens in all ten locales', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const locale of ['en', 'fr', 'de', 'es', 'uk', 'ja', 'zh', 'ru', 'vi', 'ko']) {
    await page.goto(`/e2e/fixtures/journey.html?locale=${locale}`)
    await page.locator('.journey-tracker .journey-button').click()
    const journal = page.getByRole('dialog')
    await expect(journal).toBeVisible()
    await expect(journal.locator('.journey-milestone')).toHaveCount(5)
    const fits = await journal
      .locator('.journey-panel')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
    expect(fits).toBe(true)
    await expect(journal.locator('h3')).not.toContainText('_title')
    await page.screenshot({ animations: 'disabled', path: `test-results/journey-${locale}.png` })
  }
})

test('automation reward art stays above its backdrop and inside the compact art column', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey.html')
  await expect(page.locator('.journey-tracker')).toBeVisible()
  await page.getByRole('button', { name: 'Load completed journey' }).click()
  const art = page.locator('.journey-tracker .journey-art')
  const glyph = art.locator('svg')
  await expect(glyph).toBeVisible()
  const contained = await glyph.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const parent = element.parentElement!.getBoundingClientRect()
    return bounds.left >= parent.left && bounds.right <= parent.right
  })
  expect(contained).toBe(true)
  const unobscured = await glyph.evaluate((element) => {
    element.style.pointerEvents = 'all'
    const bounds = element.getBoundingClientRect()
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    return hit === element || element.contains(hit)
  })
  expect(unobscured).toBe(true)
})
