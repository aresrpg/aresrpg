// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

// Exercise the production entry, observer registry, renderer, controls and local result lifecycle.
test('practice plays a local bot turn and returns to its bracket without connecting a wallet or server', async ({
  page,
}, info) => {
  const sockets: string[] = []
  const errors: string[] = []
  page.on('websocket', (socket) => sockets.push(socket.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('ares_language', 'en')
  })
  await page.goto('/e2e/fixtures/tournament.html?hud&scenario=open_funded')
  await page.getByRole('button', { name: 'Open Autumn Championship tournament', exact: true }).first().click()
  await page.getByRole('button', { name: 'Practice for free', exact: true }).click()
  await expect(page).toHaveURL(/\/practice$/)
  await expect(page.getByText('LOCAL PRACTICE · 1v1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play next match', exact: true }).click({ trial: true })
  await page.screenshot({ path: info.outputPath('practice-bracket.png') })
  await page.getByRole('button', { name: 'Play next match', exact: true }).click()
  const end_turn = page.getByRole('button', { name: 'End turn', exact: true })
  await expect(end_turn).toBeEnabled({ timeout: 30_000 })
  await end_turn.click()
  await expect(end_turn).toBeDisabled()
  await expect(end_turn).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Forfeit', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm forfeit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You were eliminated', exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play next match', exact: true })).toBeVisible()
  expect(sockets).toEqual([])
  expect(errors).toEqual([])
})
