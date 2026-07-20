// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-function tests for shop_buy_plan.js — plan_purchase, the ACQUIRE decision (broke card vs the universal
// quantity modal — there is NO straight-buy branch since the 2026-07-18 change). No React, no RPC, no
// chain. GAS_RESERVE_MIST = 0.2 SUI (the house gas reserve the broke gate keys on).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { plan_purchase, MAX_BUY_QUANTITY, STACKABLE_CATS } from './shop_buy_plan'

const SUI = 1_000_000_000n // 1 SUI in MIST
const RESERVE = 200_000_000n // 0.2 SUI gas reserve

// Defaults: a 1-SUI stackable consumable, infinite supply, a comfortable balance.
const plan = (over = {}) =>
  plan_purchase({ price_mist: SUI, category: 'CONSUMABLE', stock: -1, balance_mist: 10n * SUI, ...over })

// ── THE PURCHASABLE-CATEGORY CORPUS ────────────────────────────────────────────────────────────────────────
// The SAME sale sources seed_full_corpus.mjs PHASE 7 folds into `shop::create_sale`: the top-level priced
// catalog (seed/mainnet/shop.json → cosmetics + pets), every optional per-biome shop.json, and the gacha
// boxes (seed/mainnet/pet_boxes.json → boxes). Categories are normalized exactly like shop.tsx's catalog map:
// `(template.category || 'CONSUMABLE').toUpperCase()`. Derived, never hardcoded — a new authored category
// lands in this gate automatically.
const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../seed/mainnet')
const read_json = (p) => JSON.parse(readFileSync(p, 'utf8'))
function purchasable_categories() {
  const top = read_json(path.join(SEED_DIR, 'shop.json'))
  const boxes = read_json(path.join(SEED_DIR, 'pet_boxes.json'))
  const rows = [...(top.cosmetics || []), ...(top.pets || []), ...(boxes.boxes || [])]
  for (const entry of readdirSync(SEED_DIR)) {
    const biome_shop = path.join(SEED_DIR, entry, 'shop.json')
    if (statSync(path.join(SEED_DIR, entry)).isDirectory() && existsSync(biome_shop))
      for (const row of read_json(biome_shop)) rows.push(row)
  }
  return [...new Set(rows.map((row) => String(row.category || 'CONSUMABLE').toUpperCase()))]
}

// THE DIRECTIVE GATE (2026-07-18): buying anything in the shop triggers the modal to ask
// for quantity — previously it only did for lootboxes. The quantity modal is the UNIVERSAL acquire gate: for EVERY
// purchasable category in the live catalog the plan must be modal intent ({kind:'amount'}) — a direct-PTB
// straight buy for NONE. The ask is universal: qty-locked rows (supply 1 / one affordable) still ask at max 1.
describe('plan_purchase — the quantity modal is the universal acquire gate', () => {
  const categories = purchasable_categories()

  test('every purchasable category opens the quantity modal — direct-PTB for NONE', () => {
    // Non-degenerate corpus: the box (CONSUMABLE) plus at least one non-stackable (cosmetic/pet/gear) category.
    expect(categories).toContain('CONSUMABLE')
    expect(categories.some((c) => !STACKABLE_CATS.has(c))).toBe(true)

    // Ample supply + funds: the ONLY acceptable plan is the amount modal, for every category alike.
    const verdicts = categories.map((category) => ({
      category,
      ...plan({ category, stock: 50, balance_mist: 100n * SUI }),
    }))
    expect(verdicts.filter((v) => v.kind !== 'amount')).toEqual([])
  })

  test('single-supply still asks: the modal confirms with qty locked at 1, never a silent straight buy', () => {
    for (const category of categories)
      expect(plan({ category, stock: 1, balance_mist: 100n * SUI })).toEqual({ kind: 'amount', max_qty: 1 })
  })

  test('one affordable unit still asks: the modal confirms with max_qty 1', () => {
    for (const category of categories)
      expect(plan({ category, stock: -1, balance_mist: SUI + RESERVE })).toEqual({ kind: 'amount', max_qty: 1 })
  })
})

describe('plan_purchase — broke card', () => {
  test('balance below one unit + gas reserve → broke, with the unit price in SUI', () => {
    const p = plan({ balance_mist: SUI + RESERVE - 1n }) // one MIST short of the threshold
    expect(p).toEqual({ kind: 'broke', unit_price_sui: 1 })
  })

  test('balance exactly at the threshold is NOT broke (>= passes)', () => {
    expect(plan({ balance_mist: SUI + RESERVE }).kind).not.toBe('broke')
  })

  test('a free item still needs gas — zero balance is broke', () => {
    expect(plan({ price_mist: 0n, balance_mist: 0n }).kind).toBe('broke')
  })
})

describe('plan_purchase — amount picker caps (supply / affordability / on-chain ceiling)', () => {
  test('affordability caps max_qty (each unit reserves price, keep 0.2 SUI back)', () => {
    // (5.2 - 0.2) / 1 = 5 affordable; infinite supply → capped by affordability.
    expect(plan({ balance_mist: 5_200_000_000n })).toEqual({ kind: 'amount', max_qty: 5 })
  })

  test('remaining supply caps max_qty below affordability', () => {
    expect(plan({ balance_mist: 50n * SUI, stock: 3 })).toEqual({ kind: 'amount', max_qty: 3 })
  })

  test('bigint floor on the affordable division (3.7 → 3)', () => {
    expect(plan({ balance_mist: 3_700_000_000n }).max_qty).toBe(3)
  })

  test('MAX_BUY_QUANTITY is the ceiling even with huge balance + infinite supply', () => {
    expect(plan({ balance_mist: 100_000n * SUI })).toEqual({ kind: 'amount', max_qty: MAX_BUY_QUANTITY })
  })

  test('RESOURCE and RUNE are stackable too', () => {
    expect(plan({ category: 'RESOURCE', balance_mist: 5n * SUI }).kind).toBe('amount')
    expect(plan({ category: 'RUNE', balance_mist: 5n * SUI }).kind).toBe('amount')
  })

  test('unknown balance defers to the on-chain cap (no false broke)', () => {
    expect(plan({ balance_mist: null })).toEqual({ kind: 'amount', max_qty: MAX_BUY_QUANTITY })
  })
})
