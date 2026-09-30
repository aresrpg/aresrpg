// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('victory retains its roster and opens independent loot details with readable demo names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/fight_result.html')
  const report = page.locator('.result--fe')
  await expect(report).toBeVisible()
  await expect(report.locator('.fe-row__nametext')).toHaveText(['Senshi', 'Goblin', 'Goblin', 'Goblin'])
  await expect(report.locator('.aui-window-header')).toContainText('Victory')
  const loot = report.locator('button.fe-tile')
  await expect(loot).toHaveCount(6)
  const first_name = (await loot.nth(0).getAttribute('aria-label'))!
  const second_name = (await loot.nth(1).getAttribute('aria-label'))!
  const report_position = await report.boundingBox()
  await loot.nth(0).click()
  expect(await report.boundingBox()).toEqual(report_position)
  expect(await page.locator('.aui-floating-window').evaluate((node) => !node.closest('.fe-stage'))).toBe(true)
  const first = page.getByRole('dialog', { name: first_name, exact: true })
  await expect(first).toBeVisible()
  const window = first.locator('.aui-window')
  const original = (await window.boundingBox())!
  const handle = (await first.locator('.aui-window-header').boundingBox())!
  await page.mouse.move(handle.x + 120, handle.y + 20)
  await page.mouse.down()
  await page.mouse.move(handle.x + 120 - 350, handle.y + 20 - 140, { steps: 8 })
  await page.mouse.up()
  const moved = (await window.boundingBox())!
  expect(moved.x).toBeCloseTo(original.x - 350, 0)
  expect(moved.y).toBeCloseTo(original.y - 140, 0)
  await page.mouse.move(moved.x + 120, moved.y + 20)
  await page.mouse.down()
  await page.mouse.move(moved.x + 120, moved.y + 20 + 100, { steps: 8 })
  await page.mouse.up()
  expect((await window.boundingBox())!.y).toBeCloseTo(moved.y + 100, 0)
  await loot.nth(1).click()
  const second = page.getByRole('dialog', { name: second_name, exact: true })
  await expect(second).toBeVisible()
  expect(await report.boundingBox()).toEqual(report_position)
  await expect(page.getByRole('dialog', { name: first_name, exact: true })).toBeVisible()
  await second.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(report).toBeVisible()
  await page
    .getByRole('dialog', { name: first_name, exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.screenshot({ path: '/tmp/victory-shared-design.png' })
  await report.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(report).toHaveCount(0)
})

test('an unequipped reward pet opens a compact inventory card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/fixtures/fight_result.html?equipment')
  await page.locator('[data-selection-id="beru"]').click()
  const card = page.locator('.chr-equip__detail[data-item-category="pet"]')
  await expect(card).toBeVisible()
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(460)
  await expect(card.getByRole('button', { name: 'Equip', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Unequip', exact: true })).toHaveCount(0)
})

test('level-up radiance animates and spell points use the spell emblem', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?level')
  const card = page.locator('.aui-progression')
  await expect(card).toBeVisible()
  const reward = card.locator('.aui-reward').filter({ hasText: 'Spell points' })
  await expect(reward.locator('img')).toHaveAttribute('src', /carved_spells/)
  const aura = page.locator('.aui-progression-aura')
  const first = await aura.evaluate((node) => getComputedStyle(node, '::before').transform)
  await expect.poll(() => aura.evaluate((node) => getComputedStyle(node, '::before').transform)).not.toBe(first)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await aura.evaluate((node) => getComputedStyle(node, '::before').animationName)).toBe('none')
})

test('demo Goblin inspection has readable spells, finite resistances and clickable rewards', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_result.html?mob')
  const mob = page.getByRole('dialog', { name: 'Goblin', exact: true })
  await expect(mob).toBeVisible()
  await expect(mob).not.toContainText('NaN')
  await expect(mob.getByRole('button', { name: 'Goblin Strike', exact: true })).toBeVisible()
  await expect(mob.locator('.aui-mob-loot button')).toHaveCount(6)
  await mob.getByRole('button', { name: 'Muru Relic', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Muru Relic', exact: true })).toBeVisible()
})
