// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('the first failed craft is explained once and acknowledgement survives reload', async ({ page }) => {
  await page.goto('/e2e/fixtures/feedback.html')
  await page.getByRole('button', { name: 'Fail craft', exact: true }).click()
  const notice = page.locator('[data-tutorial="craft_failure"]')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('consumes the ingredients')
  await page.screenshot({ path: 'test-results/feedback-craft.png' })
  await page.getByRole('button', { name: 'Got it', exact: true }).last().click()
  await page.getByRole('button', { name: 'Fail another craft' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Fail craft', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset tutorials' }).click()
  await expect(notice).toHaveCount(0)
  await page.getByRole('button', { name: 'Fail another craft' }).click()
  await expect(notice).toBeVisible()
})

test('craft guidance waits for combat to finish', async ({ page }) => {
  await page.goto('/e2e/fixtures/feedback.html')
  await page.getByRole('button', { name: 'Toggle combat' }).click()
  await page.getByRole('button', { name: 'Fail craft', exact: true }).click()
  await expect(page.locator('[data-tutorial="craft_failure"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle combat' }).click()
  await expect(page.locator('[data-tutorial="craft_failure"]')).toBeVisible()
})
