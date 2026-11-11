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

test('failed Send funds the agent and explicit retry after reload claims the existing gear offer', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?send_failure&character&funding=multisig')
  await page.getByRole('button', { name: 'Send character', exact: true }).click()
  const funding = page.locator('[data-add-funds]')
  await expect(funding).toBeVisible()
  await expect(funding).toContainText('Your agent needs some SUI to play.')
  await expect(funding).toContainText((await page.locator('html').getAttribute('data-funding-pairing'))!)
  await expect(page.locator('html')).toHaveAttribute('data-fixture-offers', '1')
  await expect(page.locator('html')).toHaveAttribute('data-fixture-claims', '0')
  await page.keyboard.press('Escape')
  await expect(funding).toHaveCount(0)
  await page.reload()
  await expect(funding).toHaveCount(0)
  await page.getByRole('button', { name: 'Send character', exact: true }).click()
  await expect(funding).toBeVisible()
  await page.getByRole('textbox', { name: /^Amount to add/ }).fill('0.1')
  await page.getByRole('button', { name: 'Pay 0.1 SUI', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fake-payment')
  await expect(page.locator('html')).toHaveAttribute('data-fixture-claims', '0')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Send character', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fixture-claims', '1')
  await expect(page.locator('html')).toHaveAttribute('data-fixture-offers', '1')
})

for (const change of ['wallet', 'pairing'] as const)
  test(`Send funding closes on ${change} replacement and owner funding clears the agent target`, async ({ page }) => {
    await mock_funding(page)
    await page.goto('/e2e/fixtures/agent_pairing.html?send_failure&character&funding=multisig')
    await page.getByRole('button', { name: 'Send character', exact: true }).click()
    await expect(page.locator('[data-add-funds]')).toBeVisible()
    if (change === 'wallet') await page.evaluate(() => dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 })))
    else
      await page.evaluate(() => {
        document.querySelectorAll('button').forEach((button) => {
          if (button.textContent === 'Clear pairing') button.click()
        })
      })
    await expect(page.locator('[data-add-funds]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Fund owner', exact: true }).click()
    await expect(page.locator('[data-add-funds]')).toBeVisible()
    await expect(page.locator('[data-add-funds]')).not.toContainText('Your agent needs some SUI')
    await expect(page.locator('html')).not.toHaveAttribute('data-fake-payment')
  })

test('funded Send completes both synthetic steps without opening funding', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?send_failure&character&funding=multisig')
  await page.getByRole('button', { name: 'Fund synthetic agent', exact: true }).click()
  await page.getByRole('button', { name: 'Send character', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fixture-claims', '1')
  await expect(page.locator('html')).toHaveAttribute('data-fixture-offers', '1')
  await expect(page.locator('[data-add-funds]')).toHaveCount(0)
})
