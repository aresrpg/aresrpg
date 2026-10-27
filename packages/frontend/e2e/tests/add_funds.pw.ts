// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }
import { mock_funding } from '../support/funding.ts'
import { solana_rpc_result } from '../../test/wallet/fixtures/solana_rpc.ts'

const recipient = `0x${'11'.repeat(32)}`

test.beforeEach(async ({ page }) => mock_funding(page))

test('manual top-up shows the address and connection before asking a funded player for an amount', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/e2e/fixtures/add_funds.html?funded')
  await expect(page.getByRole('button').filter({ hasText: recipient })).toBeVisible()
  await page.getByRole('button').filter({ hasText: recipient }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(recipient)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toHaveCount(0)
  await expect(page.locator('details')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Privy', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'MoonPay', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Slush/ }).click()
  await expect(page.getByRole('dialog', { name: 'External wallet', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toBeVisible()
  await expect(page.locator('[data-add-funds]')).toBeVisible()
})

test('address-first funding shows the minimum with USD and keeps card links', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html')
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toHaveCount(0)
  await expect(page.locator('[data-funding-minimum]')).toContainText('1.20 SUI (≈$1.20)')
  await expect(page.getByRole('link', { name: 'MoonPay', exact: true })).toHaveAttribute(
    'href',
    'https://www.moonpay.com/buy/sui'
  )
  await expect(page.getByRole('link', { name: 'Transak', exact: true })).toBeVisible()
  await expect(page.getByText(recipient, { exact: true })).toBeVisible()
})

test('a funded player chooses any deposit amount after connecting', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?funded&connected')
  await expect(page.locator('[data-funding-minimum]')).toHaveCount(0)
  const amount = page.getByRole('textbox', { name: 'Amount to add' })
  await expect(amount).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Pay 0 SUI' })).toBeDisabled()
  await amount.fill('0.05')
  await expect(page.locator('[data-funding-checkout]')).toContainText('≈$0.05')
  await page.getByRole('button', { name: 'Pay 0.05 SUI' }).click()
  await expect(page.getByRole('status')).toContainText('0.05 SUI delivered')
  await expect(amount).toHaveCount(0)
  expect(JSON.parse((await page.locator('html').getAttribute('data-payment'))!)).toEqual({
    address: recipient,
    amount: '50000000',
  })
})

test('a preset amount fills the deposit, and delivery closes the window after showing success', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?funded&connected')
  await page.getByRole('button', { name: '5', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toHaveValue('5')
  await page.getByRole('button', { name: 'Pay 5 SUI' }).click()
  await expect(page.getByRole('status')).toContainText('retry your game action')
  await expect(page.getByRole('button', { name: 'Back to game' })).toBeVisible()
  await expect(page.locator('[data-add-funds]')).toHaveCount(0, { timeout: 8_000 })
  await expect(page.getByRole('button', { name: 'Open funding' })).toBeVisible()
})

test('adding more after delivery keeps the window open with a fresh form', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?funded&connected')
  await page.getByRole('textbox', { name: 'Amount to add' }).fill('1')
  await page.getByRole('button', { name: 'Pay 1 SUI' }).click()
  await page.getByRole('button', { name: 'Add more' }).click()
  await page.waitForTimeout(6_000)
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toBeEnabled()
})

test('an empty game balance shows only the comfortable-play minimum in SUI and USD', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?fees')
  await expect(page.locator('[data-funding-minimum]')).toHaveText('For comfortable play: 0.20 SUI (≈$0.20).')
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toHaveCount(0)
})

test('a Sui source shows its SUI balance and refuses an amount it cannot cover before any simulation', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/add_funds.html?connected')
  await expect(page.getByRole('radio', { name: /SUI/ })).toBeChecked()
  await expect(page.getByRole('radiogroup', { name: 'Pay with' })).toContainText('10')
  await page.getByRole('textbox', { name: 'Amount to add' }).fill('20')
  await expect(page.getByRole('alert')).toContainText('does not have enough')
  await expect(page.getByRole('button', { name: 'Pay 20 SUI' })).toBeDisabled()
  await expect(page.locator('html')).not.toHaveAttribute('data-preflight')
})

