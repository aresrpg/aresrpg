// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('compact chat counts filtered social messages, preserves drafts and clears unread when opened', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_hud.html')
  const toggle = page.locator('.chat__toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.chat__input')).toBeHidden()
  expect((await page.locator('.gw-worldchat').boundingBox())!.width).toBeLessThan(90)
  await page.evaluate(async () => {
    const dispatch_app = window.dispatch_hud_input
    dispatch_app({ type: 'chat/line', line: { id: 'social-1', channel: 'general', key: 'Hello', values: {} } })
    dispatch_app({
      type: 'chat/line',
      replaces: 'social-1',
      line: { id: 'correction', channel: 'general', key: 'Hello again', values: {} },
    })
    dispatch_app({
      type: 'chat/line',
      line: { id: 'combat-1', channel: 'combat', fight: 'other', key: 'Damage', values: {} },
    })
    dispatch_app({
      type: 'chat/line',
      line: { id: 'party-1', channel: 'party', party: 'other', key: 'Private group', values: {} },
    })
  })
  await expect(page.locator('.chat__unread')).toHaveText('1')
  await toggle.click()
  await expect(page.getByRole('log')).toContainText('Hello again')
  await expect(page.locator('.chat__unread')).toBeHidden()
  await page.locator('.chat__input').fill('Unsent draft')
  await toggle.click()
  await toggle.click()
  await expect(page.locator('.chat__input')).toHaveValue('Unsent draft')
  await toggle.click()
  await page.screenshot({ path: '/tmp/compact-chat-final.png' })
})

test('desktop end turn keeps one line and chat can collapse without reserving its panel space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_hud.html')
  const button = page.getByRole('button', { name: 'End turn', exact: true })
  await expect(button).toBeVisible()
  expect(await button.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('nowrap')
  expect(await button.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await expect(page.locator('.chat__toggle')).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.chat__toggle').click()
  expect((await page.locator('.gw-worldchat').boundingBox())!.height).toBeLessThanOrEqual(46)
  await page.screenshot({ path: '/tmp/desktop-end-turn-final.png' })
})
