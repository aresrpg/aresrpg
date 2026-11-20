// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, type Page } from '@playwright/test'

const calls = (page: Page) => page.evaluate(() => document.documentElement.dataset.calls ?? '[]')

/** The stepped fixture holds each import state until this releases it. */
const release_step = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('import-step')))

const open_connected = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/wallet_import.html${query}`)
  await page.getByRole('button', { name: 'Import characters and items' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import from another wallet' })
  await dialog.locator('[data-wallet-connect]').click()
  await page.getByRole('button', { name: 'Slush' }).click()
  return dialog
}

test('an unfunded game wallet opens the funding window before the source wallet signs', async ({ page }) => {
  const dialog = await open_connected(page, '?unfunded')
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.locator('[data-funding]')).toHaveText('42000000')
  await expect(dialog.getByRole('alert')).toContainText('Your game wallet needs more SUI to receive these assets.')
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
  expect(await calls(page)).toBe('["read"]')
})

test('a source wallet without gas is named with the amount and nothing is funded by the game', async ({ page }) => {
  const dialog = await open_connected(page, '?source_gas')
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Slush needs about 0.031 SUI for network fees.')
  await expect(page.locator('[data-funding]')).toHaveText('')
})

test('a failure after the offer says nothing is lost and offers only a new wallet check', async ({ page }) => {
  const dialog = await open_connected(page, '?fail')
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(dialog).toContainText('Nothing is lost. Check the wallet again to finish the import.')
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Check the wallet again' }).click()
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
  expect(await calls(page)).toBe('["read","import","read"]')
})

test('an empty wallet offers no import', async ({ page }) => {
  const dialog = await open_connected(page, '?empty&listed')
  await expect(dialog).toContainText('This wallet has no characters or items to import.')
  await expect(dialog).toContainText('Assets left in the wallet because they are on sale: 3.')
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
})

test('the summary states the fee, a double click imports once and the window cannot close mid-run', async ({
  page,
}) => {
  const dialog = await open_connected(page, '?roster&stepped')
  await expect(dialog).toContainText('0.042 SUI')
  await expect(dialog).toContainText('Characters left in the wallet because your roster is full: 2')
  await dialog.getByRole('button', { name: 'Import', exact: true }).dblclick()
  await expect(dialog).toContainText('Approve the request in Slush.')
  await page.keyboard.press('Escape')
  await expect(dialog).toContainText('Approve the request in Slush.')
  await release_step(page)
  await expect(dialog).toContainText('Moved 20 of 42')
  await release_step(page)
  await expect(dialog).toContainText('Characters and items moved: 42.')
  expect(await calls(page)).toBe('["read","import"]')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
})
