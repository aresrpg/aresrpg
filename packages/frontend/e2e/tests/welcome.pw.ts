// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { FUNDING_SUI_CHAIN, FUNDING_SUI_TOKEN } from '../../src/funding/chains.ts'

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
])
  test(`welcome funding and USD estimates at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.route('https://li.quest/v1/token?**', (route) =>
      route.fulfill({
        json: { chainId: FUNDING_SUI_CHAIN, address: FUNDING_SUI_TOKEN, priceUSD: '1.20' },
      })
    )
    await page.goto('/e2e/fixtures/welcome.html')
    await expect(page.locator('[data-welcome-cost]')).toContainText('1 SUI (≈$1.20)')
    await expect(page.locator('[data-welcome-cost]')).toContainText('0.05 SUI (≈$0.06)')
    const create = page.getByRole('button', { name: 'Create character', exact: true })
    await expect(create).toBeDisabled()
    await expect(create).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Add funds', exact: true })).toBeInViewport()
    await page.locator('[data-empty]').evaluate((button: HTMLButtonElement) => button.click())
    await expect(create).toBeDisabled()
    await page.screenshot({ path: test.info().outputPath('welcome.png') })
    expect(
      await page.locator('[data-welcome]').evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Add funds', exact: true }).click()
    const funding = page.getByRole('dialog', { name: 'Add Funds', exact: true })
    await expect(funding).toBeVisible()
    await expect(funding).toContainText(`0x${'11'.repeat(32)}`)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('[data-welcome]')).toBeVisible()
    await page.locator('[data-fund]').evaluate((button: HTMLButtonElement) => button.click())
    await expect(create).toBeEnabled()
    await create.click()
    await expect(page.getByText('Character creation opened')).toBeVisible()
  })

test('a failed price lookup leaves SUI costs and funding usable', async ({ page }) => {
  await page.route('https://li.quest/v1/token?**', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/e2e/fixtures/welcome.html')
  await expect(page.locator('[data-welcome-cost]')).toContainText('1 SUI')
  await expect(page.locator('[data-welcome-cost]')).not.toContainText('$')
  await page.getByRole('button', { name: 'Add funds', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
})

test('the existing wallet popover still closes before opening funding', async ({ page }) => {
  await page.goto('/e2e/fixtures/welcome.html?popover')
  await page.locator('[data-wallet-trigger]').click()
  await expect(page.locator('[data-wallet-card]')).toBeVisible()
  await page.getByRole('button', { name: 'Add funds', exact: true }).click()
  await expect(page.locator('[data-wallet-card]')).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
})

test('testnet welcome never attaches dollar estimates to free test tokens', async ({ page }) => {
  const price_requests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://li.quest/v1/token')) price_requests.push(request.url())
  })
  await page.goto('/e2e/fixtures/welcome.html?testnet')
  await expect(page.locator('[data-welcome-cost]')).not.toContainText('$')
  await page.getByRole('button', { name: 'Add funds', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open Sui Faucet' })).toBeVisible()
  expect(price_requests).toEqual([])
})

test('a failed refresh removes the old USD estimate', async ({ page }) => {
  await page.clock.install()
  let calls = 0
  await page.route('https://li.quest/v1/token?**', (route) => {
    calls += 1
    return calls === 1
      ? route.fulfill({ json: { chainId: FUNDING_SUI_CHAIN, address: FUNDING_SUI_TOKEN, priceUSD: '1.20' } })
      : route.fulfill({ status: 503, body: 'Unavailable' })
  })
  await page.goto('/e2e/fixtures/welcome.html')
  await expect(page.locator('[data-welcome-cost]')).toContainText('≈$1.20')
  await page.clock.fastForward(60_000)
  await expect(page.locator('[data-welcome-cost]')).not.toContainText('$')
  expect(calls).toBe(2)
})
