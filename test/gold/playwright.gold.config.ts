// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// GOLD SUITE Playwright config (docs/GOLD_STANDARD_SUITE.md §1/§10) — N PARALLEL workers, M dev
// wallets (one per worker via addInitScript __ARES_DEV_KEY — src/auth/dev_wallet.ts reads it), ONE
// throwaway Vite server pointed at this worktree's GOLD localnet read-api. Determinism law: retries 0.
//
//   run:  cd packages/frontend && bunx playwright test --config ../../test/gold/playwright.gold.config.ts
//
// Port 5490+ — NEVER the primary dev server's port and never the golden-path ports (5399+).
const GOLD = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(GOLD, '..', '..', 'packages', 'frontend')
const MANIFEST = path.join(GOLD, '.gold-deployment.json')
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null
const PORT = Number(process.env.GOLD_PORT ?? 5490)
const BASE = `http://localhost:${PORT}`
const API = process.env.GOLD_API ?? manifest?.api ?? 'http://127.0.0.1:3100'

export default defineConfig({
  testDir: path.join(GOLD, 'specs'),
  outputDir: path.join(GOLD, 'out', 'pw'),
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: Number(process.env.GOLD_WORKERS ?? 2), // the N-parallel proof; lanes raise it
  retries: 0, // determinism law — a flaky test is a bug, never a reroll
  reporter: [['list']],
  use: {
    baseURL: BASE,
    headless: true, // the slice needs no WebGPU (roster/display); fight/VFX lanes run their own HEADED project
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // ONE dev server for every worker/wallet; VITE_RPC_URL anchors ALL /v1 display reads to the gold
    // localnet stack. VITE_NETWORK stays default until the L1 anchor lane teaches the SDK 'localnet'.
    command: `VITE_RPC_URL=${API} bunx --bun vite --port ${PORT} --strictPort`,
    cwd: FRONTEND,
    url: `${BASE}/`,
    // cold dep-optimizer re-bundle after an engine merge legitimately exceeds 120s (r9/r10 2026-07-19); warm boots in ~5s — the budget covers the cold class
    timeout: 360_000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
