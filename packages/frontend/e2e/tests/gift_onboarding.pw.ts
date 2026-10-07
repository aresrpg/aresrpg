// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('a portrait recipient reaches a saved gift without canvas, funding or a second opening', async ({ page }) => {
  await page.goto('/e2e/fixtures/gift_onboarding.html')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You just got 1 of 100 Sui Crates' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Add SUI/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open my free crate', exact: true }).click()
  await expect(page.locator('.boxreveal__reel')).toBeVisible()
  await expect(page.locator('.boxreveal__reel-card--landed')).toHaveAttribute('data-item', 'sui_helmet')
  const landing_offset = await page.locator('.boxreveal__reel-card--landed').evaluate((card) => {
    const item = card.getBoundingClientRect()
    const reel = card.closest('.boxreveal__reel')!.getBoundingClientRect()
    return Math.abs(item.x + item.width / 2 - reel.x - reel.width / 2)
  })
  expect(landing_offset).toBeLessThan(1)
  await expect(page.getByText('✓ Reward collected · All gift fees covered')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-gift-calls', 'transfer,redeem,open,collect')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/gift-onboarding-production-mobile.png', fullPage: true })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This card is unavailable' })).toBeVisible()
  await page.getByRole('button', { name: 'Check my gifts', exact: true }).click()
  await expect(page.getByText('✓ Reward collected · All gift fees covered')).toBeVisible()
  await expect(page.locator('.boxreveal__reel')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-gift-calls', 'transfer,redeem,open,collect')
  await page.getByRole('button', { name: 'Create character', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add SUI to start playing' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('failed sponsorship is not automatically retried across reload', async ({ page }) => {
  await page.goto('/e2e/fixtures/gift_onboarding.html?fail=redeem')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('you do not need to add SUI')
  await expect(page.locator('body')).toHaveAttribute('data-gift-calls', 'transfer,redeem')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This card is unavailable' })).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-gift-calls', 'transfer,redeem')
})

test('checking an uncertain opening recovers that result and never opens again', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/fixtures/gift_onboarding.html?uncertain')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await page.getByRole('button', { name: 'Open my free crate', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('will not open another crate')
  await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByText('✓ Reward collected · All gift fees covered')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-gift-calls', 'transfer,redeem,open,collect')
})

test('the actual printed-card entry never starts a renderer', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/gift#$invalid-preview-key')
  await expect(page.getByRole('heading', { name: 'A gift to start your adventure' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(requests.filter((url) => /\.(glb|ktx2)(\?|$)|main_menu\.recipe|world.*worker/.test(url))).toEqual([])
  expect(await page.evaluate(() => location.hash)).toBe('')
})
