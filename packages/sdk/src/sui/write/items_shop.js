// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { new_ptb } from './header.js'

// &Random (0x8) PIN — mirrors fight.js's `random_arg` (see there for the full latency rationale). Pins the
// system object via `random_shared_ref` when the network's genesis version is stamped; falls back to the
// unresolved `tx.object.random()` otherwise. Byte-identical either way (mutable:false, same 0x8) — execution
// and Random-PTB terminality are unchanged; only the build-time resolve round-trip is saved.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

// ITEM SHOP PTB BUILDERS for the merged `aresrpg` package's `shop` — the pure transaction composers for the item
// sale gate. Arities SURVIVED the S-46 merge unchanged; only the id resolution collapsed to the one deployment home.
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/shop.move AND verified against the
// DEPLOYED lineage-3 package via sui_getNormalizedMoveFunction — S-19a):
//   entry fun buy(sale: &mut Sale, template: &ItemTemplate, payment: Coin<SUI>, kiosk: &mut Kiosk,
//     pkcap: &PersonalKioskCap, policy: &TransferPolicy<Item>, clock: &Clock, r: &Random, config: &GameConfig,
//     version: &Version, ctx)
//   entry fun buy_many(sale, template, quantity: u64, payment, kiosk, pkcap, policy, clock, r, config: &GameConfig,
//     version: &Version, ctx)
// `config: &GameConfig` is the S-46 market kill-switch (`config.assert_domain(domain_market())`), added when the
// per-package lineages merged; it sits between `r` and `version` in BOTH entries.
//
// TERMINAL `&Random` LAW: both consume `&Random` (the stat roll), so the buy MoveCall is the LAST PTB command —
// only coin prep (SplitCoins) may PRECEDE it and NOTHING may follow (Sui rejects any command after a Random
// MoveCall except TransferObjects/MergeCoins; in practice: nothing). The item is born fully rolled — no reveal
// step, no test-and-abort door. `buy_many` obeys the multi-buy law on-chain (ONE generator, N draws, N locks in
// one call); the client just picks the quantity and splits `price × quantity`.
//
// PERSONAL KIOSK BY TYPE: `buy` takes `&PersonalKioskCap` directly (it borrows the KioskOwnerCap internally — no
// borrow_val/return_val dance). A kiosk-less buyer runs `onboard_kiosk_ptb` (items_creation.js) ONCE first to
// create + share a personal kiosk, then every buy targets that shared kiosk with the soulbound cap.
//
// UN-SIMULATABLE GAS: a tx consuming `&Random` CANNOT be dry-run, so the budget is DERIVED from a MEASURED
// per-item constant × 1.5 × quantity — never a guessed literal. The constant is an EXPORTED PLACEHOLDER stamped at
// the publish rehearsal; until stamped, budget derivation REFUSES LOUDLY (a low guess fails ON-CHAIN and burns the
// full budget). Callers may override with an explicit `gas_budget_mist`.
//
// TX-RETRY LAW (money safety — binds every caller of these builders): an EXECUTED buy that FAILED (a tx digest
// exists) is NEVER auto-retried — gas is already burned, and a &Random buy that reached execution cannot be
// "undone" (it may even have half-committed). ONLY pre-flight / network / signing errors (no digest) may retry.

/** Gas backstop mirroring shop.move `MAX_BUY_QUANTITY` — one `buy_many` mints at most this many; split larger. */
export const MAX_BUY_QUANTITY = 100

/**
 * TESTNET-MEASURED per-item `shop::buy` gas in MIST — STAMP at the publish rehearsal (measure a real buy, paste
 * the figure). Kept `null` (not a guess) so any budget derivation refuses loudly until it is measured.
 * MEASURED 2026-07-11 (lead, lineage-6 fresh publish core 0xa837cc99…, digest
 * 4VUmsqSfvaFU9oEdP2upYTBAg2gXHjrz1SLyJogijSYx — one real Crypt Key buy): comp 1,580,000 + storage 13,794,000
 * (rebate 6,101,964 lands AFTER; the budget must cover the PRE-rebate peak) ⇒ peak 15,374,000. ×1.5 headroom
 * ≈ 23M/item — well under the 0.1 SUI ceiling. Re-measure on any shop.move or Item-struct size change.
 * @type {number | null}
 */
export const MEASURED_BUY_GAS_MIST = 15_374_000

/**
 * Clamp + validate a buy quantity to `[1, MAX_BUY_QUANTITY]` (integer). Throws otherwise — a larger pack is split
 * across txs client-side (the multi-buy law bounds one call's work).
 * @param {number} quantity
 * @returns {number}
 */
export function clamp_quantity(quantity) {
  const q = Number(quantity)
  if (!Number.isInteger(q) || q < 1 || q > MAX_BUY_QUANTITY)
    throw new Error(
      `[items_shop] quantity must be an integer in [1, ${MAX_BUY_QUANTITY}] (got ${quantity}). Split a larger pack across txs.`,
    )
  return q
}

