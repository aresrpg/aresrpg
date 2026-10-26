// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('event cards use free bottom-right space and yield to notifications, resizing and the party dock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?tournament=finished')
  const cards = page.locator('.blast-sale-hud')
  await expect(page.locator('.tourney-results-card')).toBeVisible()
  await expect(page.locator('.blast-sale-card')).toBeVisible()
  const corner = async () => {
    const box = (await cards.boundingBox())!
    expect(Math.round(box.x + box.width)).toBe(1910)
    expect(Math.round(box.y + box.height)).toBe(1070)
  }
  const above_chat = async () => {
    const box = (await cards.boundingBox())!
    const chat = (await page.locator('.gw-worldchat').boundingBox())!
    expect(Math.round(box.x)).toBe(Math.round(chat.x))
    expect(Math.round(box.y + box.height)).toBe(Math.round(chat.y - 8))
  }
  await expect(corner).toPass()
  await page.screenshot({ path: test.info().outputPath('events-bottom-right.png') })
  const header = (await page.locator('.chat > header').boundingBox())!
  await page.mouse.move(header.x + 25, header.y + 20)
  await page.mouse.down()
  await page.mouse.move(header.x + 125, header.y - 60, { steps: 5 })
  await page.mouse.up()
  expect((await page.locator('.gw-worldchat').boundingBox())!.x).toBeGreaterThan(50)
  await expect(corner).toPass()
  await page.locator('[data-test-notification]').evaluate((node: HTMLButtonElement) => node.click())
  await expect(above_chat).toPass()
  await page.locator('[data-toasts] button').click()
  await expect(corner).toPass()
  await page.locator('.world-social-dock').evaluate((node: HTMLElement) => node.style.setProperty('height', '100%'))
  await expect(above_chat).toPass()
  await page.locator('.world-social-dock').evaluate((node: HTMLElement) => node.style.removeProperty('height'))
  await expect(corner).toPass()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(above_chat).toPass()
  await page.screenshot({ path: test.info().outputPath('events-above-chat.png') })
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(cards).toBeHidden()
  await expect(page.locator('.tourney-hud-mobile')).toBeVisible()
})
