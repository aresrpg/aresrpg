// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('the journey tracker remembers collapse and expansion across reloads', async ({ page }) => {
  await page.goto('/e2e/fixtures/journey.html')
  const tracker = page.locator('.journey-tracker')
  await tracker.getByRole('button', { name: 'Collapse quests', exact: true }).click()
  await expect(tracker.locator('.journey-launcher')).toBeVisible()
  await page.reload()
  await expect(tracker.locator('.journey-launcher')).toBeVisible()
  await tracker.locator('.journey-launcher').click()
  await expect(tracker.getByRole('button', { name: 'Collapse quests', exact: true })).toBeVisible()
  await page.reload()
  await expect(tracker.getByRole('button', { name: 'Collapse quests', exact: true })).toBeVisible()
  await expect(tracker.locator('.journey-launcher')).toHaveCount(0)
})

test('real IndexedDB completion survives reload, ignores purchases for harvesting, and resets from Settings', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/journey.html')
  await page.getByRole('button', { name: 'Start my first quest' }).click()
  const journal = page.getByRole('dialog')
  await journal.getByRole('button', { name: 'Start my first quest' }).click()
  await expect(journal.locator('h3')).toHaveText('Find your way')
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
  await expect(journal.locator('.journey-objective')).toContainText('Use the map to reach a nearby destination')
  await expect(journal.locator('.journey-progress-caption')).toContainText('0 / 14')
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

test('finishing all quests removes the open journal and collapsed tracker across reload, but reset restores them', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/journey.html')
  await page.getByRole('button', { name: 'Start my first quest' }).click()
  const journal = page.getByRole('dialog')
  await journal.getByRole('button', { name: 'Start my first quest' }).click()
  await expect(journal.locator('h3')).toHaveText('Find your way')
  // The final gameplay observation can arrive while a journal is open.
  await page
    .getByRole('button', { name: 'Finish quests', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
  await expect(journal).toHaveCount(0)
  await expect(page.locator('.journey-tracker')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quest journal', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reset quests', exact: true })).toBeVisible()
  const completed = await page.locator('[data-completion]').textContent()
  await page.reload()
  await expect(page.locator('[data-completion]')).toHaveText(completed!)
  await expect(page.locator('.journey-tracker')).toHaveCount(0)
  await expect(page.locator('.journey-panel')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quest journal', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset quests', exact: true }).click()
  await expect(page.locator('.journey-tracker')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse quests', exact: true }).click()
  await expect(page.locator('.journey-launcher')).toBeVisible()
  await page.getByRole('button', { name: 'Load completed journey', exact: true }).click()
  await expect(page.locator('.journey-launcher')).toHaveCount(0)
  await expect(page.locator('.journey-tracker')).toHaveCount(0)
})
