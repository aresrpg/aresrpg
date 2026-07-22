// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// POST-DEPLOY PROD SMOKE — the deployed bundle + real testnet timing. There is deliberately no
// webServer: every row drives https://testnet.aresrpg.world after Vercel has returned success.
const GOLD = path.dirname(fileURLToPath(import.meta.url))
const PROD_ORIGIN = 'https://testnet.aresrpg.world'

export default defineConfig({
  testDir: path.join(GOLD, 'specs_prod_smoke'),
  outputDir: path.join(GOLD, 'out', 'pw-prod-smoke'),
  timeout: 360_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1, // one funded dev wallet; live writes must never race each other
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: PROD_ORIGIN,
    headless: false, // the tactical board is WebGPU-only; first-turn activation needs a real GPU adapter
    serviceWorkers: 'block', // post-deploy means the fresh network build, never a stale cached shell
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
  },
  projects: [{ name: 'chromium-headed', use: { ...devices['Desktop Chrome'] } }],
})