test('testnet offers only the faucet', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?testnet')
  await expect(page.getByRole('link', { name: 'Open Sui Faucet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'MoonPay', exact: true })).toHaveCount(0)
})

for (const width of [1280, 390])
  test(`direct SUI funding pays the Google wallet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/e2e/fixtures/add_funds.html?connected')
    await expect(page.getByRole('button', { name: 'Pay 1.2 SUI' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('funding.png') })
    await page.getByRole('button', { name: 'Pay 1.2 SUI' }).click()
    await expect(page.getByRole('status')).toContainText('retry your game action')
    const payment = JSON.parse((await page.locator('html').getAttribute('data-payment'))!)
    expect(payment).toEqual({ address: recipient, amount: '1200000000' })
    expect(
      await page.locator('[data-add-funds]').evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1)
  })

test('cross-chain quote fixes native SUI and the Google recipient under production CSP', async ({ page }) => {
  await mock_funding(page)
  const policy = deployment.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy')!.value
  await page.route('**/e2e/fixtures/add_funds.html?**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto')
  await expect(page.getByRole('radio', { name: /USDC/ })).toBeChecked()
  const quote = page.waitForRequest('https://1click.chaindefuser.com/v0/quote')
  await page.getByRole('button', { name: 'Review payment' }).click()
  expect((await quote).postDataJSON()).toMatchObject({
    recipient,
    destinationAsset: 'nep141:sui.omft.near',
    amount: '1200000000',
    slippageTolerance: 0,
  })
  await page.getByRole('button', { name: 'Pay 1.3 USDC' }).click()
  await expect(page.getByRole('status')).toContainText('1.2 SUI delivered')
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuetext')
  expect(JSON.parse((await page.locator('html').getAttribute('data-payment'))!)).toEqual({
    address: `0x${'55'.repeat(20)}`,
    amount: '1300000',
  })
  await expect(page.locator('html')).toHaveAttribute('data-payment-count', '1')
})

for (const [status, step, line] of [
  ['KNOWN_DEPOSIT_TX', 'Deposit', 'Confirming your payment on Base'],
  ['PROCESSING', 'Bridge', 'Bridging to Sui'],
] as const)
  test(`a ${status} transfer shows its live ${step} step and time left, never an early success`, async ({ page }) => {
    await mock_funding(page, status)
    await page.goto('/e2e/fixtures/add_funds.html?connected&crypto')
    await expect(page.getByRole('radio', { name: /USDC/ })).toBeChecked()
    await page.getByRole('button', { name: 'Review payment' }).click()
    await page.getByRole('button', { name: 'Pay 1.3 USDC' }).click()
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', step)
    await expect(page.getByRole('status')).toContainText(line)
    await expect(page.getByRole('status')).toContainText(/~\d+ s left/)
    await expect(page.getByRole('button', { name: 'Back to game' })).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-payment-count', '1')
  })

test('uncertain source submission cannot be resent from the same checkout', async ({ page }) => {
  await mock_funding(page, 'PENDING_DEPOSIT')
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto&uncertain')
  await expect(page.getByRole('radio', { name: /USDC/ })).toBeChecked()
  await page.getByRole('button', { name: 'Review payment' }).click()
  await page.getByRole('button', { name: 'Pay 1.3 USDC' }).click()
  await expect(page.getByRole('alert')).toContainText('unknown')
  await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Amount to add' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'MoonPay', exact: true })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-payment-count', '1')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open funding' })).toBeVisible()
})

test('wallet rejection restores review without reporting payment success', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?connected&reject')
  await page.getByRole('button', { name: 'Pay 1.2 SUI' }).click()
  await expect(page.getByRole('alert')).toContainText('could not complete')
  await expect(page.getByRole('button', { name: 'Pay 1.2 SUI' })).toBeEnabled()
  await expect(page.getByText('delivered', { exact: false })).toHaveCount(0)
})

test('funding suspends and restores the original action dialog', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?underlying')
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Character name' })).toHaveValue('Preserved name')
})

test('a funding chunk failure still exposes the direct deposit address', async ({ page }) => {
  await page.route('**/assets/FundingDialog-*.js', (route) => route.abort())
  await page.goto('/e2e/fixtures/add_funds.html')
  await expect(page.getByRole('alert')).toContainText('Funding could not complete')
  await expect(page.getByRole('button').filter({ hasText: recipient })).toBeVisible()
})

test('a provider portal accepts keyboard input and restores funding on close', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?underlying&picker')
  await page.getByRole('button', { name: 'Open provider', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Wallet search' })
  await search.click()
  await expect(search).toBeFocused()
  await page.keyboard.type('Phantom')
  await expect(search).toHaveValue('Phantom')
  await page.getByRole('button', { name: 'Close provider' }).click()
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Character name' })).toHaveValue('Preserved name')
})

test('the shared wallet picker remains interactive above funding and restores focus', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/add_funds.html?underlying&picker')
  const connect = page.getByRole('button', { name: 'Connect wallet', exact: true })
  await connect.click()
  const picker = page.getByRole('dialog', { name: 'External wallet', exact: true })
  await expect(picker).toBeVisible()
  // React StrictMode replays the native dialog's close/show lifecycle in development.
  // Its synthetic close event must not dismiss the parent funding dialog.
  await picker.evaluate((dialog: HTMLDialogElement) => {
    dialog.close()
    dialog.showModal()
  })
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
  await picker.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
  await expect(connect).toBeFocused()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Character name' })).toHaveValue('Preserved name')
  expect(errors).toEqual([])
})

test('closing funding during preparation never opens a later signing request', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?connected&slow')
  await page.getByRole('button', { name: 'Pay 1.2 SUI' }).click()
  await expect(page.getByRole('status')).toContainText('Checking funds')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('release-estimate')))
  await expect(page.locator('html')).toHaveAttribute('data-preflight', 'finished')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  await expect(page.locator('html')).not.toHaveAttribute('data-payment')
})

test('disconnecting the source after submission does not hide transfer completion', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto&disconnect')
  await expect(page.getByRole('radio', { name: /USDC/ })).toBeChecked()
  await page.getByRole('button', { name: 'Review payment' }).click()
  await page.getByRole('button', { name: 'Pay 1.3 USDC' }).click()
  await expect(page.getByRole('status')).toContainText('1.2 SUI delivered')
  await expect(page.locator('html')).toHaveAttribute('data-payment-count', '1')
})

for (const token of [false, true]) {
  test(`Solana ${token ? 'SPL' : 'SOL'} connects and funds in a browser without Node globals`, async ({ page }) => {
    await page.route('**/api/solana', async (route) => {
      const { method, id } = route.request().postDataJSON() as { method: string; id: string }
      await route.fulfill({ json: { jsonrpc: '2.0', id, result: solana_rpc_result(method) } })
    })
    await page.goto(`/e2e/fixtures/solana_funding.html${token ? '?token' : ''}`)
    expect(await page.evaluate(() => 'Buffer' in globalThis)).toBe(false)
    await page.getByRole('button', { name: 'Connect Solana' }).click()
    await expect(page.locator('#result')).toHaveText('Sent')
    await expect(page.locator('html')).toHaveAttribute('data-balance', token ? '1300000' : '10000000000')
    expect(await page.locator('html').getAttribute('data-transaction')).toBeTruthy()
    expect(await page.evaluate(() => 'Buffer' in globalThis)).toBe(false)
  })
}

test('funding lists only held supported tokens with balances', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto')
  const picker = page.getByRole('radiogroup', { name: 'Pay with' })
  await expect(picker.getByRole('radio')).toHaveCount(1)
  await expect(picker).toContainText('USDC')
  await expect(picker).not.toContainText('ZERO')
  await expect(picker).toContainText('100')
})

test('an empty source wallet is distinct from a failed balance read', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto&empty')
  await expect(page.getByRole('status')).toContainText('No supported tokens with a positive balance')
  await expect(page.getByRole('radiogroup', { name: 'Pay with' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review payment' })).toBeDisabled()
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto&balances-fail')
  await expect(page.getByRole('alert')).toContainText('Some balances could not be loaded')
  await expect(page.getByText('No supported tokens with a positive balance', { exact: false })).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('funding-balances-ready')))
  await page.getByRole('button', { name: 'Refresh balances' }).click()
  await expect(page.getByRole('radio', { name: /USDC/ })).toBeChecked()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('disconnecting Solana waits for the provider before reopening Privy', async ({ page }) => {
  await page.goto('/e2e/fixtures/add_funds.html?connected&crypto&solana&intent&slow-disconnect')
  await expect(page.locator('[data-selected-family]')).toHaveAttribute('data-selected-family', 'solana')
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('button', { name: 'Disconnect Slush', exact: true }).click()
  await expect(page.locator('[data-selected-family]')).toHaveAttribute('data-selected-family', '')
  const privy = page.getByRole('button', { name: 'Privy', exact: true })
  await expect(privy).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('release-wallet-disconnect')))
  await expect(privy).toBeEnabled()
  await privy.click()
  await expect(page.locator('[data-selected-family]')).toHaveAttribute('data-selected-family', 'evm')
})
