// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('native dialogs own focus, unwind nesting and prevent terminal dismissal', async ({ page }) => {
  await page.goto('/e2e/fixtures/interaction.html')
  // Native dialogs restore prior focus; pointer focus differs between browsers.
  await page.getByRole('button', { name: 'Open wallet', exact: true }).focus()
  await page.getByRole('button', { name: 'Open wallet', exact: true }).press('Enter')
  const wallet = page.getByRole('dialog', { name: 'Wallet', exact: true })
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab')
    // Native Tab may visit browser chrome (body is then active), but never the inert page.
    expect(
      await wallet.evaluate(
        (dialog) => dialog.contains(document.activeElement) || document.activeElement === document.body
      )
    ).toBe(true)
  }
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[aria-label=Friends]')!.focus())
  await expect(page.getByRole('textbox', { name: 'Friends', exact: true })).not.toBeFocused()
  await page.getByRole('button', { name: 'Fund account', exact: true }).focus()
  await page.getByRole('button', { name: 'Fund account', exact: true }).press('Enter')
  await expect(page.getByRole('dialog', { name: 'Testnet SUI', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Testnet SUI', exact: true })).toHaveCount(0)
  await expect(wallet).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fund account', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Fund account', exact: true }).press('Enter')
  const funding = page.getByRole('dialog', { name: 'Testnet SUI', exact: true })
  await funding.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(funding).toHaveCount(0)
  await expect(wallet).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fund account', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open wallet', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Terminal operation' })).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
})

test('editing, shadow focus and modal ownership reject world shortcuts', async ({ page }) => {
  await page.goto('/e2e/fixtures/interaction.html')
  await page.getByRole('textbox', { name: 'Friends', exact: true }).fill('wasdxt')
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: 'Friends', exact: true }).press('KeyW')
  await page.getByLabel('Chat', { exact: true }).click()
  await page.keyboard.type('wasdxt')
  await page.evaluate(() => {
    const host = document.createElement('div')
    document.body.append(host)
    const input = document.createElement('input')
    host.attachShadow({ mode: 'open' }).append(input)
    input.focus()
  })
  await page.keyboard.type('wasdxt ')
  await expect(page.getByLabel('World keys')).toHaveText('')
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click()
  await page.keyboard.press('KeyW')
  await expect(page.getByLabel('World keys')).toHaveText('')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.keyboard.press('KeyW')
  await expect(page.getByLabel('World keys')).toHaveText('KeyW,')
})
