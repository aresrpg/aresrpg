// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { open_responsive_preview } from '../support/responsive_preview.ts'

for (const viewport of [
  { width: 1920, height: 900 },
  { width: 1669, height: 500 },
  { width: 1024, height: 768 },
  { width: 590, height: 850 },
]) {
  test(`jobs keep full recipe names at native size at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=jobs')
    await page.locator('.jobs__list-name').getByText('Tailor', { exact: true }).click()
    const recipes = page.locator('.jobs__recipe')
    await expect(recipes.first()).toBeVisible()
    const native_scale = await page
      .locator('.jobs')
      .evaluate((element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth)
    expect(native_scale).toBeCloseTo(1, 2)
    const names = page.locator('.jobs__recipe-name')
    for (const name of await names.all()) {
      expect(await name.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      expect(await name.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    }
    await recipes.last().scrollIntoViewIfNeeded()
    await expect(recipes.last()).toBeInViewport()
    await recipes.first().click()
    await expect(page.locator('.jobs__item-detail')).toBeVisible()
    if (await page.locator('.jobs__browse').isVisible()) {
      for (const name of await names.all()) {
        expect(await name.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      }
    }
    expect(
      await page.locator('.chr-page-body').evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1)
    const craft = page.locator('.jobs__craft-btn')
    await craft.scrollIntoViewIfNeeded()
    await expect(craft).toBeInViewport()
    await page.locator('.jobs__detail-close').click()
    await expect(recipes.first()).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('jobs.png') })
  })
}
