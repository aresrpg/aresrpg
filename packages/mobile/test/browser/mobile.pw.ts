// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test, type Page } from '@playwright/test'

const fixture = '/e2e/fixtures/mobile.html'
const open = async (page: Page, name: string): Promise<void> => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.locator('.mobile-menu').getByRole('button', { name, exact: true }).click()
}
const close = async (page: Page): Promise<void> => {
  await page.locator('.mobile-panel-header').getByRole('button', { name: 'Close', exact: true }).click()
}

test('every management overlay retains the actual player canvas and stays within the viewport', async ({ page }) => {
  let errors: string[] = []
  page.on('pageerror', (error) => {
    errors = [...errors, error.message]
  })
  await page.goto(fixture)
  const canvas = await page.locator('[data-world-frame] > canvas').elementHandle()
  expect(canvas).not.toBeNull()
  for (const [name, selector] of [
    ['Stats', '.mobile-stats'],
    ['Equipment', '.mobile-inventory'],
    ['Spells', '.mobile-spells'],
    ['Jobs', '.mobile-jobs'],
    ['Encyclopedia', '.mobile-encyclopedia'],
    ['Marketplace', '[data-marketplace-disclaimer]'],
    ['Settings', '.mobile-settings'],
  ]) {
    await open(page, name!)
    await expect(page.locator(selector!)).toBeVisible()
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    const bounds = await page
      .locator('.mobile-panel')
      .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width)
    await expect
      .poll(() =>
        page
          .locator('.mobile-panel img')
          .evaluateAll(
            (images) =>
              images.filter(
                (image) => !(image as HTMLImageElement).complete || !(image as HTMLImageElement).naturalWidth
              ).length
          )
      )
      .toBe(0)
    await close(page)
  }
  expect(errors).toEqual([])
})

test('stat inspection and cancellation never submit; confirm submits once', async ({ page }) => {
  await page.goto(fixture)
  await open(page, 'Stats')
  await page.locator('.mobile-stat-row').filter({ hasText: 'Vitality' }).click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByRole('button', { name: 'Add a point to Vitality', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-writes', '0')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
  await page.locator('.mobile-stat-row').filter({ hasText: 'Vitality' }).click()
  await dialog.getByRole('button', { name: 'Add a point to Vitality', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).dblclick()
  await expect(page.locator('body')).toHaveAttribute('data-writes', '1')
})

test('long press survives finger release and fits every action inside the viewport', async ({ page }) => {
  await page.goto(fixture)
  await open(page, 'Equipment')
  const item = page.locator('.mobile-item-grid .chr-cell').first()
  await expect(item).toBeVisible()
  const bounds = (await item.boundingBox())!
  const pointer = { pointerId: 7, pointerType: 'touch', clientX: bounds.x + 20, clientY: bounds.y + 20 }
  await item.dispatchEvent('pointerdown', pointer)
  await expect(page.getByRole('menu')).toBeVisible()
  await item.dispatchEvent('pointerup', pointer)
  await item.dispatchEvent('click')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const menu_bounds = (await menu.boundingBox())!
  expect(menu_bounds.y).toBeGreaterThanOrEqual(0)
  expect(menu_bounds.y + menu_bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await expect(page.locator('body')).toHaveAttribute('data-writes', '0')
})

test('a locked character cannot allocate and an empty bag remains usable', async ({ page }) => {
  await page.goto(`${fixture}?locked=1&empty=1`)
  await open(page, 'Stats')
  await page.locator('.mobile-stat-row').filter({ hasText: 'Vitality' }).click()
  await expect(page.getByRole('button', { name: 'Add a point to Vitality', exact: true })).toBeDisabled()
  await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click()
  await close(page)
  await open(page, 'Equipment')
  await expect(page.locator('.mobile-item-grid .chr-cell')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-writes', '0')
})

test('portrait blocks controls without replacing the world canvas', async ({ page }) => {
  await page.goto(fixture)
  await expect(page.locator('.mobile-joystick')).toBeVisible()
  const canvas = await page.locator('[data-world-frame] > canvas').elementHandle()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.mobile-rotate')).toBeVisible()
  await expect(page.locator('.mobile-joystick')).toHaveCount(0)
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
})

test('a full spellbook keeps two rows with native touch-sized controls', async ({ page }) => {
  await page.goto('/e2e/fixtures/mobile_fight.html')
  const slots = page.locator('.fight-hud__spells')
  await expect(slots).toBeVisible()
  await expect(page.locator('.fight-hud__spell-shell')).toHaveCount(21)
  const rows = await slots
    .locator(':scope > *')
    .evaluateAll((elements) => [...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))])
  expect(rows).toHaveLength(2)
  const spell = (await page.locator('.fight-hud__spell-shell').first().boundingBox())!
  expect(spell.width).toBeGreaterThanOrEqual(44)
  expect(spell.height).toBeGreaterThanOrEqual(44)
  const bar = (await page.locator('.fight-hud__bar').boundingBox())!
  expect(bar.x).toBeGreaterThanOrEqual(0)
  expect(bar.x + bar.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: `/private/tmp/mobile-fight-${page.viewportSize()!.width}.png` })
})

test('the existing app serves the shared login and Play Demo on compact screens', async ({ page }) => {
  await page.goto('/')
  const login = page.locator('[data-player-login]')
  await expect(login).toBeVisible()
  await expect(login.getByRole('link', { name: 'Play demo', exact: true })).toHaveAttribute('href', '/play-demo')
  await expect(login.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible()
  const bounds = (await login.boundingBox())!
  expect(bounds.width).toBeLessThanOrEqual(384)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await expect(page.locator('.mobile-login')).toHaveCount(0)
  await page.screenshot({ path: `/private/tmp/shared-login-${page.viewportSize()!.width}.png` })
})
