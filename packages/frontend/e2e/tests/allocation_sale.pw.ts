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
