// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { resolve } from 'node:path'

import { defineConfig } from '@playwright/test'

const hardware = process.env.REQUIRE_HARDWARE === '1'
const browser_name = (process.env.BROWSER ?? 'chrome') as 'chrome' | 'firefox' | 'webkit'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.ts',
  timeout: process.env.BROWSER_WORKLOAD === 'full' ? 600_000 : 180_000,
  workers: 1,
  retries: 0,
  outputDir: '../../../test-results/browser',
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(import.meta.dirname, '../../../test-results/browser-results.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: hardware ? { width: 1920, height: 1080 } : { width: 1280, height: 720 },
    deviceScaleFactor: hardware ? 2 : 1,
    screenshot: 'only-on-failure',
    trace: hardware ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: browser_name,
      use: {
        browserName: browser_name === 'chrome' ? 'chromium' : browser_name,
        ...(browser_name === 'chrome' ? { channel: 'chrome' } : {}),
        ...(browser_name === 'firefox' && process.platform === 'linux' && !hardware
          ? { launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } } }
          : {}),
        ...(browser_name === 'chrome' && hardware
          ? { launchOptions: { args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] } }
          : {}),
      },
    },
  ],
  webServer: {
    command:
      'bun run --cwd packages/frontend build:test && bun run --cwd packages/frontend preview --host 127.0.0.1 --port 5180 --strictPort --outDir ../../test-results/browser-build',
    cwd: '../../..',
    url: 'http://127.0.0.1:5180/e2e/fixtures/workload.html',
    timeout: 180_000,
  },
})
