// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// L1 ANCHOR Playwright config (docs/GOLD_STANDARD_SUITE.md §11) — the REAL frontend running FULLY on the gold
// localnet: VITE_NETWORK=localnet teaches the SDK 'localnet' (deployment resolver reads the run's ids off the
// injected globalThis.__ARES_LOCALNET_IDS), VITE_SUI_GRPC_URL points every chain-direct read/build at the
// localnet fullnode, VITE_RPC_URL anchors /v1 display reads. This is DISTINCT from playwright.gold.config.ts
// (the testnet-anchored vertical slice); the two configs run separate Vite servers on separate ports so the
// proven slice stays green while the anchor proves in-UI localnet reads + writes.
//
//   run:  cd packages/frontend && bunx playwright test --config ../../test/gold/playwright.anchor.config.ts
//
// Port 5491 — NEVER the primary dev server's port, the reserved companion ports, or the slice's 5490.
const GOLD = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(GOLD, '..', '..', 'packages', 'frontend')
const MANIFEST = path.join(GOLD, '.gold-deployment.json')
const VITE_CONFIG = path.join(GOLD, 'vite.anchor.config.ts')
const VITE_CACHE_DIR = path.join(FRONTEND, 'node_modules', '.vite')
const LAGGED_VITE_CACHE_DIR = path.join(FRONTEND, 'node_modules', '.vite-lagged')
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null

const PORT = Number(process.env.ANCHOR_PORT ?? 5491)
const BASE = `http://localhost:${PORT}`
const API = manifest?.api ?? 'http://127.0.0.1:3100'
const GRPC = manifest?.rpc ?? 'http://127.0.0.1:9100'
// SPONSOR FIXTURE (r11 anchor gate — 75a49b78 sponsor-first fix): the anchor rig never wired this, so a
// ≤0.2-SUI wallet's sponsor-first tx hit the frontend's dev-default VITE_SPONSOR_URL (an absolute URL nothing
// in this sandbox listens on) and the /reserve POST rejected with a raw browser "Failed to fetch" instead of
// exercising the REAL sponsored path. up_gold.mjs already boots a real local sponsor and writes its endpoint
// into the SAME manifest API/GRPC read above (`sponsor_fixture.endpoint`, e.g. http://127.0.0.1:PORT/api/sponsor
// — sponsor_compose.test.mjs already asserts against it); mirror that read here.
const SPONSOR = manifest?.sponsor_fixture?.endpoint ?? 'http://127.0.0.1:3102/api/sponsor'

// LANE LAG (lane_reports/CLI_TEST_AUDIT.md #5) — a second Vite instance, identical to the primary one below
// except VITE_RPC_URL points at proxy_lag.mjs instead of API directly. The proxy is a pure delay passthrough
// to the SAME API, so any spec tagged @lagged runs byte-identical logic under induced /v1 latency: green under
// `chromium`/`chromium-headed`, red under `lagged` = the prod-timing composition gap, caught on localnet.
const LAG_PORT = Number(process.env.LAG_PORT ?? 3101)
const LAG_BASE = `http://127.0.0.1:${LAG_PORT}`
const LAGGED_PORT = Number(process.env.LAGGED_PORT ?? 5492)
const LAGGED_BASE = `http://localhost:${LAGGED_PORT}`
const PROXY_SCRIPT = path.join(GOLD, 'proxy_lag.mjs')
// SENTINEL-SPARE WRAP (coordinator 07-19): playwright DETACHES its webServer children, so the anchor vites
// reparent to launchd (ppid=1) and the standing orphan-sweeper reaps them lane-path within 15s (KILLS.log
// 15:40:20 · both 5491/5492). Wrapping each long-lived server in bounded-run.sh registers a /tmp/agent-leases
// entry the sweeper spares AND keeps a live babysitting parent; its own teardown sweep also frees the ports on
// exit (killing the leftover-proxy 3101 conflict). `env` (not a shell prefix) carries the per-server vars so
// bounded-run's argv stays a clean command. Portable lanes can provide GOLD_RUN_WRAPPER; the legacy Mac wrapper
// remains the default only where it is installed, while every other environment launches the command directly.
const LEGACY_GOLD_RUN_WRAPPER = '/Users/sceatstudio/.claude/hooks/bounded-run.sh'
const GOLD_RUN_WRAPPER =
  process.env.GOLD_RUN_WRAPPER ?? (fs.existsSync(LEGACY_GOLD_RUN_WRAPPER) ? LEGACY_GOLD_RUN_WRAPPER : '')
const with_gold_run_wrapper = (command: string) => (GOLD_RUN_WRAPPER ? `${GOLD_RUN_WRAPPER} ${command}` : command)

