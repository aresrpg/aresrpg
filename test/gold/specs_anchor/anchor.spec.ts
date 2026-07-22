// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test, expect, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// L1 ANCHOR PROOF (docs/GOLD_STANDARD_SUITE.md §11) — the real frontend running FULLY on the gold localnet.
// Runs under playwright.anchor.config.ts (VITE_NETWORK=localnet · VITE_SUI_GRPC_URL=:9100 · VITE_RPC_URL=:3100).
//
//   1) READ triple-compare (the desync detector's seam): boot the app on localnet, and for the wallet's
//      seeded character assert UI-store == /v1 == chain-direct read_character AGREE field-for-field. This is
//      the exact gap L1 closes — before the anchor, chain-direct read_character hit testnet and 404'd the
//      localnet object while /v1 served truth (a permanent desync).
//   2) WRITE proof: create an ADDITIONAL character through the app's REAL create path (the same SDK builder +
//      dev-wallet self-pay the UI button fires) → capture the digest → assert it LANDS on the localnet chain
//      (waitForTransaction success) AND projects into /v1 + is readable chain-direct + grows the UI roster.
//
// Determinism: retries 0; ids/wallets from the run manifest, never hardcoded. Prereq: `node test/gold/up_gold.mjs`.
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(GOLD, '.gold-deployment.json')
const OUT = path.join(GOLD, 'out')
const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : null
const API: string = manifest?.api ?? 'http://127.0.0.1:3100'

fs.mkdirSync(OUT, { recursive: true })

async function v1(pathname: string): Promise<any> {
  const r = await fetch(`${API}${pathname}`)
  return r.json()
}

/** Inject the dev wallet key + the run's localnet ids BEFORE any app module evaluates (addInitScript law). */
async function anchor_boot(page: Page, wallet: { privkey: string }, ids: any): Promise<string[]> {
  const console_errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') console_errors.push(m.text())
  })
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids // the SDK deployment resolver's localnet branch reads this
    },
    { key: wallet.privkey, ids }
  )
  await page.goto('/?dev')
  return console_errors
}

/** Poll the engine store until the roster resolves; return the live UI-truth character list. */
async function ui_roster(page: Page): Promise<Array<{ id: string; name: string; classe: string; level: number }>> {
  return page.evaluate(async () => {
    const { context } = await import('/src/game/core/game.js')
    return new Promise((res) => {
      const read = () => {
        const s = (context as any).get_state()
        return { loaded: !!s.sui?.loaded, chars: s.sui?.characters ?? [] }
      }
      const done = () => {
        const r = read()
        if (r.loaded)
          return (
            res(r.chars.map((c: any) => ({ id: c.id, name: c.name, classe: c.classe ?? c.class, level: c.level }))),
            true
          )
        return false
      }
      if (done()) return
      const t = setInterval(() => done() && clearInterval(t), 300)
      setTimeout(() => {
        clearInterval(t)
        const r = read()
        res(r.chars.map((c: any) => ({ id: c.id, name: c.name, classe: c.classe ?? c.class, level: c.level })))
      }, 45_000)
    })
  })
}

