// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

for (const width of [1920, 1024, 590, 390]) {
  test(`world places expose mobs and gatherables without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/e2e/fixtures/encyclopedia_worlds.html')
    const detail = page.locator('[data-world-place="biome:plains"]')
    await expect(detail).toBeVisible()
    await expect(detail.locator('[data-world-resource="wheat"]')).toContainText('Farmer · Job Lv. 1')
    expect(await detail.locator('[data-world-roaming] [data-world-mob]').count()).toBeGreaterThan(0)
    await expect
      .poll(() =>
        detail
          .locator('[data-world-mob] img')
          .first()
          .evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0)
    const resource = detail.locator('[data-world-resource="wheat"]')
    await resource.scrollIntoViewIfNeeded()
    await expect(resource).toBeInViewport()
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath('worlds.png'), animations: 'disabled' })
  })
}

test('city resources and dungeon encounters have separate clickable entries', async ({ page }) => {
  await page.goto('/e2e/fixtures/encyclopedia_worlds.html')
  await page.locator('[data-world-location="city:thebes"]').click()
  await expect(page.locator('main')).toHaveAttribute('data-path', '/encyclopedia/worlds/nauvis/city/thebes')
  const city = page.locator('[data-world-place="city:thebes"]')
  await expect(city.locator('[data-world-resource]')).toHaveCount(3)
  await expect(city.locator('[data-world-resource="quartz"]')).toBeVisible()
  const dungeon = city.locator('[data-world-dungeon="gilded_lorito"]')
  await expect(dungeon).toBeVisible()
  expect(await dungeon.locator('[data-world-mob]').count()).toBeGreaterThan(0)
  await dungeon.locator('.world-atlas__key').click()
  await expect(page.locator('main')).toHaveAttribute('data-path', '/encyclopedia/items/key_of_gilded_lorito')
})

for (const [attribute, route] of [
  ['data-world-mob', 'bestiary'],
  ['data-world-protector', 'bestiary'],
  ['data-world-rare', 'items'],
] as const) {
  test(`${attribute} rows open their existing encyclopedia detail`, async ({ page }) => {
    await page.goto('/e2e/fixtures/encyclopedia_worlds.html')
    const row = page.locator(`[${attribute}]`).first()
    const id = await row.getAttribute(attribute)
    await row.click()
    await expect(page.locator('main')).toHaveAttribute('data-path', `/encyclopedia/${route}/${id}`)
  })
}

test('search finds resource locations and world changes cannot retain another world’s city', async ({ page }) => {
  await page.goto('/e2e/fixtures/encyclopedia_worlds.html')
  const search = page.getByPlaceholder('Find a biome, city, mob or resource…')
  await search.fill('quartz')
  await expect(page.locator('[data-world-location="biome:highlands"]')).toBeVisible()
  await expect(page.locator('[data-world-location="city:thebes"]')).toBeVisible()
  await expect(page.locator('[data-world-location="biome:plains"]')).toHaveCount(0)
  await page.locator('[data-world-location="city:thebes"]').click()
  await search.fill('')
  await page.locator('[data-world-select="yakutia"]').click()
  await expect(page.locator('[data-world-place="biome:taiga"]')).toBeVisible()
  await expect(page.locator('[data-world-dungeon]')).toHaveCount(0)
  await search.fill('no such place')
  await expect(page.locator('[data-world-place]')).toHaveCount(0)
})

test('a city link restores its location and the mobile picker keeps it reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/e2e/fixtures/encyclopedia_worlds.html?place=city%3Athebes&locale=fr')
  await expect(page.locator('[data-world-place="city:thebes"]')).toBeVisible()
  await expect(page.locator('[data-world-resource="quartz"]')).toContainText('Métier niv. 1')
  const picker = page.getByRole('combobox', { name: 'Lieux', exact: true })
  await expect(picker).toHaveValue('city:thebes')
  await picker.selectOption('biome:forest')
  await expect(page.locator('[data-world-place="biome:forest"]')).toBeVisible()
  await expect(page.locator('[data-world-resource="quartz"]')).toHaveCount(0)
})
