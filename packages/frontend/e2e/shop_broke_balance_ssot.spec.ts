// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// SHOP "YOU'RE BROKE" MODAL — single-balance-source-of-truth proof (regression: the modal kept
// showing the OLD balance after a 100 SUI top-up while the sidebar updated live — two homes for one number).
// Fix: shop.tsx now reads `sui_balance_mist` off the SAME `use_auth` store the wallet bar reads (its ONE
// writer is `refresh_sui_balance`) instead of its own local grpc_client.getBalance snapshot — deleted, not
// duplicated. This spec drives the REAL CreateBrokeCard + the REAL use_auth store exactly as shop.tsx wires
// them, and separately proves the panel-opacity fix (bug 2) over a maximally adversarial busy background.
//
// A fresh THROWAWAY keypair (zero balance, generated inline, never funded, never signs anything) supplies
// the dev-login address — no real chain key, no gas, no RPC/docker stack dependency (shop_catalog is faked
// in-store via use_items_shop_chain.setState, sidestepping the local RPC indexer this box doesn't run).
const keypair = new Ed25519Keypair()
const DEV_KEY = keypair.getSecretKey()

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/shop_broke_ssot_proof'
mkdirSync(SNAP_DIR, { recursive: true })
const snap = async (page: Page, name: string) =>
  writeFileSync(`${SNAP_DIR}/${name}.png`, await page.screenshot({ animations: 'disabled' }))

test('shop broke-card: reads the shared balance store live + opaque panel over a busy background', async ({ page }) => {
  const page_errors: string[] = []
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/shop?dev', { waitUntil: 'domcontentloaded' })

  // dev-login bootstrap lands the address in the SAME store shop.tsx now reads for balance_mist.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const { use_auth } = await import('/src/auth/index.ts')
          return use_auth.getState().address
        }),
      { timeout: 30_000, message: 'dev wallet address lands in use_auth' }
    )
    .toBeTruthy()

  // The throwaway address is real and unfunded, so the wallet bar's mount refresh, shop.tsx's own mount
  // refresh, and the broke-card-open refresh (all three legitimately fire against the LIVE store per the
  // fix — that's the point) would each round-trip testnet and settle on the address's REAL (also-zero)
  // balance, racing this proof's synthetic setState calls below. Stub the store's single-writer action to
  // a no-op so this test alone drives `sui_balance_mist` — this only isolates the PROOF from that real
  // network race; it does not touch the reactive read path shop.tsx / CreateBrokeCard actually run through.
  await page.evaluate(async () => {
    const { use_auth } = await import('/src/auth/index.ts')
    use_auth.setState({ refresh_sui_balance: async () => {} })
  })

  // The local RPC indexer isn't running on this box, so the real /v1/shop catalog never loads. Fake ONE
  // sale directly in the shop's OWN chain-store (use_items_shop_chain) — the shop page's real request_buy
  // handler then runs end-to-end against it, exactly as it would against a real chain row. Wait for the
  // real (failing) load() to settle FIRST so it can't race-overwrite this injection afterward (no polling
  // loop re-fires it — load() only runs once on mount).
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const { use_items_shop_chain } = await import('/src/stores/items_shop_chain.ts')
          return use_items_shop_chain.getState().loaded_once
        }),
      { timeout: 30_000 }
    )
    .toBe(true)

  await page.evaluate(() => {
    ;(window as any).__probe_sale = {
      id: 'probe_sale_1',
      template_id: 'probe_item',
      price_mist: '25000000000', // 25 SUI unit price — matches the "~25.2 SUI to complete this purchase" scenario
      supply: 5,
      minted: 0,
      infinite: false,
      treasury: '0x0',
      template: {
        name: 'Probe Item',
        item_type: 'probe_item',
        category: 'CONSUMABLE',
        display: { name: 'Probe Item', description: 'proof fixture' },
      },
    }
  })
  await page.evaluate(async () => {
    const { use_items_shop_chain } = await import('/src/stores/items_shop_chain.ts')
    use_items_shop_chain.setState({ sales: [(window as any).__probe_sale], loaded_once: true })
  })

  // Set the STALE low balance BEFORE opening the card — mirrors the regression scenario (0.038 SUI, can't
  // cover 25 SUI + 0.2 gas) so the broke card opens exactly as it would pre-fix.
  await page.evaluate(async () => {
    const { use_auth } = await import('/src/auth/index.ts')
    use_auth.setState({ sui_balance_mist: 38_000_000n }) // 0.038 SUI
  })

  const buy_btn = page.locator('.buy-row button.btn-gold').first()
  await expect(buy_btn, 'the probe sale renders a buy button').toBeVisible({ timeout: 15_000 })
  await buy_btn.click()

  const card = page.locator('.chr-broke__card')
  await expect(card, 'underfunded click opens the broke card').toBeVisible({ timeout: 10_000 })
  await expect(card, 'shows the stale low balance the modal opened with').toContainText('0.038')

  // ── BUG 2 proof: drop a maximally adversarial dense-text backdrop UNDER the card (stands in for the
  // drop-rates list previously seen bleeding through) and confirm the copy stays readable. ──
  await page.evaluate(() => {
    const bg = document.createElement('div')
    bg.id = 'busy-bg-probe'
    Object.assign(bg.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1',
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#39ff14',
      background: '#1a0033',
      padding: '4px',
      lineHeight: '1.1',
      overflow: 'hidden',
    })
    bg.textContent = Array.from(
      { length: 400 },
      (_, i) => `LEGENDARY DROP RATE 0.0${i % 10}% — Ashen Coil of the Drowned King x${i}`
    ).join(' ')
    document.body.appendChild(bg)
  })
  await snap(page, '1_stale_balance_over_busy_bg')

  // Contrast sanity: the message text color must differ sharply from the injected background lime-on-purple
  // (a translucent panel would blend toward it; an opaque one won't).
  const msg_color = await card.locator('.chr-broke__msg').evaluate((el) => getComputedStyle(el).color)
  const panel_bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor)
  console.log('[proof] message color:', msg_color, '| panel background:', panel_bg)
  expect(msg_color, 'panel copy is not backdrop lime-green (bg bleed-through)').not.toContain('57, 255, 20')

  // ── BUG 1 proof: drive the SAME store the sidebar reads (devtools-equivalent) to 100 SUI — no reopen,
  // no remount — the OPEN modal must follow it live. ──
  await page.evaluate(async () => {
    const { use_auth } = await import('/src/auth/index.ts')
    use_auth.setState({ sui_balance_mist: 100_000_000_000n }) // "funded 100 SUI"
  })
  await expect(card, 'the OPEN modal follows the shared store live').toContainText('100')
  await snap(page, '2_funded_100_sui_live_follow')

  expect(page_errors, 'no uncaught page errors during the flow').toEqual([])
})
