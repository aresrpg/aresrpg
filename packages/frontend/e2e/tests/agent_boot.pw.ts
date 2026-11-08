// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const fixture = '/e2e/fixtures/agent_boot.html'
const player_script = /\/(?:PlayerRuntime|MobileApp|app)-[^/]+\.js$/

test.beforeEach(async ({ page }) => {
  await page.route('https://api.slush.app/**', (route) => route.fulfill({ json: {} }))
})

for (const width of [1280, 390])
  for (const intent of ['', '?intent=connect-agent'])
    test(`ordinary game boot owns agent intent ${intent || 'none'} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const requests: string[] = []
      page.on('request', (request) => requests.push(request.url()))
      await page.goto(`${fixture}${intent}`)
      await expect.poll(() => requests.some((url) => player_script.test(url))).toBe(true)
      await expect(page.locator('.app-ui')).toBeVisible()
      await expect(page.locator('[data-agent-entry]')).toHaveCount(0)
      await page.evaluate(() => dispatchEvent(new Event('fixture/login')))
      const dialog = page.getByRole('dialog', { name: 'Choose your agent' })
      if (intent) {
        await expect(dialog).toBeVisible()
        expect(new URL(page.url()).searchParams.has('intent')).toBe(false)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
      } else await expect(dialog).toHaveCount(0)
      await expect(page.locator('.app-ui')).toBeVisible()
    })

for (const path of ['/world?intent=connect-agent', '/connect-agent'])
  test(`direct ${path} opens the ordinary player home`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('.app-ui')).toBeVisible()
    await expect(page.locator('[data-agent-entry]')).toHaveCount(0)
  })
