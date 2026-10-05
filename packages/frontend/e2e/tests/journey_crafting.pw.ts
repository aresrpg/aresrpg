// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('a failed craft from quest → recipe remains visible and dismissible above the recipe window', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey_crafting.html')
  await page.getByRole('button', { name: 'Quest journal', exact: true }).click()
  await page.getByRole('button', { name: 'View recipe', exact: true }).click()
  await page.getByRole('button', { name: 'Craft ×1', exact: true }).click()
  const notification = page.getByText('0 / 1 Scrap Hoe crafted', { exact: true })
  await expect(notification).toBeVisible()
  await expect(notification).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Craft ×1', exact: true })).toBeFocused()
  // Visibility alone passes behind a top-layer window. Browser hit testing proves that the
  // recipe cannot cover the toast or intercept its dismiss/action buttons.
  await expect(notification).toHaveJSProperty('isConnected', true)
  const dismiss = notification.locator('..').getByRole('button')
  await dismiss.click({ trial: true, timeout: 2000 })
  await page.screenshot({ path: 'test-results/journey-craft-toast.png' })
  await dismiss.click({ timeout: 2000 })
  await expect(notification).toHaveCount(0)
})

test('existing actionable notifications follow journal, recipe and page closure without duplication', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/journey_crafting.html')
  await page.getByRole('button', { name: 'Show action notification' }).click()
  await page.getByRole('button', { name: 'Quest journal', exact: true }).click()
  await page.getByRole('button', { name: 'Acknowledge notification' }).click()
  await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View recipe', exact: true }).click()
  await page.getByRole('button', { name: 'Acknowledge notification' }).click()
  await expect(page.getByText('Action notification', { exact: true })).toHaveCount(1)
  await page
    .getByRole('dialog', { name: 'Scrap Hoe', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: 'Encyclopedia', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.getByRole('button', { name: 'Acknowledge notification' }).click()
  await expect(page.getByText('Action notification', { exact: true })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('material quantities follow the recipe and link to the ingredient sources', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey_crafting.html?step=materials')
  await page.getByRole('button', { name: 'Quest journal', exact: true }).click()
  const journal = page.getByRole('dialog', { name: 'Surviving Nauvis', exact: true })
  await expect(journal.locator('.journey-ingredients')).toContainText('1 / 3')
  await expect(journal.locator('.journey-ingredients')).toContainText('1 / 2')
  await page.screenshot({ path: 'test-results/journey-materials.png' })
  await journal
    .locator('.journey-ingredients')
    .getByRole('button', { name: /Gnawed Branch/ })
    .click()
  await expect(page.getByRole('dialog', { name: 'Gnawed Branch', exact: true })).toBeVisible()
})

test('the first hunt opens the actual Tinker bestiary entry', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey_crafting.html?step=hunt')
  await page.getByRole('button', { name: 'Quest journal', exact: true }).click()
  await page.getByRole('button', { name: 'Creature details', exact: true }).click()
  await expect(page.locator('[data-encyclopedia-tab="bestiary"]')).toBeVisible()
  await expect(page.getByRole('dialog', { name: /Tinker/ })).toBeVisible()
})

test('the map quest completes after the controller reaches its chosen destination', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey_crafting.html?step=map')
  await page.getByRole('button', { name: 'Quest journal', exact: true }).click()
  const journal = page.getByRole('dialog', { name: 'Surviving Nauvis', exact: true })
  await expect(journal).toContainText('escape obstacles')
  await journal.getByRole('button', { name: 'World map', exact: true }).click()
  const map = page.getByRole('dialog', { name: 'World map', exact: true })
  await expect(map).toBeVisible()
  await expect(page.locator('[data-journey-completed]')).not.toContainText('map_travel')
  const canvas = map.locator('canvas')
  const box = await canvas.boundingBox()
  await canvas.click({ position: { x: box!.width / 2 + 16, y: box!.height / 2 } })
  await expect(page.locator('[data-journey-completed]')).toContainText('map_travel')
})

test('listed resources are unavailable in both the quest counter and the recipe', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey_crafting.html?step=materials&listed')
  await page.getByRole('button', { name: 'Quest journal', exact: true }).click()
  const journal = page.getByRole('dialog', { name: 'Surviving Nauvis', exact: true })
  await expect(journal.locator('.journey-ingredients').getByRole('button', { name: /Gnawed Branch/ })).toContainText(
    '0 / 3'
  )
  await journal.getByRole('button', { name: 'View recipe', exact: true }).click()
  const recipe = page.getByRole('dialog', { name: 'Scrap Hoe', exact: true })
  await expect(recipe.locator('.jobs__ingredient').filter({ hasText: 'Gnawed Branch' })).toContainText('0 / 3')
  await expect(recipe.getByRole('button', { name: 'Craft ×1', exact: true })).toBeDisabled()
})
