// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Playwright config (§7) — HEADED Chromium against real hardware GPU. The Studio's headed run
// is the source of truth for bench numbers; see bench/harness.js for the documented Linux/CI
// headless recipe (trend-only, never the source of truth per §7/§9.11).
import { defineConfig, devices } from '@playwright/test'

const is_ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: './bench',
  // `.bench.js`, never `.spec.js`: bun's default glob is `**/*.{test,spec}.*` with no exclude, so a
  // playwright scenario named `.spec.js` is unavoidably swept into `bun test` — where it dies on
  // `test.afterEach() called here` and turns the package's suite red for anyone who runs the bare
  // command. One extension per runner keeps the two reaches disjoint by construction (#1705).
  testMatch: '*.bench.js',
  timeout: 60_000,
  fullyParallel: false, // GPU bench: one scenario at a time, never overlap frame captures
  retries: 0,
  reporter: is_ci ? [['list'], ['json', { outputFile: 'bench/results/playwright-report.json' }]] : 'list',
  webServer: {
    command: 'bun run dev',
    // Vite serves no `/` route (the demo lives at /demo/); health-check the demo page itself so
    // `reuseExistingServer` actually detects an already-running `bun run dev` instead of racing a
    // second server onto a taken port and timing out.
    url: 'http://localhost:5199/demo/',
    reuseExistingServer: !is_ci,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://localhost:5199/demo/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'studio-metal-headed',
      use: {
        ...devices['Desktop Chrome'],
        headless: false, // §7: "headed Chromium on the Studio (real Metal GPU; honest vsync)"
        // NO custom launchOptions.args on Mac. Playwright's default headed Chromium already
        // exposes the hardware Metal WebGPU adapter (verified: navigator.gpu → apple/metal-3).
        // Passing `--enable-unsafe-webgpu`/`--enable-features=Vulkan,WebGPU` here actually SUPPRESSES
        // navigator.gpu on this build (Vulkan is Linux/Windows; forcing it drops the Metal path) —
        // the source of the earlier false "WebGPU unavailable" gate failure. Bare launch is correct.
      },
    },
    // Linux/CI headless project — TREND-ONLY, never the source of truth (§7). Requires a
    // Vulkan-capable CI runner. Select explicitly with `--project=ci-headless-vulkan`.
    // Recipe verified against: Promaton's GPU-testing write-up, Krämer's headless-GPU notes,
    // playwright#11627. SwiftShader/software adapters fail the in-page hardware probe by
    // design (bench/harness.js `probe_gpu_adapter`) — a misconfigured runner fails fast.
    {
      name: 'ci-headless-vulkan',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        headless: true,
        launchOptions: {
          args: [
            '--headless=new',
            '--enable-unsafe-webgpu',
            '--use-angle=vulkan',
            '--enable-features=Vulkan,WebGPU',
            '--disable-vulkan-surface',
            '--use-cmd-decoder=passthrough',
          ],
        },
      },
    },
  ],
})
