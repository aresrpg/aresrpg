// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readdirSync as read_directory, readFileSync as read_file } from 'node:fs'

import { expect, test } from '@playwright/test'

const fixture = '/e2e/fixtures/agent_lightweight.html'
// Chunk names alone are not a boundary: inspect emitted WebGPU/GLTF implementations too.
const renderer_chunks = () =>
  read_directory('/tmp/ares-agent-build/assets').filter(
    (name) =>
      name.endsWith('.js') &&
      /THREE\.(?:WebGPUBackend|GLTFLoader|WebGPURenderer)|GPUShaderStage/.test(
        read_file(`/tmp/ares-agent-build/assets/${name}`, 'utf8')
      )
  )
const renderer_script = /\/(?:webgpu_backend|MenuScene|PlayerRuntime|MobileApp|world|three\.[^/]+)-[^/]+\.js$/
const model_asset = /\.(?:glb|gltf|wgsl|bin)(?:[?#]|$)|\/(?:worlds|cities)\/.*\.json/
for (const width of [1280, 390])
  test(`agent entry works without WebGPU and defers rendering at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }))
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto(`${fixture}?intent=connect-agent`)
    await expect(page.locator('[data-agent-entry]')).toBeVisible()
    expect(await page.evaluate(() => navigator.gpu)).toBeUndefined()
    await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
    await page.evaluate(() => dispatchEvent(new Event('fixture/login')))
    const dialog = page.getByRole('dialog', { name: 'Choose your agent' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'ChatGPT', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Set up an agent', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect(
      requests.filter(
        (url) =>
          renderer_script.test(url) ||
          renderer_chunks().some((name) => url.endsWith(`/assets/${name}`)) ||
          model_asset.test(url)
      )
    ).toEqual([])
    expect(requests.filter((url) => /sw\.js|workbox/.test(url))).toEqual([])
    await page.keyboard.press('Escape')
    await page.evaluate(() => dispatchEvent(new Event('fixture/snapshot')))
    const wallet = await page.locator('html').getAttribute('data-session-wallet')
    await page.getByRole('button', { name: 'Play the game', exact: true }).click()
    await expect.poll(() => requests.some((url) => renderer_script.test(url))).toBe(true)
    await page.evaluate(() => dispatchEvent(new Event('fixture/snapshot')))
    expect(await page.locator('html').getAttribute('data-session-wallet')).toBe(wallet)
    expect(new URL(page.url()).searchParams.has('intent')).toBe(false)
  })

test('canonical agent screen survives reload without a replayed modal or a game download', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }))
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  expect(renderer_chunks().length).toBeGreaterThan(0)
  await page.goto('/connect-agent')
  await expect(page.locator('[data-agent-entry]')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-agent-entry]')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(
    requests.filter(
      (url) =>
        renderer_script.test(url) ||
        renderer_chunks().some((name) => url.endsWith(`/assets/${name}`)) ||
        model_asset.test(url)
    )
  ).toEqual([])
})

test.beforeEach(async ({ page }) => {
  await page.route('https://api.slush.app/**', (route) => route.fulfill({ json: {} }))
})

test('explicit agent watching activates the existing player surface', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(`${fixture}?intent=connect-agent`)
  await expect(page.locator('[data-agent-entry]')).toBeVisible()
  await page.evaluate(() => {
    dispatchEvent(new Event('fixture/login'))
    dispatchEvent(new Event('fixture/watch'))
  })
  await expect.poll(() => requests.some((url) => renderer_script.test(url))).toBe(true)
})

test('normal Play entry retains the existing player surface without the agent intent', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(fixture)
  await expect.poll(() => requests.some((url) => renderer_script.test(url))).toBe(true)
  await expect(page.locator('[data-agent-entry]')).toHaveCount(0)
})
