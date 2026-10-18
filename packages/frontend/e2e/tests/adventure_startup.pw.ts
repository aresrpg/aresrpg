// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('the document shows loading while the game module is still downloading', async ({ page }) => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/assets\/game_entry-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/play-demo', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-world-loading="assets"]')).toBeVisible()
  await expect(page.locator('[data-world-loading="assets"]')).toContainText('Loading')
  release()
})

test('a failed game module exposes recovery in the document shell', async ({ page }) => {
  let requests = 0
  await page.route(/\/assets\/game_entry-[^/]+\.js$/, (route) => {
    requests += 1
    return route.fulfill({ status: 503, body: 'unavailable' })
  })
  await page.goto('/play-demo')
  const shell = page.locator('[data-boot-loading][data-world-loading="failed"]')
  await expect(shell).toBeVisible()
  await shell.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect.poll(() => requests).toBe(2)
  await expect(shell).toBeVisible()
})

test('a failed adventure scene stays recoverable without starting a fallback world', async ({ page }) => {
  let requests = 0
  await page.route(/\/assets\/adventure-[^/]+\.json$/, (route) => {
    requests += 1
    return route.fulfill({ status: 503, body: 'unavailable' })
  })
  await page.goto('/play-demo')
  await expect(page.locator('[data-world-loading="failed"]')).toBeVisible()
  await expect(
    page.locator('[data-world-loading="failed"]').getByRole('button', { name: 'Reload', exact: true })
  ).toBeVisible()
  await expect(page.locator('.world-social-dock')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reload', exact: true }).last().click()
  await expect.poll(() => requests).toBe(2)
  await expect(page.locator('[data-world-loading="failed"]')).toBeVisible()
})

test('failed spell preparation keeps the adventure behind loading recovery', async ({ page }) => {
  await page.route(/\/assets\/swords-[^/]+\.webp$/, (route) => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('/play-demo')
  await expect(page.locator('[data-world-loading="failed"]')).toBeVisible({ timeout: 30000 })
  await expect(
    page.locator('[data-world-loading="failed"]').getByRole('button', { name: 'Reload', exact: true })
  ).toBeVisible()
})

for (const route of ['/', '/play-demo']) {
  test(`postcard covers ${route} until the scene is ready`, async ({ page }) => {
    test.setTimeout(120000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(route)
    const postcard = page.locator('.loading-modal[open] [data-world-loading]')
    await expect(postcard).toBeVisible({ timeout: 30000 })
    await expect(postcard).toHaveAttribute('data-loading-context', route === '/' ? 'home' : 'demo')
    await expect
      .poll(() => postcard.locator('img.loading-art-current').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0)
    await postcard.getByRole('button', { name: 'Next tip' }).click()
    await expect(postcard.locator('.loading-tip-controls small')).toHaveText('02 / 04')
    await page.keyboard.press('Escape')
    await expect(postcard).toBeVisible()
    const screenshot_name = route === '/' ? 'postcard-home.png' : 'postcard-demo.png'
    await page.screenshot({ path: test.info().outputPath(screenshot_name) })
    await expect(page.locator('.loading-modal[open]')).toHaveCount(0, { timeout: 100000 })
    expect(errors).toEqual([])
  })
}

test('the initial postcard fits a phone and delivers both images before application code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/assets\/app_boot-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/play-demo', { waitUntil: 'domcontentloaded' })
  const shell = page.locator('[data-boot-loading]')
  await expect(shell).toBeVisible()
  await expect
    .poll(() =>
      shell
        .locator('img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))
    )
    .toBe(true)
  const bounds = await shell.locator('.loading-story').boundingBox()
  expect(bounds!.y).toBeGreaterThan(100)
  expect(bounds!.y + bounds!.height).toBeLessThan(720)
  await page.screenshot({ path: test.info().outputPath('postcard-mobile.png') })
  release()
})

test('the real world uses its own postcard and waits for GPU preparation', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/loading_world.html')
  const postcard = page.locator('.loading-modal[open] [data-loading-context="world"]')
  await expect(postcard).toBeVisible()
  await expect
    .poll(() => postcard.locator('img.loading-art-current').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('postcard-world.png') })
  await expect(page.locator('.loading-modal[open]')).toHaveCount(0, { timeout: 100000 })
  expect(errors).toEqual([])
})

test('a long load rotates decoded postcards while tips remain usable', async ({ page }) => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/assets\/adventure-[^/]+\.json$/, async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/play-demo')
  const postcard = page.locator('.loading-modal[open] [data-world-loading]')
  await expect(postcard).toBeVisible()
  const image = postcard.locator('img.loading-art-current')
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  const original = await image.getAttribute('src')
  await expect(image).not.toHaveAttribute('src', original!, { timeout: 16000 })
  expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await postcard.getByRole('button', { name: 'Next tip' }).click()
  await expect(postcard).toBeVisible()
  release()
})
