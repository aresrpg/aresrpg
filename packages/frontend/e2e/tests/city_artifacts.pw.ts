// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import type {} from '../fixtures/city_artifacts.ts'
import deployment from '../../vercel.json' with { type: 'json' }

const policy = deployment.headers
  .flatMap((row) => row.headers)
  .find((header) => header.key === 'Content-Security-Policy')!.value

test('small city artifacts load under production CSP in the page and a worker', async ({ page }) => {
  await page.route('http://127.0.0.1:5180/**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
  await page.goto('/e2e/fixtures/city_artifacts.html')
  await page.waitForFunction(() => typeof window.probe_cities === 'function')
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('data:application/json,{}')
        return false
      } catch {
        return true
      }
    })
  ).toBe(true)
  const results = await page.evaluate(() => window.probe_cities())
  for (const rows of [results.main, results.worker]) {
    expect(rows.map((row) => row.id)).toEqual(['the_ruins', 'fuwage'])
    for (const row of rows) {
      expect(row.loaded).toEqual([row.id, row.id])
      for (const url of row.urls) expect(new URL(url).protocol).toBe('http:')
    }
  }
})

test('city HTTP failures retain a typed missing-asset reason through the worker envelope', async ({ page }) => {
  await page.route(/\/assets\/failure-\d+\.json$/, (route) => {
    const status = Number(
      route
        .request()
        .url()
        .match(/failure-(\d+)/)![1]
    )
    return route.fulfill({ status, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/e2e/fixtures/city_artifacts.html')
  await page.waitForFunction(() => typeof window.probe_city_failure === 'function')
  for (const status of [404, 410, 503, 200]) {
    const issue = await page.evaluate((status) => window.probe_city_failure(status), status)
    expect(issue?.code).toBe(status === 404 || status === 410 ? 'asset_missing' : 'terrain_failed')
  }
})
