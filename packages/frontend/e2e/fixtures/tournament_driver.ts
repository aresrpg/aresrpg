// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Page } from '@playwright/test'

export const visit = (page: Page, query = '') => page.goto(`/e2e/fixtures/tournament.html${query}`)
export const calls = async (page: Page): Promise<unknown[]> =>
  JSON.parse((await page.locator('body').getAttribute('data-calls')) ?? '[]')
export const fixture = async (page: Page, method: string, ...args: unknown[]) => {
  await page.waitForFunction(() => 'tournament_fixture' in window)
  return page.evaluate(
    ({ method, args }) => {
      const runtime = window as unknown as { tournament_fixture: Record<string, (...values: unknown[]) => unknown> }
      return runtime.tournament_fixture[method](...args)
    },
    { method, args }
  )
}