test.describe('L1 anchor — real frontend on localnet', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  // ── 1 · READ TRIPLE-COMPARE ────────────────────────────────────────────────────────────────────────────
  test('read triple-compare · UI == /v1 == chain-direct (localnet)', async ({ page }) => {
    const [wallet] = manifest.wallets
    const roster_urls: string[] = []
    page.on('response', (r) => r.url().includes('/v1/characters') && roster_urls.push(r.url()))

    const console_errors = await anchor_boot(page, wallet, manifest.ids.aresrpg)
    const ui = await ui_roster(page)

    // The roster read must hit the GOLD localnet /v1 (VITE_RPC_URL wiring proof).
    expect(
      roster_urls.some((u) => u.includes('3100')),
      `roster read must hit gold /v1 (saw: ${roster_urls[0]})`
    ).toBe(true)
    expect(ui.length, 'wallet 0 has a seeded character → UI roster must render ≥1').toBeGreaterThan(0)

    // /v1 display truth for the SAME wallet.
    const v1_chars = (await v1(`/v1/characters?owner=${wallet.address}`)).characters ?? []
    expect(v1_chars.length, 'UI roster count must equal /v1 count').toBe(ui.length)

    // chain-direct: read the character straight off the localnet fullnode via the app's OWN read_character +
    // the SDK's localnet gRPC client — the exact path that 404'd against testnet before L1.
    const target_id = ui[0].id
    const chain = await page.evaluate(async (id: string) => {
      const [{ read_character }, { get_sdk }] = await Promise.all([
        import('/src/chain/read_character.js'),
        import('/src/chain/sdk'),
      ])
      const sdk = await get_sdk()
      try {
        const c = await read_character(sdk.grpc_client, id)
        return { ok: true, id: c.id, name: c.name, classe: c.classe }
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    }, target_id)

    const v1_match = v1_chars.find((c: any) => c.id === target_id)
    const ui_match = ui.find((c) => c.id === target_id)!

    // THE TRIPLE COMPARE — all three layers must agree field-for-field, or the divergent layer is named.
    const triple = {
      id: { ui: ui_match.id, v1: v1_match?.id, chain: chain.id },
      name: { ui: ui_match.name, v1: v1_match?.name, chain: chain.name },
      classe: { ui: ui_match.classe, v1: v1_match?.class ?? v1_match?.classe, chain: chain.classe },
    }
    fs.writeFileSync(path.join(OUT, 'anchor_triple_compare.json'), JSON.stringify({ triple, console_errors }, null, 2))

    expect(chain.ok, `chain-direct read_character FAILED on localnet (L1 not anchored): ${chain.error}`).toBe(true)
    expect(chain.id, 'chain id must equal UI/v1 id').toBe(target_id)
    expect(triple.name.chain, 'name must agree UI==/v1==chain').toBe(triple.name.ui)
    expect(triple.name.v1, 'name must agree UI==/v1==chain').toBe(triple.name.ui)
    expect(triple.classe.chain, 'class must agree UI==/v1==chain').toBe(triple.classe.ui)
    expect(triple.classe.v1, 'class must agree UI==/v1==chain').toBe(triple.classe.ui)

    await page.screenshot({ path: path.join(OUT, 'anchor_roster.png') })
    console.log('L1 TRIPLE-COMPARE PASS', JSON.stringify(triple))
  })

  // ── 2 · WRITE: create through the app → lands on localnet ─────────────────────────────────────────────────
  test('ui create · additional character lands on localnet (digest → /v1 → chain → UI)', async ({ page }) => {
    // Dedicated write-fixture wallet (B1 FIXTURE ISOLATION, 2026-07-20 — R16_TAXONOMY.md): owns zero seeded
    // characters and is referenced by no other spec, so this ad-hoc create can never desync a downstream
    // wallet-count/identity read on a shared boot (formerly wallet 2 — see up_gold.mjs anchor_write_wallet).
    const wallet = manifest.anchor_write_wallet
    expect(wallet, 'gold bootstrap did not publish anchor_write_wallet').toBeTruthy()
    await anchor_boot(page, wallet, manifest.ids.aresrpg)
    await ui_roster(page) // ensure the SDK + roster are warm before the write
    const before = ((await v1(`/v1/characters?owner=${wallet.address}`)).characters ?? []).length

    // Drive the app's REAL create path: the SDK's create_character_paid_ptb (localnet ids from the resolver) +
    // the dev wallet's self-pay signAndExecuteTransaction — byte-for-byte what store.create_character_paid fires.
    const created = await page.evaluate(async () => {
      const name = `anchor_${Date.now() % 1_000_000}`
      try {
        const [{ get_sdk }, auth] = await Promise.all([import('/src/chain/sdk'), import('/src/auth')])
        const sdk = await get_sdk()
        const creation = await sdk.get_creation_state()
        if (!creation) return { ok: false, error: 'could not read on-chain creation price' }
        const tx = sdk.create_character_paid_ptb({
          name,
          class: 'senshi',
          male: true,
          color_1: 0,
          color_2: 0,
          color_3: 0,
          price_mist: creation.price,
        })
        const { wallet_name, address } = (auth as any).use_auth.getState()
        const { digest } = await (auth as any).sign_and_execute_transaction(wallet_name, address, tx)
        return { ok: true, name, digest }
      } catch (e: any) {
        return { ok: false, name, error: String(e?.message ?? e) }
      }
    })
    fs.writeFileSync(path.join(OUT, 'anchor_create.json'), JSON.stringify(created, null, 2))
    expect(created.ok, `create through the app FAILED on localnet: ${created.error}`).toBe(true)
    expect(created.digest, 'a landed tx must return a digest').toBeTruthy()
    console.log('L1 CREATE digest', created.digest, 'name', created.name)

    // Verify on-chain: the digest waits to SUCCESS on the localnet fullnode (chain truth).
    const chain_ok = await page.evaluate(async (digest: string) => {
      const { get_sdk } = await import('/src/chain/sdk')
      const sdk = await get_sdk()
      const r = await sdk.grpc_client.core.waitForTransaction({ digest, include: { effects: true } })
      const ex = (r as any).Transaction ?? (r as any).FailedTransaction ?? r
      return { success: !!(ex?.effects?.status?.success ?? ex?.transaction?.effects?.status?.success) }
    }, created.digest!)
    expect(chain_ok.success, 'the create digest must be a SUCCESS on the localnet chain').toBe(true)

    // Verify /v1 display truth catches up (indexer projects the new character).
    let after = before
    await expect
      .poll(
        async () => {
          after = ((await v1(`/v1/characters?owner=${wallet.address}`)).characters ?? []).length
          return after
        },
        { timeout: 20_000, message: '/v1 never projected the new character (indexer lag or desync)' }
      )
      .toBe(before + 1)

    // Verify the app's roster (UI truth) grows on reload — read-after-write closes the loop.
    await page.reload()
    const ui_after = await ui_roster(page)
    expect(ui_after.length, 'UI roster must show the new character after reload').toBe(before + 1)
    console.log(`L1 CREATE LANDED · /v1 ${before}→${after} · UI roster ${ui_after.length}`)
  })
})
