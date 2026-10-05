// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('unsealing keeps an opaque foreground above an already-open inventory', async ({ page }) => {
  await page.goto('/e2e/fixtures/box_batch.html?nested=1&count=2')
  await page.getByRole('spinbutton').fill('2')
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  const reveal = page.locator('.boxreveal')
  await expect(reveal).toHaveAttribute('data-modal-nested', '')
  const foreground = await reveal.evaluate((dialog) => {
    const element = document.elementFromPoint(4, 4)!
    return { owned: dialog.contains(element), color: getComputedStyle(element).backgroundColor }
  })
  expect(foreground.owned).toBe(true)
  expect(foreground.color).toMatch(/^rgb\(/)
  await expect(page.locator('.boxreveal__reward-name')).toHaveCount(2)
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
})

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
  await expect(page.locator('.boxreveal__reward-name')).toHaveCount(14)
  await expect(page.locator('.boxreveal__quantity').first()).toHaveText('×50')
  const columns = await page
    .locator('.boxreveal__grid')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  expect(columns).toBeGreaterThan(1)
  await expect(page.locator('.boxreveal__reward-name').last()).toBeInViewport()
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
  await expect(page.locator('.boxreveal__reward-name')).toHaveCount(1)
  await page.goto('/e2e/fixtures/box_batch.html?fail=1')
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  await expect(page.getByText('Closed', { exact: true })).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
})

test('fifty rewards fit a short mobile viewport without hiding quantities or the action', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/box_batch.html?nested=1&count=50')
  await page.getByRole('button', { name: 'MAX', exact: true }).click()
  await page.getByRole('button', { name: 'Consume', exact: true }).click()
  await expect(page.locator('.boxreveal__quantity')).toHaveCount(50)
  await expect(page.locator('.boxreveal__quantity').last()).toBeInViewport()
  const fits = await page.locator('.boxreveal__grid').evaluate((element) => {
    const grid = element.getBoundingClientRect()
    const body = element.parentElement!.getBoundingClientRect()
    return grid.width <= body.width && grid.height <= body.height && element.scrollHeight <= element.clientHeight
  })
  expect(fits).toBe(true)
  await expect(page.locator('.boxreveal__footer button')).toBeInViewport()
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
})

test('reduced motion reveals immediately and skipping cannot restart the opening', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/fixtures/box_batch.html?nested=1&count=1')
  const reveal = page.locator('.boxreveal')
  await expect(reveal).toHaveAttribute('data-phase', 'reveal')
  expect(await reveal.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/e2e/fixtures/box_batch.html?nested=1&count=1')
  await page.getByRole('button', { name: 'Click to skip', exact: true }).click()
  await expect(reveal).toHaveAttribute('data-phase', 'reveal')
  await page.waitForTimeout(1_800)
  await expect(reveal).toHaveAttribute('data-phase', 'reveal')
  await expect(page.locator('body')).toHaveAttribute('data-openings', '1')
})
