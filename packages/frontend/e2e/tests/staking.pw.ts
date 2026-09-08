// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('staking keeps accounts independent, aggregates withdrawals and rewards and fits the desktop page', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/staking.html')
  const account = page.locator('[data-staking-account="0xparticipant"]')
  const external = page.locator('[data-staking-account="0xexternal"]')
  await expect(account).toBeVisible()
  await expect(page.locator('.staking-account')).toHaveCount(2)
  await expect(external).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.getByRole('button', { name: 'Test wallet', exact: true }).click()
  await expect(external).toBeVisible()
  await expect(account).toBeVisible()

  await account.getByRole('button', { name: '25%', exact: true }).click()
  await expect(account.getByRole('textbox')).toHaveValue('1.750000000')
  await account.getByRole('button', { name: '50%', exact: true }).click()
  await expect(account.getByRole('textbox')).toHaveValue('3.500000000')
  await account.getByRole('button', { name: 'Max', exact: true }).click()
  await expect(account.getByRole('textbox')).toHaveValue('7.000000000')
  await account.getByRole('textbox').fill('1')
  await expect(account.locator('[data-staking-estimate]')).toContainText('+0.034 KARES')
  await expect(account.locator('[data-staking-estimate]')).toContainText('+0.017 SUI')
  await account.getByRole('button', { name: 'Stake KARES', exact: true }).last().click()
  await external.getByRole('textbox').fill('2')
  await external.getByRole('button', { name: 'Stake KARES', exact: true }).last().click()
  await external.getByRole('button', { name: 'Withdraw stake', exact: true }).click()
  await expect(external.getByRole('combobox')).toHaveCount(0)
  await external.getByRole('button', { name: 'Max', exact: true }).click()
  await expect(external.getByRole('textbox')).toHaveValue('30.000000000')
  await external.getByRole('textbox').fill('31')
  await expect(external.getByRole('button', { name: 'Withdraw stake', exact: true }).last()).toBeDisabled()
  await external.getByRole('textbox').fill('25')
  await external.getByRole('button', { name: 'Withdraw stake', exact: true }).last().click()
  await expect(account.getByRole('region', { name: 'Accrued rewards' })).toContainText('4 KARES')
  await expect(account.getByRole('region', { name: 'Accrued rewards' })).toContainText('6 SUI')
  await account.getByRole('button', { name: 'Claim rewards', exact: true }).click()
  await expect(page.locator('[data-staking-inputs]')).toHaveText(
    JSON.stringify([
      {
        owner: 'account',
        input: { type: 'request', request: { kind: 'execute', action: { kind: 'stake', amount: '1000000000' } } },
      },
      {
        owner: 'external',
        input: { type: 'request', request: { kind: 'execute', action: { kind: 'stake', amount: '2000000000' } } },
      },
      {
        owner: 'external',
        input: {
          type: 'request',
          request: {
            kind: 'execute',
            action: {
              kind: 'withdraw',
              positions: [
                { id: '0xstake-one', amount: '10000000000' },
                { id: '0xstake-two', amount: '20000000000' },
              ],
              amount: '25000000000',
            },
          },
        },
      },
      {
        owner: 'account',
        input: {
          type: 'request',
          request: { kind: 'execute', action: { kind: 'claim_rewards', ids: ['0xstake-one', '0xstake-two'] } },
        },
      },
    ])
  )
  const slot = page.locator('[data-page-slot]')
  expect(await slot.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
  const logo = account.locator('[data-kares-logo]').first()
  await expect(logo).toBeVisible()
  expect(await logo.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1254)).toBe(
    true
  )
  expect(
    await logo.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')!
      context.drawImage(element, 0, 0)
      return context.getImageData(0, 0, 1, 1).data[3]
    })
  ).toBe(0)
  expect(await logo.getAttribute('src')).toMatch(/^\/assets\/kares-/)
  await page.screenshot({ path: 'test-results/staking-desktop.png' })
})

test('both staking accounts fit the desktop viewport in all six locales', async ({ page }) => {
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
    await page.goto(`/e2e/fixtures/staking.html?locale=${locale}`)
    await page.locator('[data-wallet-connect]').click()
    await page.getByRole('button', { name: 'Test wallet', exact: true }).click()
    await expect(page.locator('[data-staking-account="0xexternal"]')).toBeVisible()
    const fits = await page.locator('[data-page-slot]').evaluate((element) => ({
      vertical: element.scrollHeight <= element.clientHeight,
      horizontal: element.scrollWidth <= element.clientWidth,
    }))
    expect(fits, locale).toEqual({ vertical: true, horizontal: true })
  }
})
