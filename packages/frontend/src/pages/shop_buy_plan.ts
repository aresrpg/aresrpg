// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SHOP BUY DECISION — the pure transform behind the ACQUIRE button: given a catalog row's price/supply and the
// wallet balance, decide whether to (a) show the restored "you're broke" card or (b) open the quantity modal.
// THE MODAL IS THE UNIVERSAL GATE (2026-07-18): buying anything in the shop triggers the modal to ask
// for quantity — previously it only did for lootboxes. EVERY purchasable category — boxes,
// cosmetics, gear, pets, consumables, resources — passes through the amount modal BEFORE the buy PTB composes.
// There is NO direct-buy branch; qty-locked rows (supply 1 / one affordable unit) still ask, capped at 1. The
// chain supports every shape: shop.move `buy_many` mints ONE amount-N stack for stackables and N unique rolled
// items for gear/cosmetics. Kept pure + separate from shop.tsx so the money branching is unit-testable
// (shop_buy_plan.test.js) without booting React/the engine/auth.

import { GAS_RESERVE_MIST } from '../utils/sui_mist'

// Mirror of on-chain item::is_stackable_category (consumable / resource / rune — pet boxes are consumables).
// Since the universal-modal law this no longer gates ANY branch here — it distinguishes the MINT SHAPE for the
// optimistic paint in shop.tsx: a stackable buy mints ONE quantity-N object; a non-stackable buy mints one
// object per unit (each independently rolled on-chain).
export const STACKABLE_CATS = new Set(['CONSUMABLE', 'RESOURCE', 'RUNE'])

// Client mirror of aresrpg::shop MAX_BUY_QUANTITY (the on-chain per-`buy_many` gas backstop). The SDK's
// buy_many_ptb re-clamps as the real enforcer, so this only bounds the picker — a drift can only be safe.
export const MAX_BUY_QUANTITY = 100

export type BuyPlan =
  | { kind: 'broke'; unit_price_sui: number } // wallet can't cover one unit + the gas reserve
  | { kind: 'amount'; max_qty: number } // the quantity modal — the ONLY door to the buy PTB

/**
 * Decide the ACQUIRE action for a catalog row against the wallet balance. All money math is BigInt (MIST); the
 * only Number() casts are the final display SUI figure and the integer quantities (safe: bounded by
 * MAX_BUY_QUANTITY). `stock` is the remaining supply, or -1 for an infinite sale. `balance_mist` null (balance not
 * yet read) defers to the on-chain cap and lets the tx layer surface any shortfall — never a false broke card.
 */
export function plan_purchase({
  price_mist,
  category: _category, // kept in the signature: the plan is per-row and callers pass the full row shape
  stock,
  balance_mist,
}: {
  price_mist: bigint
  category: string
  stock: number
  balance_mist: bigint | null
}): BuyPlan {
  // Can't cover a single unit + the house 0.2 SUI gas reserve → the "you're broke" card, never a doomed tx (the
  // same D50 pre-flight idiom the paid character-create gate uses).
  if (balance_mist != null && balance_mist < price_mist + GAS_RESERVE_MIST)
    return { kind: 'broke', unit_price_sui: Number(price_mist) / 1e9 }

  // Units the wallet can fund (each reserves `price`; keep the gas reserve back). Unknown balance / free item →
  // defer to the on-chain cap.
  const affordable =
    balance_mist == null || price_mist <= 0n ? MAX_BUY_QUANTITY : Number((balance_mist - GAS_RESERVE_MIST) / price_mist)
  const supply_remaining = stock === -1 ? MAX_BUY_QUANTITY : stock
  const max_qty = Math.max(1, Math.min(MAX_BUY_QUANTITY, supply_remaining, affordable))

  // The ask is universal — every category, even at max_qty 1 (the modal then confirms with the qty locked).
  return { kind: 'amount', max_qty }
}
