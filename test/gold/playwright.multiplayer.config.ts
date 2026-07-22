// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// MULTIPLAYER Playwright config — cross-wallet rows over ONE gold localnet. Two work shapes share it:
//   · SDK rows (marketplace.spec.ts): pure PTB actors, no browser — the `chromium` project.
//   · BROWSER rows (@headed, coop_fight.spec.ts): N real contexts on the SAME frontend — the
//     `chromium-headed` project (headed = the suite's WebGPU source of truth, the anchor config's law).
// The webServer is the anchor lane's exact L1 seam (VITE_NETWORK=localnet + localnet gRPC + gold /v1) on its
// OWN port/cache so a multiplayer run never collides with a live anchor run.
//
//   run:  cd packages/frontend && bunx playwright test --config ../../test/gold/playwright.multiplayer.config.ts
//
// Port 5493 — NEVER the primary dev server's port, the reserved companion ports, the slice's 5490, or the anchor lane's 5491/5492.
const GOLD = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(GOLD, '..', '..', 'packages', 'frontend')
const MANIFEST = path.join(GOLD, '.gold-deployment.json')
const VITE_CONFIG = path.join(GOLD, 'vite.anchor.config.ts')
const VITE_CACHE_DIR = path.join(FRONTEND, 'node_modules', '.vite-multiplayer')
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null

const PORT = Number(process.env.MULTIPLAYER_PORT ?? 5493)
const BASE = `http://localhost:${PORT}`
const API = manifest?.api
const GRPC = manifest?.rpc ?? 'http://127.0.0.1:9100'

export default defineConfig({
  testDir: path.join(GOLD, 'specs_multiplayer'),
  outputDir: path.join(GOLD, 'out', 'pw-multiplayer'),
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0, // determinism law — a flaky test is a bug, never a reroll
  reporter: 'line',
  use: {
    baseURL: BASE,
    headless: true,
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  projects: [
    { name: 'chromium', grepInvert: /@headed/, use: { ...devices['Desktop Chrome'] } },
    {
      // The coop fight row drives real boards — headed Metal for WebGPU + full-run video as proof.
      name: 'chromium-headed',
      grep: /@headed/,
      use: { ...devices['Desktop Chrome'], headless: false, serviceWorkers: 'block', video: 'on' },
    },
  ],
  webServer: {
    command: `GOLD_VITE_CACHE_DIR='${VITE_CACHE_DIR}' VITE_NETWORK=localnet VITE_RPC_URL=${API} VITE_SUI_GRPC_URL=${GRPC} bunx --bun vite --config '${VITE_CONFIG}' --port ${PORT} --strictPort`,
    cwd: FRONTEND,
    url: `${BASE}/`,
    // cold dep-optimizer re-bundle after an engine merge legitimately exceeds 120s (r9/r10 2026-07-19); warm boots in ~5s — the budget covers the cold class
    timeout: 360_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
