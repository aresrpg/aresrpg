// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test, expect, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// GOLD VERTICAL SLICE (docs/GOLD_STANDARD_SUITE.md §10) — the proof the architecture holds:
//   chain truth (localnet publish + seed + admin dials, from up_gold.mjs)
//     → /v1 DISPLAY TRUTH (the indexer+api deployed alongside, anchored to the SAME localnet)
//     → UI TRUTH (the real app, dev wallet injected per-context, roster read off the gold /v1)
//   with TIMING BUDGET assertions (budgets.json — a slow flow IS a failure) and an N-PARALLEL
//   proof (two workers, two wallets, fully parallel — playwright.gold.config.ts).
//
// Determinism: retries 0; ids come from the run manifest, never hardcoded; exact asserts on
// deterministic surfaces (dials, roster counts), structural asserts elsewhere.
// Prereq: `node test/gold/up_gold.mjs` (specs SKIP honestly when the manifest is absent).
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(GOLD, '.gold-deployment.json')
const OUT = path.join(GOLD, 'out')
const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : null
const budgets = JSON.parse(fs.readFileSync(path.join(GOLD, 'budgets.json'), 'utf8'))
const API: string = manifest?.api ?? 'http://127.0.0.1:3100'

fs.mkdirSync(OUT, { recursive: true })

const budget_of = (flow: string): number => {
  const row = budgets.flows.find((r: { flow: string }) => r.flow === flow)
  if (!row) throw new Error(`budgets.json has no flow '${flow}' — budgets are law, never implicit`)
  return row.budget_ms
}

type Timing = { flow: string; ms: number; budget_ms: number | null; pass: boolean }
const record = (rows: Timing[], flow: string, ms: number, budget: number | null) => {
  const pass = budget == null ? true : ms <= budget
  rows.push({ flow, ms, budget_ms: budget, pass })
  console.log(
    `GOLD TIMING ${flow}: ${ms}ms${budget != null ? ` (budget ${budget}ms → ${pass ? 'PASS' : 'FAIL'})` : ''}`
  )
}

/** GET a /v1 view with RTT measurement. */
async function v1(pathname: string): Promise<{ json: any; ms: number }> {
  const t0 = Date.now()
  const r = await fetch(`${API}${pathname}`)
  const json = await r.json()
  return { json, ms: Date.now() - t0 }
}

