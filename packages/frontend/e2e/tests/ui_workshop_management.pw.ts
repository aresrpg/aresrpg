// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`canonical management views stay dense and readable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/demo#ui')
    const navigation = page.locator('.ui-workshop-navigation')
    await navigation.getByRole('button', { name: 'Mastery', exact: true }).click()
    await expect(page.locator('[data-mastery-shop]')).toBeVisible()
    const body = (await page.locator('.mastery-body').boundingBox())!
    const shop = (await page.locator('.mastery-shop').boundingBox())!
    expect(shop.width / body.width).toBeGreaterThan(0.65)
    await page.locator('[data-mastery-offer] > button').first().click()
    await expect(page.locator('[data-loot-rewards]')).toBeVisible()
    await page.screenshot({ path: `/tmp/mastery-rewards-${viewport.width}.png` })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await navigation.getByRole('button', { name: 'Leaderboard', exact: true }).click()
    await expect(page.locator('.leaderboard-entries')).toBeVisible()
    await expect(page.locator('.leaderboard-step')).toHaveCount(0)
    expect(
      await page
        .locator('.leaderboard-entries')
        .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
    ).toBeGreaterThanOrEqual(2)
    const table = (await page.locator('.leaderboard-table').boundingBox())!
    const podium = (await page.locator('.leaderboard-standings').boundingBox())!
    if (viewport.height < 500) expect(table.width).toBeGreaterThan(podium.width * 3)
    else expect(table.height).toBeGreaterThan(podium.height * 2)
    await page.screenshot({ path: `/tmp/leaderboard-compact-${viewport.width}.png` })
  })
}

test('airdrop holder labels and actions stay inside their panel', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="airdrop"]').click()
  const panel = page.locator('.aui-airdrop-collection')
  await expect(panel).toBeVisible()
  const box = (await panel.boundingBox())!
  const heading = (await panel.locator('h2').boundingBox())!
  expect(heading.width).toBeGreaterThan(120)
  for (const node of await panel.locator('.airdrop-holder,.aui-airdrop-actions').all()) {
    const b = (await node.boundingBox())!
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width)
  }
  await page.screenshot({ path: '/tmp/airdrop-holder-mobile.png' })
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`airdrop cards share size, surface and centered art at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/ui_world_hud.html')
    await page.locator('[data-hud-page="airdrop"]').click()
    const cards = page.locator('.airdrop-campaign')
    await expect(cards).toHaveCount(9)
    const sizes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => ({ height: node.getBoundingClientRect().height, bg: getComputedStyle(node).backgroundColor }))
    )
    expect(new Set(sizes.map((value) => value.height)).size).toBe(1)
    expect(new Set(sizes.map((value) => value.bg)).size).toBe(1)
    const art = cards.first().locator('.airdrop-campaign-art')
    const a = (await art.boundingBox())!,
      img = (await art.locator('img').boundingBox())!
    expect(Math.abs(img.x + img.width / 2 - a.x - a.width / 2)).toBeLessThan(2)
    expect(Math.abs(img.y + img.height / 2 - a.y - a.height / 2)).toBeLessThan(2)
    expect(await art.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await page.screenshot({ path: `/tmp/airdrop-uniform-${viewport.width}.png` })
  })
}
