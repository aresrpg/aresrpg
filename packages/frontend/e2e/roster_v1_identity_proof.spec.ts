// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// ROSTER /v1-IDENTITY PROOF — regression repro: "[load_roster] read TIMED OUT (10000ms), skipped:
// getKiosk 0x0dee…" — the old loader DISCOVERED the roster by walking the wallet's personal kiosks
// (kiosk_client is GraphQL-backed), and a single hung per-kiosk read could silently drop that kiosk's
// characters from the dispatched roster. load_roster.js now sources IDENTITY from `/v1/characters?owner=`
// only (never a kiosk walk) — this drives the real app (dev wallet, testnet) and proves: the roster renders
// the dev wallet's real characters, zero kiosk-flavoured graphql requests fire, and the load resolves in
// well under the old 10s stall.

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/roster_proof'
mkdirSync(SNAP_DIR, { recursive: true })
const snap = async (page: Page, name: string) =>
  writeFileSync(`${SNAP_DIR}/${name}.png`, await page.screenshot({ timeout: 60_000, animations: 'disabled' }))

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

const sui_state = (page: Page) =>
  page
    .evaluate(async () => {
      const { context } = await import('/src/game/core/game.js')
      const s = context.get_state()
      return {
        loaded: s.sui.loaded,
        count: s.sui.characters.length,
        names: s.sui.characters.map((c: any) => c.name),
        load_error: s.sui.load_error,
      }
    })
    .catch(() => ({ loaded: false, count: 0, names: [], load_error: null }))

test('roster: /v1 identity only — zero getKiosk/kiosk-graphql traffic, no 10s stall', async ({ page }) => {
  test.setTimeout(120_000)

  const v1_hits: string[] = []
  const kiosk_graphql_hits: { url: string; body: string }[] = []
  page.on('request', (r) => {
    const url = r.url()
    if (/\/v1\/characters/.test(url)) v1_hits.push(url)
    if (/graphql\.testnet\.sui\.io|graphql\.mainnet\.sui\.io/i.test(url)) {
      const body = r.postData() ?? ''
      if (/kiosk/i.test(body) || /kiosk/i.test(url)) kiosk_graphql_hits.push({ url, body })
    }
  })
  const page_errors: string[] = []
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)

  const t0 = Date.now()
  await page.goto('/characters?dev', { waitUntil: 'domcontentloaded' })

  await expect.poll(async () => (await sui_state(page)).loaded, { timeout: 30_000 }).toBe(true)
  const t_loaded = Date.now() - t0
  const state = await sui_state(page)

  console.log(`[proof] roster loaded=${state.loaded} count=${state.count} names=${JSON.stringify(state.names)}`)
  console.log(`[proof] time to sui.loaded === true: ${t_loaded}ms`)
  console.log(`[proof] /v1/characters requests: ${v1_hits.length} -> ${JSON.stringify(v1_hits)}`)
  console.log(`[proof] kiosk-flavoured graphql requests: ${kiosk_graphql_hits.length}`)
  if (kiosk_graphql_hits.length) console.log(JSON.stringify(kiosk_graphql_hits, null, 1))

  // let the (lazy-loaded) CharactersDrawer page variant actually paint the roster before the screenshot
  // (.chrx-row = CharactersDrawer.jsx's RosterEntry row)
  await expect(page.locator('.chrx-row').first()).toBeVisible({ timeout: 15_000 })
  await snap(page, 'characters_page_loaded')

  expect(state.count, 'dev wallet roster renders (non-empty, no false-empty)').toBeGreaterThan(0)
  expect(v1_hits.length, 'at least one /v1/characters read fired').toBeGreaterThan(0)
  expect(kiosk_graphql_hits.length, 'zero kiosk-walk graphql requests').toBe(0)
  expect(t_loaded, 'roster resolves well under the old 10s getKiosk stall').toBeLessThan(5000)
  expect(page_errors, 'no uncaught page errors').toEqual([])
})