/** The one shared slice body — parameterized by wallet index (each worker drives its own wallet). */
async function run_slice(page: Page, wallet_index: number) {
  const timings: Timing[] = []
  const wallet = manifest.wallets[wallet_index]
  expect(wallet?.address, `manifest must carry wallet ${wallet_index}`).toBeTruthy()

  // ── 1 · /v1 DISPLAY TRUTH: the admin dials landed on-chain AND project through the indexer ──
  const cfg = await v1('/v1/config')
  record(timings, 'api_rtt', cfg.ms, budget_of('api_rtt'))
  const cfg_str = JSON.stringify(cfg.json)
  expect(
    cfg_str.includes('400'),
    `/v1/config must show the ×4.00 multipliers the admin fixture dialed (raw: ${cfg_str.slice(0, 300)})`
  ).toBe(true)

  // ── 2 · /v1 DISPLAY TRUTH: the seeded world is projected (exact id from the run manifest) ──
  const worlds = await v1('/v1/encyclopedia?kind=worlds')
  expect(
    JSON.stringify(worlds.json).includes(manifest.world_id.slice(2, 42)),
    `/v1/encyclopedia?kind=worlds must contain the seeded world ${manifest.world_id}`
  ).toBe(true)

  // ── 3 · /v1 DISPLAY TRUTH: EXACT roster equality for this wallet (created N ⇒ /v1 shows N) ──
  const expected = manifest.characters.filter((c: { wallet: number }) => c.wallet === wallet_index).length
  const chars = await v1(`/v1/characters?owner=${wallet.address}`)
  const listed = Array.isArray(chars.json?.characters) ? chars.json.characters.length : 0
  expect(
    listed,
    `/v1/characters must show EXACTLY ${expected} for wallet ${wallet_index} (raw: ${JSON.stringify(chars.json).slice(0, 300)})`
  ).toBe(expected)

  // ── 4 · UI TRUTH: the real app boots with THIS wallet and reads its roster off the GOLD /v1 ──
  await page.addInitScript((key: string) => {
    ;(window as unknown as { __ARES_DEV_KEY?: string }).__ARES_DEV_KEY = key
  }, wallet.privkey)

  let roster_read_ms: number | null = null
  let roster_url: string | null = null
  page.on('response', (res) => {
    if (roster_read_ms == null && res.url().includes('/v1/characters')) {
      roster_url = res.url()
      const timing = res.request().timing()
      roster_read_ms = timing.responseEnd >= 0 ? Math.round(timing.responseEnd - timing.startTime) : 0
    }
  })

  // `?dev` + the injected key = the native dev-wallet login (src/auth/dev_wallet.ts is_dev_login —
  // DEV-builds-only, sticky per tab; the documented Playwright pattern).
  await page.goto('/?dev')
  // The app MUST fire its roster read against the GOLD api (VITE_RPC_URL wiring proof).
  await expect
    .poll(() => roster_url, { timeout: 90_000, message: 'the app never requested /v1/characters' })
    .toBeTruthy()
  expect(roster_url!, "the roster read must hit this worktree's GOLD localnet api, not testnet").toContain(
    `${API}/v1/characters`
  )
  record(timings, 'roster_load', roster_read_ms ?? -1, budget_of('roster_load'))

  // UI state equals chain truth (the golden-path live-store read precedent).
  const roster = await page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    return new Promise<{ loaded: boolean; count: number }>((res) => {
      const read = () => {
        const s = (context as { get_state: () => any }).get_state()
        return { loaded: !!s.sui?.loaded, count: s.sui?.characters?.length ?? 0 }
      }
      const tick = () => {
        const r = read()
        if (r.loaded) {
          res(r)
          return true
        }
        return false
      }
      if (tick()) return
      const id = setInterval(() => {
        if (tick()) clearInterval(id)
      }, 300)
      setTimeout(() => {
        clearInterval(id)
        res(read())
      }, 30_000)
    })
  })
  expect(roster.loaded, 'the roster store must resolve (sui.loaded)').toBe(true)
  expect(roster.count, `UI roster count must equal chain truth (${expected})`).toBe(expected)

  // ── 5 · NOT-WIRED axis proof (§7b): enumerate interactive elements (coverage-drift artifact)
  //        + drive one registry click asserting its OBSERVABLE EFFECT (route) — the harness
  //        pattern every lane copies. Safety: only internal <a href> links are clickable here;
  //        buttons may fire txs and are driven ONLY by their owning matrix row (tx-burn law).
  const inventory = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input, select'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').trim().slice(0, 40),
        href: el.getAttribute('href'),
        testid: el.getAttribute('data-testid'),
        aria: el.getAttribute('aria-label'),
      }))
  )
  fs.writeFileSync(
    path.join(OUT, `interactive_inventory_boot_w${wallet_index}.json`),
    JSON.stringify(inventory, null, 2)
  )
  expect(
    inventory.length,
    'the boot screen must expose interactive elements (empty = the app rendered nothing)'
  ).toBeGreaterThan(0)
  const nav = inventory.find((el) => el.href?.startsWith('/') && el.href !== new URL(page.url()).pathname)
  if (nav) {
    const before = new URL(page.url()).pathname
    await page.click(`a[href="${nav.href}"]`, { timeout: 10_000 })
    await expect
      .poll(() => new URL(page.url()).pathname, {
        timeout: 10_000,
        message: `click on a[href="${nav.href}"] had NO effect — not wired`,
      })
      .not.toBe(before)
    console.log(`GOLD NOT-WIRED CHECK: nav click ${before} → ${new URL(page.url()).pathname} (effect: route) PASS`)
  } else {
    console.log('GOLD NOT-WIRED CHECK: no internal nav link on the boot screen — inventory recorded only')
  }

  // ── 6 · pixel-harness proof: a stable UI screenshot artifact (goldens land with the lanes) ──
  await page.screenshot({ path: path.join(OUT, `roster_w${wallet_index}.png`) })

  fs.writeFileSync(path.join(OUT, `timings_w${wallet_index}.json`), JSON.stringify(timings, null, 2))
  const red = timings.filter((t) => !t.pass)
  expect(red, `timing budgets violated: ${JSON.stringify(red)}`).toEqual([])
}

test.describe('gold vertical slice — N parallel workers, M dev wallets, one localnet', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('slice · wallet 0', async ({ page }) => {
    await run_slice(page, 0)
  })
  test('slice · wallet 1', async ({ page }) => {
    await run_slice(page, 1)
  })
})
