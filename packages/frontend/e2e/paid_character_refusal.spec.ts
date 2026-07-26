// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// PAID ADDITIONAL CHARACTER — wiring-truth refusal proof (reuse everything; only the entry,
// the live price, and the paid builder are new). Drives the REAL app on testnet with the dev wallet
// (owns a character, balance < the 10 SUI live gate price) and proves the WHOLE paid path refuses
// HONESTLY PRE-SIGN with zero gas:
//   1. the in-world Characters drawer shows the "New character (10 SUI)" entry with the LIVE price
//      (s.sui.character_price_sui read off the on-chain Creation gate by load_roster),
//   2. clicking it with an underfunded wallet hits the D50 broke-gate (price + balance, Add funds) —
//      the first honest refusal layer, before any tx,
//   3. the REAL creator in paid mode shows the price-bearing confirm ("Create · 10 SUI →" + the
//      "Additional character · 10 SUI" header), and submitting drives the REAL store action
//      (create_character_paid → live gate price → create_character_paid_ptb → the S-54 tx choke) —
//      which dry-run REFUSES before signing: an inline humanized error, no digest, balance unchanged.
// That exact refusal = PASS: it proves entry → creator → price display → builder → choke end-to-end.

const SNAP_DIR = process.env.SNAP_DIR ?? '/tmp/paid_char_proof'
mkdirSync(SNAP_DIR, { recursive: true })
// WebGL page — screenshots can be slow; never let a snap flake the proof.
const snap = async (page: Page, name: string) =>
  writeFileSync(`${SNAP_DIR}/${name}.png`, await page.screenshot({ timeout: 60_000, animations: 'disabled' }))

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// navigation-proof: the dev-login bootstrap may navigate/reload mid-poll — a destroyed context reads as
// "not there yet" (null), never a spec crash.
const sui_state = (page: Page) =>
  page
    .evaluate(async () => {
      const { context } = await import('/src/game/core/game.js')
      const s = context.get_state()
      return {
        loaded: s.sui.loaded,
        count: s.sui.characters.length,
        claimed_free: !!s.sui.has_claimed_free_character,
        price_sui: s.sui.character_price_sui ?? null,
        selected: s.selected_character_id ?? null,
      }
    })
    .catch(() => ({ loaded: false, count: 0, claimed_free: false, price_sui: null, selected: null }))

