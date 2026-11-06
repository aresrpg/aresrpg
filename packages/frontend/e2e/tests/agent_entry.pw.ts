// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const entry = '/e2e/fixtures/agent_entry.html'

test('signed-in entry opens the existing modal once, preserves history and survives roster arrival', async ({
  page,
}) => {
  await page.goto(`${entry}?signed_in&keep=one&intent=connect-agent#anchor`)
  await expect(page.getByRole('dialog', { name: 'Choose your agent' })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('intent')).toBe(false)
  expect(new URL(page.url()).searchParams.get('keep')).toBe('one')
  expect(new URL(page.url()).hash).toBe('#anchor')
  expect(await page.evaluate(() => history.state)).toEqual({ fixture: 'initial' })
  expect(await page.evaluate(() => String(history.length))).toBe(
    await page.locator('html').getAttribute('data-initial-history-length')
  )
  await page.evaluate(() => dispatchEvent(new Event('fixture/roster')))
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-current-dialog]')).toHaveText('welcome')
  await page.reload()
  await expect(page.locator('[data-current-dialog]')).toHaveText('none')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('logged-out entry waits through failed and retried login, without duplicate auth or automatic pairing', async ({
  page,
}) => {
  const forbidden: string[] = []
  page.on('request', (request) => {
    if (/accounts\.google\.com|\/api\/agent-setup/.test(request.url())) forbidden.push(request.url())
  })
  await page.goto(`${entry}?intent=connect-agent`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCount(1)
  expect(new URL(page.url()).searchParams.get('intent')).toBe('connect-agent')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel simulated login' }).click()
  expect(new URL(page.url()).searchParams.get('intent')).toBe('connect-agent')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await page.getByRole('button', { name: 'Finish simulated login' }).click()
  await expect(page.getByRole('dialog', { name: 'Choose your agent' })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('intent')).toBe(false)
  expect(forbidden).toEqual([])
})

test('Back closes setup and Forward never replays a consumed entry', async ({ page }) => {
  await page.goto(`${entry}?signed_in`)
  await page.getByRole('button', { name: 'Open agent entry' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goForward()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-current-dialog]')).toHaveText('none')
})

test('unknown entry intents leave the URL and normal app alone', async ({ page }) => {
  await page.goto(`${entry}?signed_in&intent=other`)
  await expect(page.getByRole('button', { name: 'Disconnect simulated session' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('intent')).toBe('other')
})
