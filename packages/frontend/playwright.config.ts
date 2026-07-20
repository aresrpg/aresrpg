// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { defineConfig, devices } from '@playwright/test'

// #42 exploration-loop E2E — drives the REAL app (chain-direct, backend-off) against testnet.
// Runs its OWN throwaway Vite dev server on port 5174 (NEVER 5173 — the live dev session) with the
// LIVE @server sponsor endpoint so the create-character path works if the dev address has no character.
const PORT = Number(process.env.E2E_PORT ?? 5174)
const BASE = `http://localhost:${PORT}`
// The LIVE local @server sponsor (root .env's VITE_SPONSOR_URL) that serves the CURRENT demo package's
// @server. The old default (https://aresrpg-demo.vercel.app/api/sponsor) is a STALE sponsor keypair —
// a create mint sponsored by it aborts EInvalidSponsor (auth::authenticate 101). Requires the local
// sponsor endpoint to be running (the dev stack starts it automatically). Overridable via env for CI/other envs.
const SPONSOR_URL = process.env.VITE_SPONSOR_URL ?? 'http://localhost:9528/api/sponsor'

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    headless: true,
    trace: 'on',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // bun-run vite on a NON-5173 port with the live sponsor URL (inline VITE_* overrides the root .env).
    command: `VITE_SPONSOR_URL=${SPONSOR_URL} bunx --bun vite --port ${PORT} --strictPort`,
    url: `${BASE}/game-world`,
    timeout: 120_000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
