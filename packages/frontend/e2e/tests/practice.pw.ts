// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

// The production game document, its practice surface, renderer, controls and local result lifecycle.
test('practice plays a local bot turn and returns to its bracket without connecting a wallet or server', async ({
  page,
}) => {
  // CI renders the stage in software: a green run took 48.8s against the suite's 60s, and a slower runner missed the
  // 30s stage load. This one test loads the whole game, so it has its own budget.
  test.setTimeout(180_000)
  const sockets: string[] = []
  const errors: string[] = []
  page.on('websocket', (socket) => sockets.push(socket.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('ares_language', 'en'))
  // A hero's practice opens as the game does: its character rides the history entry into /world/practice.
  await page.goto('/llms.txt')
  await page.evaluate(() => {
    history.pushState({ practice_source: { name: 'Hero', classe: 'senshi', level: 30n } }, '', '/world/practice')
    location.reload()
  })
  await expect(page).toHaveURL(/\/world\/practice$/)
  await expect(page.getByText('LOCAL PRACTICE · 1v1', { exact: true })).toBeVisible({ timeout: 30_000 })
  // The world's loading window covers the bracket until the stage has loaded, as it does for a player.
  await expect(page.locator('dialog.loading-modal[open]')).toHaveCount(0, { timeout: 90_000 })
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
