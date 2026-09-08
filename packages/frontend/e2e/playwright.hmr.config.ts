// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.hmr.ts',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  outputDir: '../../../test-results/browser-hmr',
  use: { baseURL: 'http://127.0.0.1:5183', channel: 'chrome', screenshot: 'only-on-failure' },
  webServer: {
    command: 'bun run --cwd packages/frontend dev --host 127.0.0.1 --port 5183 --strictPort',
    cwd: '../../..',
    url: 'http://127.0.0.1:5183/e2e/fixtures/balance_hmr.html',
  },
})
