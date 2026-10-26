// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { visit, calls, fixture } from '../fixtures/tournament_driver.ts'

const NOW = 1_900_000

test('claimed results stay above Blast for a day and reopen the correct podium', async ({ page }) => {
  await visit(page, '?hud&scenario=finished')
  await fixture(page, 'claimed')
  const results = page.locator('.tourney-results-card')
  await expect(results).toBeVisible()
  await expect(page.locator('.blast-sale-card')).toBeVisible()
  const result_box = await results.boundingBox(),
    blast_box = await page.locator('.blast-sale-card').boundingBox()
  expect(result_box!.y + result_box!.height).toBeLessThanOrEqual(blast_box!.y)
  await results.click()
  await expect(page.locator('.tourney-podium')).toBeVisible()
  expect(await fixture(page, 'state')).toMatchObject({ pathname: '/kolizeum/tournament/cup/podium' })
  await page
    .getByRole('dialog', { name: 'Kolizeum', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await fixture(page, 'clock', NOW + 86_400_000)
  await expect(results).toHaveCount(0)
  await expect(page.locator('.blast-sale-card')).toBeVisible()
})

test('a participant completion opens the podium once after blocking UI closes', async ({ page }) => {
  await visit(page, '?hud&scenario=live8')
  await fixture(page, 'busy', true)
  await fixture(page, 'finish')
  await expect(page.getByRole('dialog', { name: 'Kolizeum', exact: true })).toHaveCount(0)
  await fixture(page, 'busy', false)
  await expect(page.locator('.tourney-podium')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Tournament sections' })
    .getByRole('button', { name: 'Matches', exact: true })
    .click()
  await fixture(page, 'publish')
  await expect(page.locator('.tourney-bracket-scroll')).toBeVisible()
})

test('confirmed prizes reveal sequentially with sound cues, survive a pause, and do not replay', async ({
  page,
}, info) => {
  await visit(page, '?hud&scenario=live8&rewards')
  await fixture(page, 'finish')
  const modal = page.getByRole('dialog', { name: 'Rewards collected', exact: true })
  await expect(modal).toBeVisible()
  await expect(modal.locator('.tourney-reveal-reward[data-visible="true"]')).toHaveCount(1)
  await fixture(page, 'busy', true)
  const paused = (await fixture(page, 'state')) as { audio: number }
  await expect(modal).toHaveCount(0)
  await page.waitForTimeout(1000)
  expect(((await fixture(page, 'state')) as { audio: number }).audio).toBe(paused.audio)
  await fixture(page, 'busy', false)
  await expect(modal.locator('.tourney-reveal-reward[data-visible="true"]')).toHaveCount(3)
  await expect(modal.getByText('SUI', { exact: true })).toBeVisible()
  await expect(modal.getByText('KARES', { exact: true })).toBeVisible()
  expect(((await fixture(page, 'state')) as { audio: number }).audio).toBeGreaterThanOrEqual(3)
  const transactions = await calls(page)
  await page.screenshot({ path: info.outputPath('tournament-rewards.png') })
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await fixture(page, 'publish')
  await expect(modal).toHaveCount(0)
  expect(await calls(page)).toEqual(transactions)
  await expect(page.locator('.tourney-podium')).toBeVisible()
})

test('reduced motion reveals every prize immediately and fits landscape mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 667, height: 375 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await visit(page, '?hud&scenario=live8&rewards')
  await fixture(page, 'finish')
  const modal = page.getByRole('dialog', { name: 'Rewards collected', exact: true })
  await expect(modal.locator('.tourney-reveal-reward[data-visible="true"]')).toHaveCount(3)
  const footer = await modal.locator('footer').boundingBox()
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(375)
  await expect(modal.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('tournament-rewards-mobile.png') })
})

for (const refusal of ['failure', 'pending']) {
  test(`${refusal} claims never show collected rewards`, async ({ page }) => {
    await visit(page, `?scenario=finished&rewards&${refusal}`)
    await page.getByRole('button', { name: 'Claim coins', exact: true }).first().click()
    await expect.poll(() => calls(page)).not.toHaveLength(0)
    await expect(page.getByRole('dialog', { name: 'Rewards collected', exact: true })).toHaveCount(0)
    expect(await fixture(page, 'state')).toMatchObject({ collections: 0 })
  })
}
