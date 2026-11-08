// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }

const policy = deployment.headers
  .flatMap((row) => row.headers)
  .find((header) => header.key === 'Content-Security-Policy')!.value
const app_chunk = /\/assets\/app-[^/]+\.js$/
const game_chunk = /\/assets\/game_entry-[^/]+\.js$/

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue()
    const response = await route.fetch()
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
})

for (const width of [1280, 390]) {
  test(`landing paints before delayed startup and survives reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.addInitScript(() => {
      Reflect.set(window, 'saw_game_loader', false)
      new MutationObserver(() => {
        if (document.querySelector('#root [data-boot-loading]')) Reflect.set(window, 'saw_game_loader', true)
      }).observe(document, { childList: true, subtree: true })
    })
    for (const warm of [false, true]) {
      const gate = Promise.withResolvers<void>()
      await page.route(app_chunk, async (route) => {
        await gate.promise
        await route.continue()
      })
      const navigation = warm ? page.reload() : page.goto('/')
      try {
        await expect(page.locator('#root .landing')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeDisabled()
        await expect(page.locator('#root [data-boot-loading]')).toHaveCount(0)
      } finally {
        gate.resolve()
      }
      await navigation
      await expect(page.locator('.landing')).toHaveAttribute('data-motion', /.+/)
      await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeEnabled()
      expect(await page.evaluate(() => Reflect.get(window, 'saw_game_loader'))).toBe(false)
      expect(requests.filter((url) => /game_entry-|webgpu_backend-|three\.webgpu|\/models\//.test(url))).toEqual([])
      await page.unroute(app_chunk)
    }
  })
}

for (const agent of [false, true])
  test(`${agent ? 'Let AI Play' : 'Play'} restores the postcard through the same game entry`, async ({ page }) => {
    const gate = Promise.withResolvers<void>()
    await page.route(game_chunk, async (route) => {
      await gate.promise
      await route.fulfill({
        contentType: 'application/javascript',
        body: 'export const boot_game = () => document.getElementById("root").replaceChildren(document.createTextNode("Game ready"))',
      })
    })
    await page.goto('/')
    await expect(page.locator('.landing')).toHaveAttribute('data-motion', /.+/)
    if (agent) await page.getByRole('link', { name: 'Let AI play', exact: true }).click()
    else await page.getByRole('button', { name: 'Play', exact: true }).first().click()
    expect(new URL(page.url()).searchParams.get('intent')).toBe(agent ? 'connect-agent' : null)
    try {
      await expect(page.locator('#root [data-boot-loading]')).toBeVisible()
      await expect(page.locator('#root .landing')).toHaveCount(0)
    } finally {
      gate.resolve()
    }
    await expect(page.locator('#root')).toHaveText('Game ready')
  })

test('failed landing startup restores explicit reload recovery', async ({ page }) => {
  await page.route(/\/assets\/app_boot-[^/]+\.js$/, (route) => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.goto('/')
  await expect(page.locator('#root [data-world-loading="failed"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
})

test('connector keeps its postcard and OAuth stays passive before startup', async ({ page }) => {
  for (const path of ['/connect-agent?intent=connect-agent', '/enoki']) {
    const gate = Promise.withResolvers<void>()
    await page.route(app_chunk, async (route) => {
      await gate.promise
      await route.fulfill({ contentType: 'application/javascript', body: '' })
    })
    const navigation = page.goto(path)
    try {
      await expect.poll(() => new URL(page.url()).pathname).toBe(path.split('?')[0])
      if (path === '/enoki') await expect(page.locator('#root')).toBeEmpty()
      else await expect(page.locator('#root [data-boot-loading]')).toBeVisible()
      await expect(page.locator('#root .landing')).toHaveCount(0)
    } finally {
      gate.resolve()
    }
    await navigation
    await page.unroute(app_chunk)
  }
})
