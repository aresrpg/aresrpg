// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }
import { mock_funding } from '../support/funding.ts'

test('funding is three choices and external payment links leave the game wallet visible', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('li.quest')) requests.push(request.url())
  })
  await page.goto('/e2e/fixtures/add_funds.html')
  const options = page.getByRole('group', { name: 'How would you like to pay?' })
  await expect(options.getByRole('button')).toHaveCount(3)
  await expect(page.getByText(`0x${'11'.repeat(32)}`, { exact: true }).first()).toBeVisible()
  await options.getByRole('button', { name: 'Card / PayPal', exact: false }).click()
  await expect(page.getByRole('link', { name: 'MoonPay', exact: true })).toHaveAttribute(
    'href',
    'https://www.moonpay.com/buy/sui'
  )
  await expect(page.getByRole('link', { name: 'Transak', exact: true })).toBeVisible()
  expect(requests).toEqual([])
})

test('testnet offers only the faucet and never mounts a mainnet bridge', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?testnet')
  await expect(page.getByRole('link', { name: 'Open Sui Faucet' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Bridge deposit/ })).toHaveCount(0)
  await expect(page.locator('[data-bridge-funding]')).toHaveCount(0)
})

for (const width of [1280, 390])
  test(`bridge keeps the game recipient when an external wallet connects at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await mock_funding(page)
    const policy = deployment.headers
      .flatMap(({ headers }) => headers)
      .find(({ key }) => key === 'Content-Security-Policy')!.value
    await page.route('**/e2e/fixtures/add_funds.html', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
    })
    await page.goto('/e2e/fixtures/add_funds.html')
    await page.getByRole('button', { name: /Bridge deposit/ }).click()
    const bridge = page.locator('[data-bridge-funding]')
    // The lazy vendor widget gets a bounded startup budget on cold CI runners.
    await expect(bridge.getByText('SUI', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click()
    await page.getByText('Fixture wallet', { exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-wallet-calls', /eth_requestAccounts/)
    await expect(page.getByRole('dialog', { name: 'Select a wallet', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-bridge-recipient]')).toHaveText(`0x${'11'.repeat(32)}`)
    await expect(bridge.getByRole('button', { name: /Send to wallet/ })).toContainText(/0x1+.*1+/)
    await expect(bridge.getByRole('button', { name: /To SUI/ })).toBeVisible()
    expect(await page.locator('html').getAttribute('data-wallet-calls')).not.toMatch(/sign|sendTransaction/)
    await bridge.evaluate((element) => element.setAttribute('data-instance', 'retained'))
    await page.getByRole('button', { name: /Direct deposit/ }).click()
    await page.getByRole('button', { name: /Bridge deposit/ }).click()
    await expect(bridge).toHaveAttribute('data-instance', 'retained')
    expect(
      await page
        .getByRole('dialog', { name: 'Add Funds', exact: true })
        .evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Switch recipient', exact: true }).click()
    await page.getByRole('button', { name: 'Open funding', exact: true }).click()
    await page.getByRole('button', { name: /Bridge deposit/ }).click()
    await expect(page.locator('[data-bridge-recipient]')).toHaveText(`0x${'22'.repeat(32)}`)
  })

test('a bridge chunk failure leaves direct deposits usable', async ({ page }) => {
  await page.route('**/assets/BridgeWidget-*.js', (route) => route.abort())
  await page.goto('/e2e/fixtures/add_funds.html')
  await page.getByRole('button', { name: /Bridge deposit/ }).click()
  await expect(page.getByRole('alert')).toContainText('The bridge could not load')
  await page.getByRole('button', { name: /Direct deposit/ }).click()
  await expect(
    page
      .getByRole('button')
      .filter({ hasText: `0x${'11'.repeat(32)}` })
      .first()
  ).toBeVisible()
})

test('a funding dialog chunk failure still exposes the direct deposit address', async ({ page }) => {
  await page.route('**/assets/FundingDialog-*.js', (route) => route.abort())
  await page.goto('/e2e/fixtures/add_funds.html')
  await expect(page.getByRole('alert')).toContainText('The bridge could not load')
  await expect(page.getByRole('button').filter({ hasText: `0x${'11'.repeat(32)}` })).toBeVisible()
})

test.describe('mobile bridge scrolling', () => {
  test.use({ hasTouch: true, isMobile: true })

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 390, height: 800 },
  ])
    for (const warning of [false, true])
      test(`touch scroll reaches bridge controls at ${viewport.width}px, warning=${warning}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await mock_funding(page)
        await page.goto(`/e2e/fixtures/add_funds.html${warning ? '?warning' : ''}`)
        await page.getByRole('button', { name: /Bridge deposit/ }).tap()
        const bridge = page.locator('[data-bridge-funding]')
        await expect(bridge.getByText('SUI', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
        const panel = page.locator('.aui-funding-detail:not([hidden])')
        const bounds = (await panel.boundingBox())!
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
        const cdp = await page.context().newCDPSession(page)
        const x = bounds.x + bounds.width / 2
        const y = bounds.y + bounds.height - 20
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] })
        for (let step = 1; step <= 5; step++) {
          await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ id: 1, x, y: y - step * 25 }],
          })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
        await bridge.getByRole('button', { name: 'Connect wallet', exact: true }).first().tap()
        await page.getByText('Fixture wallet', { exact: true }).tap()
        await expect(page.locator('html')).toHaveAttribute('data-wallet-calls', /eth_requestAccounts/)
      })
})
