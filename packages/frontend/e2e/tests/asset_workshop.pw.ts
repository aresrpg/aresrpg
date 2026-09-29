// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('the single workshop reports a failed scene without hiding demo navigation', async ({ page }) => {
  await page.route(/asset_workshop[^/]*\.json/, (route) =>
    route.request().resourceType() === 'fetch'
      ? route.fulfill({ status: 503, body: 'Unavailable test artifact' })
      : route.continue()
  )
  await page.goto('/demo#assets')
  const workshop = page.getByRole('region', { name: 'Assets' })
  await expect(workshop.locator('[data-world-loading="failed"]')).toBeVisible()
  await expect(workshop.getByRole('navigation')).toHaveCount(0)
  await expect(workshop.locator('canvas')).toHaveCount(1)
  await page.getByRole('button', { name: 'Design workshop', exact: true }).click()
  await expect(workshop).toHaveCount(0)
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await expect(page).toHaveURL(/#assets$/)
  await expect(workshop.locator('[data-world-loading="failed"]')).toBeVisible()
  await page.reload()
  await expect(workshop.locator('[data-world-loading="failed"]')).toBeVisible()
})

test('the workshop loads its real world and remounts after leaving the tab', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/demo#assets')
  const workshop = page.getByRole('region', { name: 'Assets' })
  await expect(workshop.locator('canvas')).toHaveCount(1)
  await expect(workshop.locator('[data-world-loading]')).toHaveCount(0, { timeout: 90_000 })
  const canvas = await workshop.locator('canvas').elementHandle()
  await page.getByRole('button', { name: 'Design workshop', exact: true }).click()
  await expect(workshop).toHaveCount(0)
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(false)
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await expect(workshop.locator('canvas')).toHaveCount(1)
  await expect(workshop.locator('[data-world-loading]')).toHaveCount(0, { timeout: 30_000 })
  expect(errors).toEqual([])
})
