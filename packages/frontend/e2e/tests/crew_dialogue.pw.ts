// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('the crew talk prompt opens only its reward and the existing wallet picker', async ({ page }, test_info) => {
  await page.goto('/e2e/fixtures/crew_dialogue.html')
  await expect(page.getByRole('button', { name: /Talk to Blast Girl/ })).toBeVisible()
  await page.keyboard.press('f')
  const dialog = page.locator('dialog[open]').first()
  await expect(dialog.locator('[data-crew-dialogue]')).toBeVisible()
  const window_box = await dialog.locator('.aui-window').boundingBox()
  expect(window_box!.width).toBeLessThanOrEqual(620)
  expect(Math.abs(window_box!.x + window_box!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2)
  await expect(dialog.locator('[data-airdrop]')).toHaveCount(1)
  await expect(dialog.locator('[data-airdrop="blast_crew"]')).toBeVisible()
  await expect(dialog.locator('.airdrop-claims')).toHaveCount(0)
  await expect(dialog.locator('.airdrop-intro')).toHaveCount(0)
  await expect(dialog.getByText('Crew Helmet', { exact: true }).first()).toBeVisible()
  await expect(dialog.locator('[data-crew-dialogue] img').first()).toHaveJSProperty('naturalWidth', 512)
  await test_info.attach('crew-dialogue', { body: await page.screenshot(), contentType: 'image/png' })
  await dialog.getByRole('button', { name: /connect/i }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(2)
})

test('the crew portrait and existing connect button remain usable on a short screen', async ({ page }, test_info) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/crew_dialogue.html')
  await page.getByRole('button', { name: /Talk to Blast Girl/ }).click()
  const dialog = page.locator('dialog[open]').first()
  const header = dialog.locator('[data-crew-dialogue]')
  const portrait = header.locator('img').first()
  await expect(portrait).toHaveJSProperty('naturalWidth', 512)
  const container_box = await header.boundingBox()
  const portrait_box = await portrait.boundingBox()
  expect(portrait_box!.y + portrait_box!.height).toBeLessThanOrEqual(container_box!.y + container_box!.height)
  await expect(dialog.getByRole('button', { name: /connect/i })).toBeVisible()
  await test_info.attach('crew-dialogue-short', { body: await page.screenshot(), contentType: 'image/png' })
})
