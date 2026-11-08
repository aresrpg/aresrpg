// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

test('setup selection never claims a connection or sends a request', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/e2e/fixtures/agent_setup.html')
  const open = page.getByRole('button', { name: 'Set up an agent', exact: true })
  await open.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.agent-provider-card')).toHaveCount(2)
  const connect = dialog.getByRole('button', { name: 'Copy setup request', exact: true })
  await expect(connect).toBeDisabled()
  for (const name of ['ChatGPT', 'Grok Bot']) {
    const provider = dialog.getByRole('button', { name, exact: true })
    await provider.click()
    await expect(provider).toHaveAttribute('aria-pressed', 'true')
    await expect(connect).toBeEnabled()
    await expect(dialog.locator('.agent-setup-status')).toHaveText(
      'Pairing is not available yet. No agent is connected.'
    )
  }
  await expect(dialog.locator('details')).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: 'Open setup instructions' })).toHaveAttribute(
    'href',
    '/agents/client.txt'
  )
  await expect(dialog.locator('input')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(open).toBeFocused()
  await open.click()
  await expect(page.locator('.agent-provider-card[aria-pressed="true"]')).toHaveCount(0)
  expect(writes).toEqual([])
})

test('unpaired context menu offers setup; live tabs stay manual', async ({ page }) => {
  await page.goto('/e2e/fixtures/agent_setup.html')
  const tabs = page.locator('[data-character-tabs]')
  await expect(tabs.locator('[data-delegated]')).toHaveCount(0)
  await tabs.locator('[data-character-tab]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Send to agent' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Set up an agent' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await tabs.locator('[data-character-tab]').last().click()
  await expect(tabs.locator('[data-character-tab]').last()).toHaveAttribute('aria-pressed', 'true')
  const specimen = page.locator('[data-ornament-specimens] [data-delegated="agent"]')
  await expect(specimen.locator('.character-tab-bot')).toBeVisible()
  await expect(specimen).toHaveAttribute('aria-description', 'Agent controlled · read-only specimen')
  await expect(specimen).toHaveCSS('min-height', '44px')
  await expect(specimen.locator('img')).toHaveCSS('width', '36px')
  await page.screenshot({ path: 'test-results/agent-tabs-desktop.png' })
})

for (const width of [390, 1280]) {
  test(`provider cards fit at ${width}px with original logos`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/e2e/fixtures/agent_setup.html')
    await page.getByRole('button', { name: 'Set up an agent', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect
      .poll(() =>
        dialog
          .locator('img')
          .evaluateAll((images) =>
            images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
          )
      )
      .toBe(true)
    const bounds = await page.locator('[data-agent-setup]').boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await dialog.getByRole('button', { name: 'Grok Bot', exact: true }).click()
    await page.screenshot({ path: `test-results/agent-setup-${width}.png` })
    await page.keyboard.press('Escape')
    if (width === 390) {
      await page.getByRole('button', { name: 'Characters', exact: true }).click()
      await expect(page.locator('[data-character-tabs]')).toBeVisible()
      await page.locator('[data-character-tabs] [data-character-tab]').last().click()
      await expect(page.locator('[data-character-tabs]')).toBeHidden()
    }
  })
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
]) {
  test(`world Friends entry opens agent setup and preserves party toggle at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(`/e2e/fixtures/ui_world_hud.html${viewport.width === 844 ? '?mobile' : ''}`)
    const connect = page.getByRole('button', { name: 'Connect your agent', exact: true })
    await expect(connect).toBeVisible()
    await expect(connect).toBeEnabled()
    await expect(connect).toHaveCSS('min-height', '44px')
    await expect(page.locator('[data-friends-card]')).toHaveCount(0)
    const party = page.locator('[data-fight-access]')
    await expect(party).toBeVisible()
    const before = await party.getAttribute('aria-checked')
    await party.click()
    await expect(party).toHaveAttribute('aria-checked', String(before !== 'true'))
    await page.screenshot({ path: `test-results/agent-world-button-${viewport.width}.png` })
    await connect.click()
    const dialog = page.getByRole('dialog', { name: 'Choose your agent' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'ChatGPT', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Copy setup request', exact: true })).toBeEnabled()
    await expect(dialog).toContainText('This wallet does not expose a Google public pairing identifier.')
    const guide = dialog.getByRole('link', { name: 'Open setup instructions' })
    await expect(guide).toHaveAttribute('href', '/agents/client.txt')
    const response = await page.request.get('/agents/client.txt')
    expect(response.ok()).toBe(true)
    const instructions = await response.text()
    expect(instructions).toContain('https://aresrpg.world/agents/ares-agent.mjs')
    for (const command of ['init', 'pair', 'reload']) expect(instructions).toContain(`node ./ares-agent.mjs ${command}`)
    const client = await page.request.get('/agents/ares-agent.mjs')
    expect(client.ok()).toBe(true)
    expect(client.headers()['content-type']).toContain('javascript')
    expect((await client.body()).length).toBeGreaterThan(0)
    await page.screenshot({ path: `test-results/agent-world-setup-${viewport.width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(connect).toBeFocused()
    await expect(party).toHaveAttribute('aria-checked', String(before !== 'true'))
  })
}

test('setup handoff copies public bootstrap instructions and exposes manual fallback on refusal', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value: string) => {
          if (document.documentElement.hasAttribute('data-refuse-clipboard')) throw new Error('Clipboard denied')
          document.documentElement.setAttribute('data-copied-request', value)
        },
      },
    })
  })
  await page.goto('/e2e/fixtures/agent_setup.html')
  await page.getByRole('button', { name: 'Set up an agent', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'ChatGPT', exact: true }).click()
  const request = dialog.locator('.agent-prompt')
  const payload = (await request.textContent())!
  expect(payload).toContain('/agents/client.txt')
  expect(payload).not.toContain('agent_kit.ts')
  expect(payload).toContain('Connect Your Agent')
  expect(payload).toContain('does not authorize creating credentials')
  const copy_button = dialog.getByRole('button', { name: 'Copy setup request' })
  const copy_bounds = await copy_button.boundingBox()
  await copy_button.click()
  await expect(page.locator('html')).toHaveAttribute('data-copied-request', payload)
  await expect(dialog.getByText('Copied', { exact: true })).toHaveClass('sr-only')
  expect(await copy_button.boundingBox()).toEqual(copy_bounds)
  await expect(dialog.locator('.agent-setup-status')).toContainText('No agent is connected.')
  await page.evaluate(() => document.documentElement.setAttribute('data-refuse-clipboard', ''))
  await dialog.getByRole('button', { name: 'Grok Bot', exact: true }).click()
  await dialog.getByRole('button', { name: 'Copy setup request' }).click()
  await expect(dialog.getByText('Copy failed. Select and copy the request above manually.')).toBeVisible()
  await expect(request).toBeVisible()
  await expect(request).toContainText(/Grok/i)
})
