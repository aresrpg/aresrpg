// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const engine_script = /\/(?:PlayerRuntime|MobileApp|webgpu_backend|three\.webgpu)[^/]*\.js$/

for (const path of ['/world?intent=connect-agent', '/connect-agent', '/kares'])
  test(`${path} is a page of its own: no world, no engine download, no game postcard`, async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto(path)
    await expect(page.locator('.light-page-header')).toBeVisible()
    await expect(page.locator('[data-boot-loading]')).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(requests.filter((url) => engine_script.test(url))).toEqual([])
  })

test('signed out, the agent page asks for the game sign-in and keeps its link', async ({ page }) => {
  await page.goto('/world?intent=connect-agent')
  await expect(page.getByRole('heading', { name: 'Connect your agent', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Google/ })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('intent')).toBe('connect-agent')
})

test('the KARES page opens on Staking and has no collapsed section', async ({ page }) => {
  await page.goto('/kares')
  await expect(page.getByRole('heading', { name: 'Sign in to stake', exact: true })).toBeVisible()
  await page.goto('/kares#tokenomics')
  await expect(page.locator('details')).toHaveCount(0)
})

test('the home page opens KARES in place: no document reload, and the page replaces its skeleton', async ({ page }) => {
  let documents = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest()) documents++
  })
  await page.goto('/')
  await expect(page.locator('.landing')).toHaveAttribute('data-motion', /.+/)
  await page.locator('a.kares-dock').first().click()
  await expect(page).toHaveURL(/\/kares$/)
  await expect(page.getByRole('heading', { name: 'Sign in to stake', exact: true })).toBeVisible()
  await expect(page.locator('[data-boot-light]')).toHaveCount(0)
  expect(documents).toBe(1)
})
