// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { resolve } from 'node:path'

import { defineConfig } from '@playwright/test'

const hardware = process.env.REQUIRE_HARDWARE === '1'
const mobile_viewport = process.env.PERF_VIEWPORT === 'mobile'
// New browser scenarios are manual diagnostics unless they protect a critical interaction here.
const CRITICAL_TESTS = [
  'auth_callback',
  'add_funds',
  'box_batch',
  'character_delete',
  'character_progression',
  'fight_placement_race',
  'fight_touch',
  'interaction',
  'inventory_actions',
  'marketplace',
  'wallet_switcher',
].map((name) => `**/${name}.pw.ts`)
const RENDERER_SMOKE = '**/renderer_smoke.pw.ts'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.ts',
  expect: { toPass: { timeout: 3_000 } },
  workers: hardware ? 1 : 3,
  retries: 0,
  outputDir: '../../../test-results/browser',
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(import.meta.dirname, '../../../test-results/browser-results.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: mobile_viewport
      ? { width: 844, height: 390 }
      : hardware
        ? { width: 1920, height: 1080 }
        : { width: 1280, height: 720 },
    deviceScaleFactor: mobile_viewport ? 3 : hardware ? 2 : 1,
    screenshot: 'only-on-failure',
    trace: hardware ? 'off' : 'retain-on-failure',
    browserName: 'chromium',
    channel: 'chrome',
    launchOptions: { args: hardware ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [] },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'regression-ui',
      testMatch: CRITICAL_TESTS,
      fullyParallel: true,
      workers: 2,
      timeout: 60_000,
    },
    { name: 'regression-renderer', testMatch: RENDERER_SMOKE, workers: 1, timeout: 60_000 },
    {
      name: 'diagnostics',
      testIgnore: ['**/performance.pw.ts', RENDERER_SMOKE, ...CRITICAL_TESTS],
      workers: 1,
      timeout: 60_000,
    },
    { name: 'performance', testMatch: '**/performance.pw.ts', workers: 1, timeout: 600_000 },
  ],
  webServer: {
    command:
      'bun run --cwd packages/frontend build:test && bun run --cwd packages/frontend preview --host 127.0.0.1 --port 5180 --strictPort --outDir ../../test-results/browser-build',
    cwd: '../../..',
    url: 'http://127.0.0.1:5180/e2e/fixtures/workload.html',
    timeout: 180_000,
  },
})
