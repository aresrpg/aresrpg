// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// BOOT SMOKE — the class killer for the migration-stub throw family (issues #94/#104 seed manifest,
// #106 spell corpus). Serves the freshly built `dist/`, drives the logged-out default page headless,
// and FAILS on any uncaught page error or console.error at boot. A shape-correct-but-empty content
// stub that throws at module load (the migration seam's failure mode) is invisible to lint and unit
// tests but is exactly what this catches: the real browser evaluating the real bundle.
//
// Usage: `node scripts/boot_smoke.mjs` (expects `dist/` already built). Spawns `vite preview`, owns
// its whole lifecycle (started here, killed in the finally), so nothing outlives the run.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const PORT = Number(process.env.SMOKE_PORT ?? 4173)
const BASE = `http://localhost:${PORT}/`
const PROOF_DIR = process.env.SMOKE_PROOF_DIR ?? resolve(FRONTEND, 'smoke-out')
// A durable logged-out landmark: GameWorldHost renders this host div UNCONDITIONALLY (before auth),
// so it exists on the spectate landing. Its presence proves React mounted; its absence is itself a boot failure.
const LANDMARK = '[data-testid="game-world-viewport"]'
// After mount, GameWorldHost lazily boots the spectate scene (`import('./game/embed.js')`), which pulls
// the game chunk — the corpus consumer. We must idle long enough for that deferred import to evaluate
// and surface any module-load throw, whether uncaught (pageerror) or swallowed to console.error.
const SETTLE_MS = 6000
// ALLOWLIST — console.error substrings tolerated at boot. Each entry names its cause. The PRIMARY signal is
// pageerror === 0 (the uncaught migration-stub throw class); console.error catches loud degrades + regressions.
const CONSOLE_ERROR_ALLOWLIST = [
  // #106 — the spell corpus is a runtime blob (spell_corpus.json) the seed ceremony publishes, NEVER a repo
  // artifact. Until it publishes, load_spell_corpus degrades loudly to inert spell surfaces. THIS PR's line.
  '[spell-corpus] no spell_corpus runtime asset',
  // #94 (origin/fix/seed-manifest) — the deployment-pin manifest is absent in the open-source tree;
  // resolve_seed_manifest degrades loudly. Anticipatory: fires once #94 lands (before it, the manifest THROWS,
  // which the pageerror assertion catches). Allowlisted per the ruling's known-content-degrade clause.
  '[seed_manifest] no seed manifest at',
  // Environmental — the headless CI preview has NO backend (RPC / Walrus aggregator / asset host), so boot-time
  // asset & RPC fetches fail. These are BROWSER resource-load failures, not app-code errors; the pageerror
  // assertion is what guards real JS crashes. Never masks a migration-stub throw (those are uncaught, not 404s).
  'Failed to load resource',
]

const allowed = (text) => CONSOLE_ERROR_ALLOWLIST.some((frag) => text.includes(frag))

async function wait_for_server(url, timeout_ms = 60_000) {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`preview server never became ready at ${url}`)
}

mkdirSync(PROOF_DIR, { recursive: true })

const preview = spawn('bunx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: FRONTEND,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let preview_log = ''
preview.stdout.on('data', (d) => (preview_log += d))
preview.stderr.on('data', (d) => (preview_log += d))

const page_errors = []
const console_errors = []
let browser

try {
  await wait_for_server(BASE)

  browser = await chromium.launch()
  const page = await browser.newPage()
  page.on('pageerror', (err) => page_errors.push(String(err?.stack || err?.message || err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console_errors.push(msg.text())
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  let landmark_seen = true
  try {
    await page.waitForSelector(LANDMARK, { timeout: 20_000, state: 'attached' })
  } catch {
    landmark_seen = false
  }

  // Idle so the deferred game-chunk import evaluates and any module-load throw surfaces.
  await page.waitForTimeout(SETTLE_MS)

  const blocking_console = console_errors.filter((t) => !allowed(t))
  const failed = page_errors.length > 0 || blocking_console.length > 0 || !landmark_seen

  const report = [
    `BOOT SMOKE ${failed ? 'FAIL' : 'PASS'} — ${BASE}`,
    `landmark ${LANDMARK}: ${landmark_seen ? 'attached' : 'MISSING (React never mounted)'}`,
    `pageerror events: ${page_errors.length}`,
    ...page_errors.map((e, i) => `  [pageerror ${i}] ${e.split('\n').slice(0, 4).join('\n           ')}`),
    `console.error entries: ${console_errors.length} (blocking ${blocking_console.length})`,
    ...console_errors.map((e, i) => `  [console.error ${i}]${allowed(e) ? ' (allowlisted)' : ''} ${e}`),
    '',
  ].join('\n')

  writeFileSync(resolve(PROOF_DIR, 'boot_smoke_report.txt'), report + preview_log)
  process.stdout.write(report)

  if (failed) {
    process.stderr.write('\nBOOT SMOKE FAILED — a boot-time page error or console.error is present.\n')
    process.exitCode = 1
  } else {
    process.stdout.write('\nBOOT SMOKE PASSED — zero boot-time page errors, zero console.error.\n')
  }
} catch (err) {
  writeFileSync(
    resolve(PROOF_DIR, 'boot_smoke_report.txt'),
    `HARNESS ERROR\n${String(err?.stack || err)}\n${preview_log}`
  )
  process.stderr.write(`\nBOOT SMOKE HARNESS ERROR: ${String(err?.stack || err)}\n`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  preview.kill('SIGTERM')
  // Give vite a beat to release the port; SIGKILL if it clings.
  await new Promise((r) => setTimeout(r, 1000))
  if (!preview.killed) preview.kill('SIGKILL')
}
