// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('a stack asks for an amount, defaults to one, and opens a simultaneous grid exactly once', async ({ page }) => {
  await page.goto('/e2e/fixtures/box_batch.html')
  const amount = page.getByRole('spinbutton', { name: 'Use amount' })
  await expect(amount).toHaveValue('1')
  await expect(amount).toBeFocused()
  await page.getByRole('dialog').evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished))
  })
  await expect(page.locator('body')).not.toHaveAttribute('data-openings')
  await amount.fill('15')
  await expect(page.getByRole('button', { name: 'Consume', exact: true })).toBeDisabled()
  await amount.fill('14')
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
  await expect(page.locator('body')).toHaveAttribute('data-amount', '14')
  await expect(page.locator('.boxreveal__box-art')).toHaveCount(14)
  await expect(page.locator('.boxreveal')).toHaveAttribute('data-phase', 'charging')
  await expect(page.locator('.boxreveal__pet-name')).toHaveCount(14)
  await expect(page.locator('.boxreveal__pet-name').first()).toContainText('50')
  const columns = await page
    .locator('.boxreveal__grid')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  expect(columns).toBeGreaterThan(1)
  await expect(page.locator('.boxreveal__pet-name').last()).toBeInViewport()
  expect(await page.locator('.boxreveal__grid').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true
  )
  expect(
    await page.locator('.boxreveal__grid').evaluate((element) => element.scrollHeight <= element.clientHeight)
  ).toBe(true)
})

test('one remaining box opens directly and a rejected batch is never replayed', async ({ page }) => {
  await page.goto('/e2e/fixtures/box_batch.html?count=1')
  await expect(page.getByRole('spinbutton')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
  await expect(page.locator('.boxreveal__pet-name')).toHaveCount(1)
  await page.goto('/e2e/fixtures/box_batch.html?fail=1')
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  await expect(page.getByText('Closed', { exact: true })).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
})
