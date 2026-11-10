// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'

import { mock_hosted } from '../fixtures/hosted_service.ts'

const open = async (page: Page) => {
  const fixture = await mock_hosted(page)
  fixture.connection.authorized = true
  await page.goto('/e2e/fixtures/agent_pairing.html?custody&character')
  await page.getByRole('button', { name: 'Agent connected', exact: true }).click()
  return fixture
}
const confirm = async (page: Page) => {
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Active fights are forfeited and dungeon runs abandoned')
  await page.getByRole('button', { name: 'Disconnect and return', exact: true }).click()
}

for (const width of [390, 1280]) {
  test(`Verdigris control and minimal connected modal fit at ${width}px; cancel never stops the bot`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const f = await open(page)
    await expect(page.locator('.e-wrap > .agent-btn.opt-e')).toHaveCount(1)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button')).toHaveCount(2)
    await expect(dialog.getByRole('heading')).toHaveText('Agent connected')
    const bounds = await page.locator('[data-agent-connected]').boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: test.info().outputPath(`connected-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(f.requests.some(({ path }) => path === '/connect/disconnect')).toBe(false)
    const button = page.getByRole('button', { name: 'Agent connected', exact: true })
    await button.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(button).toBeFocused()
    await expect(page.locator('.e-wrap')).toHaveCSS('outline-style', 'solid')
    await expect(page.locator('.e-wrap')).toHaveCSS('outline-width', '2px')
  })
}

test('disconnect drains first, blocks duplicate gestures and reports success only after return completion', async ({
  page,
}) => {
  const f = await open(page)
  f.connection.drain_reads = 1
  await confirm(page)
  await expect(page.getByText('Returning assets…', { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-fixture-returning', 'true')
  expect(f.requests.filter(({ path }) => path === '/connect/disconnect').length).toBeGreaterThanOrEqual(3)
  expect(f.connection.completed).toBe(0)
  await expect(page.getByRole('button', { name: 'Resume return', exact: true }).first()).toBeDisabled()
  await expect(page.getByText('Bot disconnected. Assets returned.', { exact: true })).toHaveCount(0)
  await page.evaluate(() => dispatchEvent(new Event('fixture/return')))
  await expect(page.getByText('Bot disconnected. Assets returned.', { exact: true })).toBeVisible()
  expect(f.connection.completed).toBe(1)
  expect(f.connection.authorized).toBe(false)
})

test('failed return stays stopped, emits no completion and resumes only after an explicit click', async ({ page }) => {
  const f = await open(page)
  await confirm(page)
  await expect(page.locator('html')).toHaveAttribute('data-fixture-returning', 'true')
  await page.evaluate(() => dispatchEvent(new Event('fixture/return-failed')))
  const resume = page.getByRole('button', { name: 'Resume return', exact: true }).first()
  await expect(resume).toBeEnabled()
  expect(f.connection.returning).toBe(true)
  expect(f.connection.completed).toBe(0)
  await expect(page.getByText('Returning assets…', { exact: true })).toHaveCount(0)
  await page.evaluate(() => document.documentElement.removeAttribute('data-fixture-returning'))
  await resume.click()
  await expect(page.locator('html')).toHaveAttribute('data-fixture-returning', 'true')
  await page.evaluate(() => dispatchEvent(new Event('fixture/return')))
  await expect(page.getByText('Bot disconnected. Assets returned.', { exact: true })).toBeVisible()
  expect(f.connection.completed).toBe(1)
})

test('wallet replacement during return cannot complete the old wallet operation', async ({ page }) => {
  const f = await open(page)
  await confirm(page)
  await expect(page.locator('html')).toHaveAttribute('data-fixture-returning', 'true')
  await page.evaluate(() => dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 })))
  await page.evaluate(() => dispatchEvent(new Event('fixture/return')))
  await expect(page.getByText('Returning assets…', { exact: true })).toHaveCount(0)
  expect(f.connection.completed).toBe(0)
  expect(f.connection.returning).toBe(true)
  await expect(page.getByText('Bot disconnected. Assets returned.', { exact: true })).toHaveCount(0)
})
