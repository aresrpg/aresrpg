// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

// S-53 — boot roster from the RPC indexer. A FRESH (empty) address must resolve to the CREATE screen in
// ONE /v1/characters call, under a second, with ZERO teleport into a fight. Set VITE_DEV_KEY to a fresh,
// never-before-used Ed25519 testnet key (an unknown owner guarantees the RPC returns { "characters": [] })
// — generate one with `bun packages/rpc/gas-pool/generate-keypair.mjs` or `sui keytool generate ed25519`.
// ADDR is derived from the key at runtime (mirrors dev_wallet.ts's dev_session()) — never hardcoded, so it
// always matches whatever key the env supplies.
const DEV_KEY = process.env.VITE_DEV_KEY ?? ''
const ADDR = DEV_KEY
  ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(DEV_KEY).secretKey).getPublicKey().toSuiAddress()
  : ''

const store = (page: Page) =>
  page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    const s = context.get_state()
    return {
      loaded: s.sui.loaded,
      count: s.sui.characters.length,
      selected: s.selected_character_id ?? null,
      fight_mode: !!s.fight_mode,
      load_error: s.sui.load_error ?? null,
    }
  })

const dungeon_state = (page: Page) =>
  page.evaluate(async () => {
    const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
    const d = use_dungeon.getState()
    return { dungeon_id: d.dungeon_id ?? null, in_session: !!d.in_session }
  })

test('S-53: fresh address boots to CREATE in one /v1/characters call, no teleport', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  // capture every /v1/characters request + its wall-clock network duration
  const charFetches: { url: string; ms: number }[] = []
  page.on('requestfinished', (req) => {
    if (!req.url().includes('/v1/characters')) return
    const t = req.timing()
    charFetches.push({ url: req.url(), ms: Math.round(t.responseEnd - t.requestStart) })
  })

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/?dev', { waitUntil: 'domcontentloaded' })

  // the roster RESOLVES (boot_roster's RPC dispatch flips sui.loaded true)
  await expect.poll(async () => (await store(page)).loaded, { timeout: 30_000 }).toBe(true)

  const s = await store(page)
  const d = await dungeon_state(page)
  console.log(
    '[s53] store',
    JSON.stringify(s),
    'dungeon',
    JSON.stringify(d),
    'charFetches',
    JSON.stringify(charFetches)
  )

  // (1) empty roster, cleanly confirmed (not a degraded read)
  expect(s.count, 'fresh address roster is empty').toBe(0)
  expect(s.load_error, 'no load error → confirmed-empty, not a degraded/false read').toBeNull()

  // (2) exactly ONE /v1/characters call, targeting our address, under a second
  expect(charFetches.length, 'exactly one /v1/characters call on boot').toBe(1)
  expect(charFetches[0].url).toContain(ADDR)
  expect(charFetches[0].ms, 'the characters call resolved under 1s').toBeLessThan(1000)

  // (3) ZERO teleport — no fight, no dungeon session
  expect(s.fight_mode, 'no fight mode (no teleport into a fight)').toBe(false)
  expect(d.dungeon_id, 'no dungeon session (no teleport into a dungeon)').toBeNull()
  expect(d.in_session, 'no live dungeon session').toBe(false)

  // (4) the CREATE screen is shown. GameWorldHud's onboarding gate renders <ExpeditionCreate /> exactly when
  // `!has_character && loaded && !load_error` — the state proven above. Its real create form carries a name
  // input + PLAY button; asserting the input proves the create screen actually mounted (not just the state).
  await expect(page.locator('input.cc__name'), 'confirmed-empty routes to the CREATE screen').toBeVisible({
    timeout: 20_000,
  })

  writeFileSync('/tmp/s53_boot.png', await page.screenshot())

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
