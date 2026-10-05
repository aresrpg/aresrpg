// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('automatic gift redemption keeps its congratulations visible on a phone', async ({ page }) => {
  await page.goto('/e2e/fixtures/gift_claim.html')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'You got a gift!' })).toBeVisible()
  await expect(dialog.getByText('1 × Sui Crate')).toBeVisible()
  await expect(dialog.getByText('Your reward is ready in your inventory.')).toBeVisible()
  await page.screenshot({ path: 'test-results/gift-claimed-mobile.png' })
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Replay snapshot' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('unfunded recipients see their gift in funding and explicitly retry after funding', async ({ page }) => {
  await page.goto('/e2e/fixtures/gift_claim.html?gas')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('alert')).toContainText('You got 1 × Sui Crate!')
  await expect(dialog.getByRole('alert')).toContainText('Add a little SUI')
  await page.screenshot({ path: 'test-results/gift-funding-mobile.png' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-claims', '1')
  await expect(dialog.getByText('1 × Sui Crate')).toBeVisible()
  await dialog.getByRole('button', { name: 'Claim rewards', exact: true }).click()
  await expect(dialog.getByText('Your reward is ready in your inventory.')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-claims', '2')
})

test('a scanned used card clearly says it was already claimed', async ({ page }) => {
  await page.goto('/e2e/fixtures/gift_claim.html?used')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Card already claimed' })).toBeVisible()
  await expect(dialog.getByText(/Each card can only be used once/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Claim rewards' })).toHaveCount(0)
})
