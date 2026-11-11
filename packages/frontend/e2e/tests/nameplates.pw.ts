// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

type Ink = { x_min: number; x_max: number; y_min: number; y_max: number }

test('authored title plates render with loaded fonts and every localized subtitle', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto('/e2e/fixtures/nameplates.html')
  await expect.poll(() => page.evaluate(() => window.nameplate_probe?.revision() ?? 0)).toBe(11)
  expect(await page.evaluate(() => window.nameplate_probe.titles)).toHaveLength(11)
  const measurements = []
  for (let locale = 0; locale < 11; locale++) {
    await page.evaluate((index) => window.nameplate_probe.select(index, true), locale)
    const measured = await page.evaluate(() => window.nameplate_probe.measure())
    // Shared central text window verified against all eleven final PNGs at loaded-font size.
    for (const row of measured as { name: Ink; subtitle: Ink }[])
      for (const ink of [row.name, row.subtitle]) {
        expect(ink.x_min).toBeGreaterThanOrEqual(0.28)
        expect(ink.x_max).toBeLessThanOrEqual(0.72)
        expect(ink.y_min).toBeGreaterThanOrEqual(0.42)
        expect(ink.y_max).toBeLessThanOrEqual(0.67)
      }
    measurements.push(measured)
    await page.screenshot({ path: `test-results/nameplates-locale-${locale}.png`, fullPage: true })
  }
  await test
    .info()
    .attach('loaded-font-ink-bounds', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  expect(failures).toEqual([])
})

test('artwork cache keeps fallback stable through failures and recovery', async ({ page }) => {
  await page.route('**/missing-nameplate.png', (route) => route.abort())
  await page.goto('/e2e/fixtures/nameplates.html')
  await expect.poll(() => page.evaluate(() => window.nameplate_probe?.revision() ?? 0)).toBe(11)
  const before = await page.evaluate(() => window.nameplate_probe.revision())
  await page.evaluate(() => window.nameplate_probe.artwork('/missing-nameplate.png'))
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.nameplate_probe.revision())).toBe(before)
  await page.screenshot({ path: 'test-results/nameplates-fallback.png', fullPage: true })
  await page.evaluate(() => {
    window.nameplate_probe.artwork()
    window.nameplate_probe.select(1)
  })
  expect(await page.evaluate(() => window.nameplate_probe.revision())).toBe(before)
  await page.evaluate(() => window.nameplate_probe.dispose())
})

test('late artwork cannot restore an unequipped plate or repaint after disposal', async ({ page }) => {
  await page.goto('/e2e/fixtures/nameplates.html')
  await expect.poll(() => page.evaluate(() => window.nameplate_probe?.revision() ?? 0)).toBe(11)
  const url = await page.evaluate(() => (window.nameplate_probe.measure()[0] as { artwork: string }).artwork)
  const image = await page.request.get(url)
  const bytes = await image.body()
  for (const dispose of [false, true]) {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const path = `/delayed-nameplate-${dispose}.png`
    await page.route(`**${path}`, async (route) => {
      await held
      await route.fulfill({ body: bytes, contentType: 'image/png' })
    })
    const request = page.waitForRequest((request) => request.url().endsWith(path))
    await page.evaluate((url) => window.nameplate_probe.artwork(url), path)
    await request
    const before = await page.evaluate(() => window.nameplate_probe.revision())
    await page.evaluate((dispose) => {
      window.nameplate_probe.artwork('')
      if (dispose) window.nameplate_probe.dispose()
    }, dispose)
    release()
    if (dispose) {
      await page.waitForTimeout(100)
      expect(await page.evaluate(() => window.nameplate_probe.revision())).toBe(before)
    } else {
      await expect.poll(() => page.evaluate(() => window.nameplate_probe.revision())).toBe(before + 1)
    }
    expect(
      await page.evaluate(() => window.nameplate_probe.measure().every((row) => !(row as { artwork?: string }).artwork))
    ).toBe(true)
  }
})
