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
    await page.getByRole('button', { name: 'Check transaction', exact: true }).click()
    const funding = page.locator('[data-add-funds]')
    await expect(funding).toBeVisible()
    await expect(funding).toContainText(address ?? (await page.locator('html').getAttribute('data-funding-pairing'))!)
    await expect(page.locator('[data-agent-transfer-review]')).toContainText('No valid gas coins')
  })
}

test('inventory selection preserves the chosen items, source kiosks, exact amounts and editable gas reserve', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/agent_pairing.html?inventory')
  const inventory = page.locator('[data-agent-inventory]')
  await inventory.getByRole('button', { name: 'Refresh inventory', exact: true }).click()
  await inventory.getByRole('button', { name: 'Available wool', exact: true }).click()
  await expect(inventory.getByRole('button', { name: 'Listed wool', exact: true })).toBeDisabled()
  await inventory.getByRole('button', { name: 'Check transaction', exact: true }).click()
  let reviewed = JSON.parse((await page.locator('html').getAttribute('data-inventory-review'))!)
  expect(reviewed.items).toEqual([{ item_id: 'available-item', kiosk: 'first-kiosk', version: '1' }])
  expect(reviewed.sui_mist).toBe('0')
  expect(reviewed.kares_mist).toBe('0')
  expect(reviewed.reserve_mist).toBe('50000000')
  await inventory.getByLabel('SUI amount', { exact: true }).fill('0.000000001')
  await inventory.getByLabel('KARES amount', { exact: true }).fill('2.5')
  await inventory.getByLabel('SUI to retain after fees', { exact: true }).fill('0')
  await inventory.getByRole('button', { name: 'Check transaction', exact: true }).click()
  reviewed = JSON.parse((await page.locator('html').getAttribute('data-inventory-review'))!)
  expect(reviewed.sui_mist).toBe('1')
  expect(reviewed.kares_mist).toBe('2500000000')
  expect(reviewed.reserve_mist).toBe('0')
  await expect(inventory).toContainText('0.000000001')
  await expect(inventory).toContainText('2.500000000')
  await expect(inventory).toContainText('first-kiosk')
})

test('a damaged incoming return cannot hide unrelated inventory and token recovery', async ({ page }) => {
  await page.goto('/e2e/fixtures/agent_pairing.html?inventory&incoming_failure')
  const inventory = page.locator('[data-agent-inventory]')
  await inventory.getByRole('button', { name: 'Refresh inventory', exact: true }).click()
  await expect(inventory.getByRole('alert')).toContainText('Incoming equipment capability is missing')
  await expect(inventory.getByRole('button', { name: 'Available wool', exact: true })).toBeVisible()
  await inventory.getByLabel('SUI amount', { exact: true }).fill('0.1')
  await inventory.getByRole('button', { name: 'Check transaction', exact: true }).click()
  const reviewed = JSON.parse((await page.locator('html').getAttribute('data-inventory-review'))!)
  expect(reviewed.items).toEqual([])
  expect(reviewed.sui_mist).toBe('100000000')
  await expect(inventory).not.toContainText('Claim selected items:')
})

test('Recall native SUI checkout authorizes the verified multisig outside spectator mode', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?funding=multisig')
  await page.getByRole('button', { name: 'Check transaction', exact: true }).click()
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
  await page.getByRole('button', { name: 'Check transaction', exact: true }).click()
  await page.getByRole('textbox', { name: /^Amount to add/ }).fill('0.1')
  await page.getByRole('button', { name: 'Pay 0.1 SUI', exact: true }).click()
  await page.evaluate(() => {
    dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 }))
    dispatchEvent(new Event('fixture/release_estimate'))
  })
  await expect(page.locator('[data-add-funds]')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-fake-payment')
})
