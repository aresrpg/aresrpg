// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Page } from '@playwright/test'

/** Navigation can finish before the async locale import and React mount. */
export const open_responsive_preview = async (page: Page, url: string): Promise<void> => {
  await page.goto(url)
  await page.locator('[data-app-header]').waitFor({ state: 'attached' })
}
