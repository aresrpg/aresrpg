// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.pw.ts',
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: 'chrome', hasTouch: true, isMobile: true },
  projects: [
    { name: 'small-landscape', use: { viewport: { width: 667, height: 375 } } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 } } },
  ],
})
