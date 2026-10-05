// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const resource of [true, false]) {
  test(`another owned character without a retained receipt opens ${resource ? 'resource' : 'equipment'} details`, async ({
    page,
  }) => {
    await page.goto(`/e2e/fixtures/fight_result.html?rolled&other-character${resource ? '&resource' : ''}`)
    await page
      .locator('.fe-row')
      .filter({ hasText: 'Other hero' })
      .getByRole('button', {
        name: resource ? 'Tree Resin' : 'Gravebrand',
        exact: true,
      })
      .click()
    await expect(page.locator('.aui-inspection .item-sheet-container')).toBeVisible()
    await expect(page.getByText(/Fetching stats on chain|Waiting for reward details/)).toHaveCount(0)
    await expect(page.locator('[data-owned-item-id]')).toHaveCount(0)
  })
}

test('complete equipment rolls do not wait for unrelated receipt items', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled&unrelated-pending')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  await expect(page.locator('[data-owned-item-id="new-sword-a"]')).toBeVisible()
  await expect(page.locator('[data-owned-item-id="new-sword-b"]')).toBeVisible()
  await expect(page.getByText(/Fetching stats on chain|Waiting for reward details/)).toHaveCount(0)
})

test('fight loot opens the received rolls, including distinct copies of the same equipment', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  const first = page.locator('[data-owned-item-id="new-sword-a"]')
  const second = page.locator('[data-owned-item-id="new-sword-b"]')
  await expect(first).toBeVisible()
  await expect(first).toContainText('+2')
  await expect(first).toContainText('+4')
  await expect(second).toContainText('+5')
  await expect(second).toContainText('+1')
  await expect(page.locator('[data-owned-item-id="old-sword"]')).toHaveCount(0)
  await expect(first).not.toContainText('+1 to 5')
})

test('loot details wait for the exact inventory rows without substituting an older copy', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled&pending')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  await expect(page.locator('[data-owned-item-id]')).toHaveCount(0)
  await expect(page.getByText('Waiting for reward details…', { exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-loot-arrived')))
  await expect(page.locator('[data-owned-item-id="new-sword-a"]')).toBeVisible()
  await expect(page.locator('[data-owned-item-id="new-sword-b"]')).toHaveCount(1)
  await expect(page.getByText('Waiting for reward details…', { exact: true })).toHaveCount(0)
})

test('resources have catalogue details even while receipt inventory is pending', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled&resource&pending')
  await page.getByRole('button', { name: 'Tree Resin', exact: true }).click()
  await expect(page.locator('.aui-inspection .item-sheet-container')).toBeVisible()
  await expect(page.getByText('Waiting for reward details…', { exact: true })).toHaveCount(0)
})

test('an empty delivered-ID list opens catalogue details instead of an impossible wait', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled&empty-receipt')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  await expect(page.locator('.aui-inspection .item-sheet-container')).toBeVisible()
  await expect(page.locator('[data-owned-item-id]')).toHaveCount(0)
})

test('a removed reward leaves the loading state without showing an older matching item', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?rolled&pending')
  await page.getByRole('button', { name: 'Gravebrand', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-loot-removed')))
  await expect(page.getByText('This reward is no longer in your inventory.', { exact: true })).toBeVisible()
  await expect(page.getByText('Waiting for reward details…', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-owned-item-id]')).toHaveCount(0)
})
