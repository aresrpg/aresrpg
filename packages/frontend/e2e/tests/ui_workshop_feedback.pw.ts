// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('tutorial tips are compact, non-blocking, and follow character modals', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?tutorial')
  const tip = page.locator('.tutorial-tip')
  await expect(tip).toContainText('1 / 3')
  expect((await tip.boundingBox())!.width).toBeLessThanOrEqual(320)
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0)
  await tip.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(tip).toContainText('Your HUD')
  await tip.getByRole('button', { name: 'Skip tutorial' }).click()
  await expect(tip).toHaveCount(0)
  await page.getByRole('button', { name: 'Equipment', exact: true }).click()
  await expect(tip).toContainText('choose Equip')
  await expect.poll(() => tip.evaluate((node) => !!node.closest('dialog'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await expect(page.locator('[data-character-panel="equipment"]')).toBeVisible()
})

test('inventory hover shows stats in bounds without recipes and fills each row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/fight_result.html?equipment')
  const grid = page.locator('.chr-equip__grid')
  await expect(grid).toBeVisible()
  const gap = await grid.evaluate((node) => {
    const cells = [...node.querySelectorAll('.chr-cell')].map((cell) => cell.getBoundingClientRect())
    const { top } = cells[0]!
    const right = Math.max(...cells.filter((cell) => Math.abs(cell.top - top) < 1).map((cell) => cell.right))
    return node.getBoundingClientRect().right - right
  })
  expect(gap).toBeLessThan(12)
  const cell = page.locator('[data-selection-id="zukin_muru"]')
  await cell.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toContainText('350')
  await expect(tooltip).not.toContainText('Ingredients')
  const bounds = (await tooltip.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440)
  await cell.click()
  await expect(tooltip).toHaveCount(0)
  await expect(page.locator('.chr-equip__detail')).toBeVisible()
})

test('marketplace own listings scroll independently and the compass retains its width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?listings')
  await expect(page.locator('.gw-compass-wrap')).toBeVisible()
  expect((await page.locator('.gw-compass-wrap').boundingBox())!.width).toBeGreaterThan(600)
  await page.locator('[data-hud-page="marketplace"]').click()
  await page.getByRole('button', { name: 'I understand', exact: true }).click()
  await page.getByRole('button', { name: 'Sell', exact: true }).click()
  const list = page.locator('.market-own-listings > div')
  await expect(list.locator('button').last()).toBeAttached()
  await list.hover()
  await page.mouse.wheel(0, 2000)
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(500)
  expect(await list.evaluate((node) => node.clientHeight < node.scrollHeight)).toBe(true)
})

test('Admin shows six wide charts without scrolling at desktop size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Admin', exact: true }).click()
  const charts = page.locator('[data-admin-charts]')
  await expect(charts.getByRole('img')).toHaveCount(6)
  expect(await charts.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1)
  const plot = (await charts.getByRole('img').first().boundingBox())!
  expect(plot.width).toBeGreaterThan(plot.height * 2)
})

test('Send SUI uses padded shared controls and keeps an incomplete transfer disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-wallet-trigger]').click()
  await page.locator('.wallet-popover').getByRole('button', { name: 'Send', exact: true }).click()
  const form = page.locator('.aui-send-window')
  await expect(form).toBeVisible()
  const body = form.locator('.aui-send-body')
  expect(await body.evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft))).toBeGreaterThanOrEqual(16)
  const next = form.getByRole('button', { name: 'Continue', exact: true })
  await expect(next).toBeDisabled()
  await expect(next).toHaveClass(/aui-button--primary/)
  await form.getByRole('button', { name: 'MAX', exact: true }).click()
  await expect(next).toBeDisabled()
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(form).toHaveCount(0)
})

test('drop quantities align with their percentages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="encyclopedia"]').click()
  await page.getByRole('searchbox').fill('Crowani Scale')
  await page.locator('.aui-collection-tile[title="Crowani Scale"]').click()
  const rate = page.locator('.aui-item-source-row strong').filter({ hasText: '%' }).first()
  await expect(rate).toBeVisible()
  const difference = await rate.evaluate((node) => {
    const quantity = node.querySelector('small')!
    const chance_range = document.createRange(),
      quantity_range = document.createRange()
    chance_range.setStart(node, 0)
    chance_range.setEndBefore(quantity)
    quantity_range.selectNodeContents(quantity)
    return Math.abs(chance_range.getBoundingClientRect().right - quantity_range.getBoundingClientRect().right)
  })
  expect(difference).toBeLessThan(1)
})
