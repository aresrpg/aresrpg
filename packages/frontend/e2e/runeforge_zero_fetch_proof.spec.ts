// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// RUNEFORGE ZERO-FETCH PROOF — regression: indexer-only reads must incur no load time for
// runeforge. The old ScribePage scanned the chain on mount (get_listable_* -> kiosk_client.getKiosk ->
// SuiGraphQLClient POST graphql.testnet.sui.io — CORS-blocked + 429). The rewrite reads gear/runes/character
// straight from the already-loaded engine store (s.sui.items / s.sui.characters), so OPENING the tab must
// issue ZERO graphql/fullnode requests. This drives the REAL app (dev wallet, testnet) and asserts exactly
// that: settle the boot roster, snapshot the graphql/fullnode request tally, click the Runeforge tab, and
// confirm the tally did not move while the panel mounted + rendered.

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/runeforge_proof'
mkdirSync(SNAP_DIR, { recursive: true })
const snap = async (page: Page, name: string) =>
  writeFileSync(`${SNAP_DIR}/${name}.png`, await page.screenshot({ timeout: 60_000, animations: 'disabled' }))

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// Hosts to avoid: the CORS/429 GraphQL endpoint and the (dead) JSON-RPC fullnode. The app's
// sanctioned uncensored transport is gRPC (a different host) + the keyless /v1 read-API — neither is flagged.
const is_forbidden = (url: string) => /graphql|fullnode/i.test(url)

const sui_state = (page: Page) =>
  page
    .evaluate(async () => {
      const { context } = await import('/src/game/core/game.js')
      const s = context.get_state()
      return { loaded: s.sui.loaded, count: s.sui.characters.length, selected: s.selected_character_id ?? null }
    })
    .catch(() => ({ loaded: false, count: 0, selected: null }))

test('runeforge: opening the tab issues ZERO graphql/fullnode requests (reads the loaded store)', async ({ page }) => {
  test.setTimeout(600_000)

  // record EVERY request with a timestamp so we can scope the assertion to the tab-mount window.
  const reqs: { url: string; t: number }[] = []
  page.on('request', (r) => reqs.push({ url: r.url(), t: Date.now() }))
  const page_errors: string[] = []
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/characters?dev', { waitUntil: 'domcontentloaded' })

  // boot roster resolves for the funded dev wallet (it owns >=1 character — same wallet the paid-char proof uses).
  await expect.poll(async () => (await sui_state(page)).loaded, { timeout: 90_000 }).toBe(true)
  const booted = await sui_state(page)
  expect(booted.count, 'dev wallet owns at least one character').toBeGreaterThan(0)

  // SETTLE: wait until no graphql/fullnode request has fired for a 5s stretch. The roster itself no longer
  // walks kiosks over graphql (load_roster.js's S-?? /v1 cutover: identity comes from the RPC read-API,
  // enrichment is gRPC) — this just absorbs any other in-flight boot traffic before isolating the
  // assertion to the tab-mount window, so nothing chain-direct is left in flight before we click.
  await expect
    .poll(
      () => {
        const now = Date.now()
        return reqs.filter((r) => is_forbidden(r.url) && now - r.t < 5000).length
      },
      { timeout: 120_000, message: 'graphql/fullnode traffic goes quiet after boot' }
    )
    .toBe(0)

  const equip_shot_ts = Date.now()
  await snap(page, '1_characters_equipment_tab')

  // BASELINE: total graphql/fullnode requests seen so far (the boot roster's kiosk walk lives here).
  const forbidden_before = reqs.filter((r) => is_forbidden(r.url))
  const baseline = forbidden_before.length
  console.log(`[proof] graphql/fullnode requests during boot+settle: ${baseline}`)

  // ── ACT: open the RUNEFORGE detail tab ─────────────────────────────────────────────────────────
  const mark = Date.now()
  const runeforge_tab = page.locator('.chrd-tab', { hasText: 'Runeforge' })
  await expect(runeforge_tab, 'the Runeforge detail tab is present').toBeVisible({ timeout: 15_000 })
  await runeforge_tab.click()

  // the ScribePage BODY rendered (crush_title is unique to the panel body, not the tab label)
  await expect(page.getByText('Crush gear into runes', { exact: false })).toBeVisible({ timeout: 15_000 })
  // let any (hypothetical) mount-triggered fetch fire — the whole point is that none does.
  await page.waitForTimeout(5000)
  await snap(page, '2_runeforge_tab_loaded')

  // ── ASSERT: not a single graphql/fullnode request fired from the click onward ───────────────────
  const forbidden_after = reqs.filter((r) => is_forbidden(r.url))
  const during_tab = forbidden_after.filter((r) => r.t >= mark)
  console.log(`[proof] graphql/fullnode requests AFTER opening runeforge: ${during_tab.length}`)
  if (during_tab.length) console.log('[proof] offending urls:', JSON.stringify(during_tab.slice(0, 10), null, 1))
  console.log(`[proof] equipment snap at +${equip_shot_ts - mark}ms relative to tab click`)

  expect(during_tab.length, 'opening the runeforge tab issued NO graphql/fullnode request').toBe(0)
  expect(forbidden_after.length, 'total graphql/fullnode tally unchanged by the tab mount').toBe(baseline)
  expect(page_errors, 'no uncaught page errors during the flow').toEqual([])
})
