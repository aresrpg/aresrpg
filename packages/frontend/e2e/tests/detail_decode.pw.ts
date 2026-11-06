// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/detail_decode.ts'

// Manual hardware diagnostic: one admitted part must fit the existing Medium CPU budget on average.
// This caught 7.21 ms batches against a 2 ms budget before the allocation-free decoder loops.
test('detail decoding fits its existing admission budget', async ({ page }) => {
  await page.goto('/e2e/fixtures/detail_decode.html')
  await page.waitForFunction(() => typeof window.measure_details === 'function')
  const result = await page.evaluate(() => window.measure_details())
  const mean = result.durations.reduce((sum, duration) => sum + duration, 0) / result.durations.length
  await test
    .info()
    .attach('detail-decode-timings', { body: JSON.stringify({ ...result, mean }), contentType: 'application/json' })
  expect(mean).toBeLessThan(result.budget)
})
