// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { mock_funding } from '../support/funding.ts'

for (const [payer, address] of [
  ['human', '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f'],
  ['multisig', null],
] as const) {
  test(`agent gas refusal reuses funding for the ${payer} payer without sending funds`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/agent_pairing.html?funding=${payer}`)
    await page.getByRole('button', { name: 'Return character', exact: true }).click()
    const funding = page.locator('[data-add-funds]')
    await expect(funding).toBeVisible()
    await expect(funding).toContainText(address ?? (await page.locator('html').getAttribute('data-funding-pairing'))!)
    await expect(page.locator('[data-agent-transfer-review]')).toHaveCount(0)
  })
}

test('Recall native SUI checkout authorizes the verified multisig outside spectator mode', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?funding=multisig')
  await page.getByRole('button', { name: 'Return character', exact: true }).click()
  await page.getByRole('textbox', { name: /^Amount to add/ }).fill('0.1')
  await page.getByRole('button', { name: 'Pay 0.1 SUI', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fake-payment')
  const payment = JSON.parse((await page.locator('html').getAttribute('data-fake-payment'))!)
  expect(payment).toEqual({
    address: await page.locator('html').getAttribute('data-funding-pairing'),
    amount: '100000000',
  })
})
test('Recall account replacement during funding preflight prevents submission', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?funding=multisig&slow_estimate')
  await page.getByRole('button', { name: 'Return character', exact: true }).click()
  await page.getByRole('textbox', { name: /^Amount to add/ }).fill('0.1')
  await page.getByRole('button', { name: 'Pay 0.1 SUI', exact: true }).click()
  await page.evaluate(() => {
    dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 }))
    dispatchEvent(new Event('fixture/release_estimate'))
  })
  await expect(page.locator('[data-add-funds]')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-fake-payment')
})