export default defineConfig({
  // OWN testDir (specs_anchor/), disjoint from the slice's specs/ — so the testnet-default gold config never
  // picks up this localnet-only spec (running it there would 404 every chain-direct read against testnet).
  testDir: path.join(GOLD, 'specs_anchor'),
  outputDir: path.join(GOLD, 'out', 'pw-anchor'),
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0, // determinism law — a flaky test is a bug, never a reroll
  reporter: [['list']],
  // MECHANICAL TREE-FREEZE — no lane writes during a suite run: setup fingerprints the working
  // tree, teardown recomputes and THROWS on drift (suite-owned artifact paths filtered out).
  globalSetup: path.join(GOLD, 'tree_freeze_setup.ts'),
  globalTeardown: path.join(GOLD, 'tree_freeze_teardown.ts'),
  use: {
    baseURL: BASE,
    headless: true,
    trace: 'retain-on-failure',
    video: 'on', // DoD: capture the full-fight video as proof
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  projects: [
    { name: 'chromium', grepInvert: /@headed/, use: { ...devices['Desktop Chrome'] } },
    {
      // Headed Metal is the suite's WebGPU source of truth (docs §6); keep the one tactical row serialized.
      name: 'chromium-headed',
      grep: /@headed/,
      use: { ...devices['Desktop Chrome'], headless: false, serviceWorkers: 'block' },
    },
    {
      // LANE LAG's standing red row: @lagged specs are ALSO @headed (WebGPU), so this mirrors chromium-headed
      // exactly except for baseURL — same test body, same assertions, only the /v1 timing underneath differs.
      name: 'lagged',
      grep: /@lagged/,
      use: { ...devices['Desktop Chrome'], headless: false, serviceWorkers: 'block', baseURL: LAGGED_BASE },
    },
  ],
  webServer: [
    {
      // The L1 seam in one line: VITE_NETWORK=localnet (DEMO_NETWORK → SDK network 'localnet'), the localnet
      // gRPC endpoint (SDK chain-direct reads + tx build), the gold /v1 read-api, and the gold rig's REAL local
      // sponsor fixture (VITE_SPONSOR_URL) — without it the frontend falls through to its dev-default sponsor
      // URL, nothing answers, and a ≤0.2-SUI wallet's sponsor-first tx dies "Failed to fetch" (r11 anchor gate).
      command: with_gold_run_wrapper(
        `env GOLD_VITE_CACHE_DIR=${VITE_CACHE_DIR} VITE_NETWORK=localnet VITE_RPC_URL=${API} VITE_SUI_GRPC_URL=${GRPC} VITE_SPONSOR_URL=${SPONSOR} bunx --bun vite --config ${VITE_CONFIG} --port ${PORT} --strictPort`
      ),
      cwd: FRONTEND,
      url: `${BASE}/`,
      // cold dep-optimizer re-bundle after an engine merge legitimately exceeds 120s (r9/r10 2026-07-19); warm boots in ~5s — the budget covers the cold class
      timeout: 360_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The LAG lane's delay proxy — forwards every request to the SAME API the primary server talks to directly,
      // after a 700ms+jitter delay (proxy_lag.mjs defaults). READINESS is the proxy's OWN listen socket (`port`),
      // NOT a probe THROUGH it to /v1: the upstream API is the rig's precondition (up_gold waits on it), exactly
      // like the two Vite servers whose readiness is their own `/`, never a downstream /v1 call. Probing
      // /v1/status made the whole gate hostage to a live rig — a dead upstream → Bun 500 → never Playwright's
      // `<404` → 30s webServer timeout, zero tests collected. The proxy is ready the instant it binds :3101;
      // broken forwarding surfaces as a clear spec failure, not an opaque gate hang.
      command: with_gold_run_wrapper(`bun ${PROXY_SCRIPT}`),
      env: { ...process.env, LAG_UPSTREAM: API, LAG_PORT: String(LAG_PORT) },
      port: LAG_PORT,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Same seam as the primary server; VITE_RPC_URL swaps to the lag proxy and cacheDir is isolated so the two
      // cold-start optimizers never mutate one dependency graph concurrently. VITE_SPONSOR_URL is NOT routed
      // through the lag proxy (the fixture sponsor is the rig's own precondition, same as API/GRPC above) — the
      // lagged lane exercises /v1 latency, not sponsor latency.
      command: with_gold_run_wrapper(
        `env GOLD_VITE_CACHE_DIR=${LAGGED_VITE_CACHE_DIR} VITE_NETWORK=localnet VITE_RPC_URL=${LAG_BASE} VITE_SUI_GRPC_URL=${GRPC} VITE_SPONSOR_URL=${SPONSOR} bunx --bun vite --config ${VITE_CONFIG} --port ${LAGGED_PORT} --strictPort`
      ),
      cwd: FRONTEND,
      url: `${LAGGED_BASE}/`,
      // cold dep-optimizer re-bundle after an engine merge legitimately exceeds 120s (r9/r10 2026-07-19); warm boots in ~5s — the budget covers the cold class
      timeout: 360_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
