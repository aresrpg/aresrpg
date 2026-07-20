import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// MARKETPLACE SELL ZERO-CHAIN PROOF (S-87 — production regression: the SELL picker's
// get_listable_items/get_listable_characters walked the player's kiosk via the Mysten kiosk SDK
// (kiosk_client.getKiosk -> getAllDynamicFields -> GraphQL graphql.testnet.sui.io) — CORS-dead, the SAME
// banned class the BUY path (S-86) and Runeforge (07-10, runeforge_zero_fetch_proof.spec.ts) already
// retired. The rewrite reads keyless /v1/owner-items + /v1/characters?owner= (packages/rpc) instead — no
// SDK, no gRPC, no GraphQL. OPENING the SELL tab must issue ZERO graphql/fullnode requests.

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/marketplace_sell_proof'
mkdirSync(SNAP_DIR, { recursive: true })
const snap = async (page: Page, name: string) =>
  writeFileSync(`${SNAP_DIR}/${name}.png`, await page.screenshot({ timeout: 60_000, animations: 'disabled' }))

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// Hosts to avoid: the CORS/429 GraphQL endpoint and the (dead) JSON-RPC fullnode. The app's
// sanctioned uncensored transport is gRPC (a different host) + the keyless /v1 read-API — neither is flagged.
const is_forbidden = (url: string) => /graphql|fullnode/i.test(url)

test('marketplace SELL tab: opening it issues ZERO graphql/fullnode requests (reads /v1 owner-items + characters)', async ({
  page,
}) => {
  test.setTimeout(600_000)

  // record EVERY request with a timestamp so we can scope the assertion to the tab-mount window.
  const reqs: { url: string; t: number }[] = []
  page.on('request', (r) => reqs.push({ url: r.url(), t: Date.now() }))
  const page_errors: string[] = []
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/marketplace?dev', { waitUntil: 'domcontentloaded' })

  // the BUY-path /v1/listings load settles — the marketplace shell renders past its full-screen spinner
  // and the ARIA tablist (mkt-tab-BUY/SELL/HISTORY, marketplace.tsx) mounts.
  const sell_tab = page.locator('#mkt-tab-SELL')
  await expect(sell_tab, 'the SELL tab is present (BUY-path load settled)').toBeVisible({ timeout: 60_000 })

  // SETTLE: wait until no graphql/fullnode request has fired for a 5s stretch — absorbs any other
  // in-flight boot traffic before isolating the assertion to the tab-mount window.
  await expect
    .poll(
      () => {
        const now = Date.now()
        return reqs.filter((r) => is_forbidden(r.url) && now - r.t < 5000).length
      },
      { timeout: 120_000, message: 'graphql/fullnode traffic goes quiet after boot' }
    )
    .toBe(0)
  await snap(page, '1_marketplace_buy_settled')

  // BASELINE: total graphql/fullnode requests seen so far (should be 0 — the BUY path is /v1-only too).
  const baseline = reqs.filter((r) => is_forbidden(r.url)).length
  console.log(`[proof] graphql/fullnode requests during boot+settle: ${baseline}`)

  // ── ACT: open the SELL tab — mounts SellPanel, fires load_listable() -> get_listable_items/characters ──
  const mark = Date.now()
  await sell_tab.click()
  // "Your Listings" (col 1 header) is unique to the mounted SellPanel body, unlike the "SELL" tab label itself.
  await expect(page.getByText('Your Listings', { exact: false }), 'SellPanel body mounted').toBeVisible({
    timeout: 15_000,
  })
  // let any (hypothetical) mount-triggered chain fetch fire — the whole point is that none does.
  await page.waitForTimeout(5000)
  await snap(page, '2_sell_tab_loaded')

  // ── ASSERT: not a single graphql/fullnode request fired from the click onward ──
  const forbidden_after = reqs.filter((r) => is_forbidden(r.url))
  const during_tab = forbidden_after.filter((r) => r.t >= mark)
  console.log(`[proof] graphql/fullnode requests AFTER opening SELL: ${during_tab.length}`)
  if (during_tab.length) console.log('[proof] offending urls:', JSON.stringify(during_tab.slice(0, 10), null, 1))

  expect(during_tab.length, 'opening the SELL tab issued NO graphql/fullnode request').toBe(0)
  expect(forbidden_after.length, 'total graphql/fullnode tally unchanged by the tab mount').toBe(baseline)
  expect(page_errors, 'no uncaught page errors during the flow').toEqual([])
})