test('paid additional character: live price surfaces and the underfunded flow refuses pre-sign (zero gas)', async ({
  page,
}) => {
  test.setTimeout(600_000) // slow-testnet runs legitimately spend minutes in bounded polls
  const console_lines: string[] = []
  page.on('console', (m) => console_lines.push(m.text()))
  const page_errors: string[] = []
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  // /characters IS the live roster surface (App.tsx route → CharactersDrawer variant="page"; the old
  // in-world launcher dock lives in the orphaned Hud.jsx — mount-tree law).
  await page.goto('/characters?dev', { waitUntil: 'domcontentloaded' })

  // roster resolves for the funded dev wallet (owns ≥1 character → the PAID create routing)
  await expect.poll(async () => (await sui_state(page)).loaded, { timeout: 60_000 }).toBe(true)
  const booted = await sui_state(page)
  expect(booted.count, 'dev wallet owns at least one character (paid routing)').toBeGreaterThan(0)

  // LIVE PRICE WIRING PROOF: load_roster's chain read of the Creation gate lands character_price_sui
  // (10 on testnet right now). Poll — the chain-direct reconcile runs behind the RPC boot roster.
  await expect
    .poll(async () => (await sui_state(page)).price_sui, { timeout: 90_000, message: 'live gate price lands in s.sui' })
    .toBe(10)

  // STABILIZE: a boot-roster/chain-walk race can fire the one-shot embody-reload shortly after boot
  // (roster 0 → 1). Wait until the state holds steady across consecutive reads so a mid-test reload
  // can't destroy the mounted creator.
  let stable = 0
  for (let i = 0; i < 40 && stable < 4; i++) {
    await page.waitForTimeout(1500)
    const s = await sui_state(page)
    stable = s.loaded && s.count > 0 && s.price_sui === 10 ? stable + 1 : 0
  }
  expect(stable, 'roster + live price held stable (no pending reload)').toBeGreaterThanOrEqual(4)

  // wallet truth — the page signs with the injected dev wallet (its balance is read OUT of the page by the
  // runner, before/after this spec: an in-page gRPC read is the exact hung-RPC class with_timeout exists for).
  const wallet_address = await page.evaluate(async () => {
    const { use_auth } = await import('/src/auth/index.ts')
    return use_auth.getState().address
  })
  console.log('[proof] signing wallet:', wallet_address)
  if (process.env.EXPECTED_ADDR) expect(wallet_address).toBe(process.env.EXPECTED_ADDR)

  // ── (1) ENTRY: the characters page's Create affordance carries the LIVE price ──────────────────
  const new_btn = page.locator('.chr-md__create')
  await expect(new_btn, 'the CREATE CHARACTER entry renders for a populated roster').toBeVisible({ timeout: 15_000 })
  await expect(new_btn, 'entry label carries the live price').toContainText('10 SUI')
  await snap(page, '1_entry_price')

  // ── (2) D50 broke-gate: underfunded click → the honest price/balance card, zero tx ─────────────
  await new_btn.click()
  const broke = page.locator('.chr-broke__card')
  await expect(broke, 'underfunded wallet gets the broke card (refusal layer 1)').toBeVisible({ timeout: 10_000 })
  await expect(broke).toContainText('10')
  await snap(page, '2_broke_gate')
  await page.keyboard.press('Escape') // close the card

  // ── (3) the REAL creator in paid mode → price-bearing confirm → REAL submit → choke refusal ────
  // Mount the SAME creator CreateHost mounts, with the SAME paid inputs (count ≥ 1 → paid; live price)
  // and the SAME on_created wiring (create_character_paid). get_balance_sui is omitted — the drawer's
  // broke-gate (proven above) owns the pre-creator balance stop; here we prove the DEEP path: the armed
  // price-bearing confirm and the S-54 choke's pre-sign dry-run refusal on the REAL chain.
  await page.evaluate(async () => {
    const { character_create } = await import('/src/game/screens/character-create.js')
    const { use_expedition } = await import('/src/roster/store.ts')
    const { context } = await import('/src/game/core/game.js')
    const s = context.get_state()
    const color_to_number = (hex: string) => parseInt(String(hex).replace(/^#/, ''), 16)
    const handle = character_create({
      character_count: s.sui.characters.length,
      claimed_free: !!s.sui.has_claimed_free_character,
      price_sui: s.sui.character_price_sui ?? 10,
      on_created: async ({ name, class_id, male, color_1, color_2, color_3 }: any) => {
        await use_expedition.getState().create_character_paid({
          name,
          classe: class_id,
          male: male ?? true,
          color_1: color_to_number(color_1),
          color_2: color_to_number(color_2),
          color_3: color_to_number(color_3),
        })
      },
      on_cancel: () => handle.destroy(),
    })
    document.body.appendChild(handle.root)
  })

  const header = page.locator('.cc__free')
  await expect(header, 'paid header shows the live price').toContainText('10 SUI')
  const confirm = page.locator('.cc__create')
  await page.locator('.cc__name').fill(`paidprobe${Date.now() % 100000}`)
  await expect(confirm, 'confirm button carries the live price (armed)').toContainText('10 SUI')
  await expect(confirm).toBeEnabled()
  await snap(page, '3_price_confirm')

  // REAL submit: builds create_character_paid_ptb with the LIVE gate price and hits the S-54 choke.
  await confirm.click()

  // the refusal surfaces inline (the creator's error line) — the choke refused BEFORE signing
  const err = page.locator('.cc__err')
  await expect
    .poll(async () => (await err.textContent())?.trim() || '', { timeout: 60_000, message: 'inline refusal lands' })
    .not.toBe('')
  const refusal = ((await err.textContent()) ?? '').trim()
  console.log('[proof] inline refusal:', JSON.stringify(refusal))
  await snap(page, '4_refusal')

  // MECHANICAL pre-sign proof — the refusal is the S-54 door's honest insufficient-wallet family
  // (tx/index.ts: an actually-insufficient wallet is rejected at build/submission — no
  // funds move; [gas-guard] lines are reserved for would-abort + ceiling refusals), never a
  // price-read hiccup, and no tx digest exists anywhere (nothing executed).
  const guard_lines = console_lines.filter((l) => l.includes('[gas-guard]'))
  console.log('[proof] gas-guard lines:', JSON.stringify(guard_lines))
  console.log('[proof] console tail:', JSON.stringify(console_lines.slice(-12), null, 1))
  expect(refusal, 'refusal is not a price-read failure').not.toContain('Could not read the on-chain character price')
  const honest_refusal =
    guard_lines.length > 0 ||
    /Insufficient coin balance|resolution failed|Not enough SUI|Couldn't simulate/i.test(refusal)
  expect(honest_refusal, 'the tx door refused pre-sign (insufficient funds / dry-run family)').toBe(true)
  expect(
    console_lines.some((l) => /\[tx\].*digest|executed.*digest/i.test(l)),
    'no transaction was ever executed (no digest anywhere)'
  ).toBe(false)

  // ZERO GAS: the runner reads the on-chain balance before/after this spec (node-side, bounded) and
  // asserts it unchanged — no in-page RPC read (the hung-RPC class).

  expect(page_errors, 'no uncaught page errors during the flow').toEqual([])
})
