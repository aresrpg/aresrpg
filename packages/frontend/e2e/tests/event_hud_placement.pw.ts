// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('event cards stay beneath notifications and yield only to persistent HUD obstacles', async ({ page }) => {
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
  const notification = page.locator('[data-toasts]')
  await expect(notification).toBeVisible()
  await expect(corner).toPass()
  await expect(async () => {
    const card_box = (await cards.boundingBox())!
    const toast_box = (await notification.boundingBox())!
    const left = Math.max(card_box.x, toast_box.x)
    const right = Math.min(card_box.x + card_box.width, toast_box.x + toast_box.width)
    const top = Math.max(card_box.y, toast_box.y)
    const bottom = Math.min(card_box.y + card_box.height, toast_box.y + toast_box.height)
    expect(right).toBeGreaterThan(left)
    expect(bottom).toBeGreaterThan(top)
    expect(
      await notification.evaluate((node, point) => node.contains(document.elementFromPoint(point.x, point.y)), {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
      })
    ).toBe(true)
  }).toPass()
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

test('an open event glows for a player without a team until registration closes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?tournament=open&clock')
  const card = page.locator('.tourney-hud-card')
  await expect(card).toHaveAttribute('data-invite', 'true')
  await expect(card).toHaveCSS('animation-name', 'tourney-invite')
  const box = (await card.boundingBox())!
  await page.screenshot({
    path: test.info().outputPath('event-invite.png'),
    clip: { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 },
  })
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.locator('.tourney-hud-mobile')).toHaveAttribute('data-invite', 'true')
  await page.screenshot({ path: test.info().outputPath('event-invite-phone.png') })
  await page.goto('/e2e/fixtures/ui_world_hud.html?tournament=expired&clock')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.tourney-hud-card')).toHaveAttribute('data-invite', 'false')
  await expect(page.locator('.tourney-hud-card')).toHaveCSS('animation-name', 'none')
})
