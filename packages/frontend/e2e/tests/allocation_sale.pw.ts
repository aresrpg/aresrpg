// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const proof = { index: '0', cap_mist: '125000000000', siblings: ['ab'.repeat(32)] }

test('a Google spot buys with its allowlist proof and shows no fee or gas copy', async ({ page }) => {
  await page.goto('/e2e/fixtures/allocation_sale.html')
  await expect(page.getByText('Your spots are open')).toBeVisible()
  await expect(page.getByText('Ends in 2d 14h 7m')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Sale funding progress' })).toBeVisible()
  const google = page.getByRole('region', { name: 'Google game wallet' })
  await expect(google).toContainText('0 / 125 SUI')
  await expect(google).toContainText('212.40 SUI')
  const slush = page.getByRole('region', { name: 'Slush' })
  await slush.getByRole('button', { name: 'Connect Slush to buy' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-connects', 'Slush')
  await google.getByRole('button', { name: 'Buy KARES', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Buy KARES' })
  await expect(dialog.getByRole('button', { name: 'Max 125' })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Amount in SUI' }).fill('45')
  await expect(dialog).toContainText('≈ 300,000 KARES')
  await expect(dialog).toContainText('45 / 125 SUI')
  await expect(page.locator('body')).not.toContainText(/\bgas\b|\bfees?\b/i)
  await dialog.getByRole('button', { name: 'Buy 45 SUI of KARES' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute(
    'data-purchases',
    JSON.stringify([{ method: 'allowlisted', amount: '45000000000', proof }])
  )
  await expect(google.getByRole('status')).toContainText('+45 SUI committed')
})

test('an amount over the spot is refused and a short wallet opens Add funds instead of signing', async ({ page }) => {
  await page.goto('/e2e/fixtures/allocation_sale.html?poor')
  await page.getByRole('region', { name: 'Google game wallet' }).getByRole('button', { name: 'Buy KARES' }).click()
  const dialog = page.getByRole('dialog', { name: 'Buy KARES' })
  const amount = dialog.getByRole('textbox', { name: 'Amount in SUI' })
  await amount.fill('130')
  await expect(dialog).toContainText('Your spot has 125 SUI left.')
  await expect(dialog.getByRole('button', { name: 'Buy 130 SUI of KARES' })).toBeDisabled()
  await amount.fill('85')
  await expect(dialog).toContainText('This wallet can buy up to 20.20 SUI.')
  await dialog.getByRole('button', { name: 'Add 64.80 SUI' }).click()
  await expect(page.locator('[data-add-funds]')).toBeVisible()
  await expect(page.locator('body')).not.toHaveAttribute('data-purchases')
})

test('every spot stage shows one next step from chain state', async ({ page }) => {
  await page.goto('/e2e/fixtures/allocation_sale.html?states')
  const panels = page.locator('[data-sale-stage]')
  await expect(panels).toHaveCount(7)
  const stages = await panels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-sale-stage')))
  expect(stages).toEqual(['soon', 'live', 'full', 'waiting', 'claim', 'claim', 'settled'])
  await expect(panels.nth(0).getByRole('button', { name: 'Opens in 5d 0h 0m' })).toBeDisabled()
  await expect(panels.nth(2)).toContainText('Claim opens after launch')
  await expect(panels.nth(3)).toContainText('Waiting for Blast to launch KARES')
  await expect(panels.nth(4)).toContainText('477,259')
  await expect(panels.nth(4)).toContainText('13.41 SUI')
  await expect(panels.nth(4).getByRole('button', { name: 'Claim KARES' })).toBeEnabled()
  await expect(panels.nth(5).getByRole('button', { name: 'Claim 85 SUI refund' })).toBeEnabled()
  await expect(panels.nth(6)).toContainText('Nothing left to claim')
})

test('on a phone the buy dialog is a bottom sheet inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/fixtures/allocation_sale.html')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('region', { name: 'Google game wallet' }).getByRole('button', { name: 'Buy KARES' }).click()
  const dialog = page.getByRole('dialog', { name: 'Buy KARES' })
  await dialog.getByRole('textbox', { name: 'Amount in SUI' }).fill('45')
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(Math.round(box.y + box.height)).toBe(844)
  await expect(dialog.getByRole('button', { name: 'Buy 45 SUI of KARES' })).toBeInViewport()
})