/**
 * Derive the gas budget (MIST) for a buy of `quantity` items: `ceil(MEASURED_BUY_GAS_MIST × 1.5) × quantity`.
 * REFUSES LOUDLY when the measured constant is unset — a `&Random` buy is un-simulatable, so an unmeasured budget
 * cannot be guessed (a low guess fails on-chain and burns the full budget).
 * @param {{ quantity?: number }} [args]
 * @returns {number}
 */
export function buy_gas_budget_mist({ quantity = 1 } = {}) {
  const q = clamp_quantity(quantity)
  if (MEASURED_BUY_GAS_MIST == null)
    throw new Error(
      '[items_shop] MEASURED_BUY_GAS_MIST is unset — a &Random buy is UN-SIMULATABLE, so its gas budget cannot be ' +
        'derived. Measure a real per-item shop::buy at the publish rehearsal and stamp the constant. Refusing to ' +
        'guess (a low guess fails on-chain and burns the full budget).',
    )
  return Math.ceil(MEASURED_BUY_GAS_MIST * 1.5) * q
}

/**
 * THE single buy — mint ONE rolled item into the buyer's shared PERSONAL kiosk, as the TERMINAL command. Splits
 * EXACTLY `price_mist` off gas (the gate refunds change on-chain). `kiosk_id` = the buyer's shared personal kiosk;
 * `personal_kiosk_cap_id` = their soulbound PersonalKioskCap (both from a prior `onboard_kiosk_ptb`). Sets the
 * un-simulatable gas budget from the measured constant unless `gas_budget_mist` is passed. See the TX-RETRY LAW
 * above: never auto-retry an executed failure.
 * @param {import("../../../types.js").Context} context
 */
export function buy_ptb(context) {
  const { network } = context
  return ({
    sale_id,
    template_id,
    price_mist,
    kiosk_id,
    personal_kiosk_cap_id,
    gas_budget_mist,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.setGasBudget(gas_budget_mist ?? buy_gas_budget_mist({ quantity: 1 }))

    // SplitCoins may precede the terminal &Random buy; the gate refunds any surplus, so split the exact price.
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(price_mist))])

    tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::shop::buy`,
      arguments: [
        as_object_arg(tx, sale_id), // sale: &mut Sale (ref-or-id seam — a cached ref must be mutable:true)
        as_object_arg(tx, template_id), // template: &ItemTemplate
        payment, // payment: Coin<SUI> (exact split; change refunded on-chain)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (the buyer's shared personal kiosk)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (borrowed internally — no dance)
        shared_object_arg(tx, network, 'ITEM_POLICY', false, dep.ITEM_POLICY), // policy: &TransferPolicy<Item> (lock_in_kiosk; S-51b static)
        tx.object.clock(), // clock: &Clock (0x6) — sale-window check
        random_arg(network, tx), // r: &Random (0x8) — the stat roll; TERMINAL, nothing may follow (pinned when stamped → build-offline)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, dep.GAME_CONFIG), // config: &GameConfig — S-46 market kill-switch (assert_domain)
        shared_object_arg(tx, network, 'VERSION', false, dep.VERSION), // version: &Version
      ],
    })
    // TERMINAL: no command may follow a &Random MoveCall.
    return tx
  }
}

/**
 * THE pack buy — mint `quantity` rolled items in ONE terminal `&Random` call. Splits `price_mist × quantity` off
 * gas. Quantity is clamped to `[1, MAX_BUY_QUANTITY]` (throws otherwise). Budget = the measured constant × 1.5 ×
 * quantity unless `gas_budget_mist` is passed. Same TERMINAL + TX-RETRY laws as `buy_ptb`.
 * @param {import("../../../types.js").Context} context
 */
export function buy_many_ptb(context) {
  const { network } = context
  return ({
    sale_id,
    template_id,
    price_mist,
    quantity,
    kiosk_id,
    personal_kiosk_cap_id,
    gas_budget_mist,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    const q = clamp_quantity(quantity)
    tx.setGasBudget(gas_budget_mist ?? buy_gas_budget_mist({ quantity: q }))

    const total = BigInt(price_mist) * BigInt(q)
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(total)])

    tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::shop::buy_many`,
      arguments: [
        as_object_arg(tx, sale_id), // sale: &mut Sale (ref-or-id seam — a cached ref must be mutable:true)
        as_object_arg(tx, template_id), // template: &ItemTemplate
        tx.pure.u64(BigInt(q)), // quantity: u64
        payment, // payment: Coin<SUI> (price × quantity; change refunded on-chain)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        shared_object_arg(tx, network, 'ITEM_POLICY', false, dep.ITEM_POLICY), // policy: &TransferPolicy<Item> (S-51b static)
        tx.object.clock(), // clock: &Clock (0x6)
        random_arg(network, tx), // r: &Random (0x8) — TERMINAL (pinned when stamped → build-offline)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, dep.GAME_CONFIG), // config: &GameConfig — S-46 market kill-switch (assert_domain)
        shared_object_arg(tx, network, 'VERSION', false, dep.VERSION), // version: &Version
      ],
    })
    // TERMINAL: no command may follow a &Random MoveCall.
    return tx
  }
}
