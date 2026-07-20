// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// COMMISSION PTB BUILDERS for the merged `aresrpg` package's `commission` module — the v2 artisan-commission flow
// (supersedes the v1 pay-X escrow): the CUSTOMER brings the RESOURCES + an
// OPTIONAL payment; the ARTISAN brings the KNOWLEDGE. Three signer-split txs + a redemption:
//   ① request(CUSTOMER)  — escrow a payment toward a named artisan for a recipe; the chain FLOORS it at 0.1 SUI
//                          (`EAmountTooLow`, PLATFORM CUTS) — this builder does not
//                          pre-validate that floor, it only composes the PTB. The ingredients STAY kiosk-locked
//                          in the customer's kiosk (never escrowed).
//   ② accept(ARTISAN)    — the named artisan proves their job level ≥ the recipe's required_level and records it.
//   ③ execute(CUSTOMER)  — runs the craft on the customer's OWN kiosk at the artisan's proven level: burns the
//                          locked inputs, rolls the reference-corpus success chance, MINTS-on-success LOCKED into the
//                          customer's kiosk (kiosk-lock constitution — mint-locks INTERNALLY, exactly like `craft`,
//                          so NO marketplace-buy receipt tail); the escrow releases to the artisan regardless of the
//                          roll; the artisan's craft XP rides out as a `CraftXpVoucher`. Terminal `&Random`.
//   cancel(EITHER)       — pre-execute refund of the escrow to the customer.
//   redeem_craft_xp(ARTISAN) — the artisan banks the voucher's craft XP into their OWN character (own cap).
// Mirrors craft.js idioms (as_object_arg / shared_object_arg / random_arg; no header, no receipt tail). Ids resolve
// through the ONE stamp-or-throw deployment home; an unstamped network REFUSES LOUDLY.
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/commission.move):
//   public fun request(artisan: address, recipe_id: ID, payment: Coin<SUI>, config, version, ctx)
//   public fun accept(request: &mut CraftRequest, recipe: &Recipe, artisan_kiosk: &Kiosk,
//     artisan_pkcap: &PersonalKioskCap, character_id: ID, config, version, ctx)
//   entry  fun execute(request: CraftRequest, recipe: &Recipe, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap,
//     input_item_ids: vector<ID>, output_template: &ItemTemplate, xpolicy: &ItemExtractPolicy,
//     policy: &TransferPolicy<Item>, config, version, r: &Random, ctx)
//   public fun cancel(request: CraftRequest, ctx)
//   public fun redeem_craft_xp(voucher: CraftXpVoucher, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, version, ctx)

// &Random (0x8) PIN — mirrors game_world.js / craft.js `random_arg`: pins the system object via `random_shared_ref`
// when the network's genesis version is stamped; else the unresolved `tx.object.random()`. Byte-identical either way.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

/**
 * ① REQUEST a craft commission: escrow `amount_mist` SUI toward `artisan` for `recipe_id`. The CHAIN floors this at
 * 0.1 SUI (`EAmountTooLow`, PLATFORM CUTS) — this BUILDER does not pre-validate the floor
 * (a zero/undersized amount still composes a valid PTB; it aborts on-chain, not here — the client-side guard lives
 * in commission_actions.js `meets_min_payment`). The customer is the tx sender; their ingredients stay kiosk-locked
 * until `execute`. The escrow is split EXACTLY off the gas coin. Value path — the on-chain `request` runs the
 * crafting kill-switch gate. The CraftRequest is SHARED so the artisan can accept and the customer can execute/cancel.
 * @param {import("../../../types.js").Context} context
 */
export function commission_request_ptb(context) {
  const { network } = context
  return ({ artisan, recipe_id, amount_mist = 0, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!artisan || !recipe_id)
      throw new Error(
        '[commission_request_ptb] artisan and recipe_id are required — the named artisan address and the bound Recipe id.',
      )
    // Escrow split exactly off gas, folded into a Balance by `request` — the CLIENT does not enforce the 0.1 SUI
    // floor here (`EAmountTooLow` aborts on-chain below it; commission_actions.js `meets_min_payment` is the guard).
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(amount_mist ?? 0))])
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::commission::request`,
      arguments: [
        tx.pure.address(artisan), // artisan: address
        tx.pure.id(recipe_id), // recipe_id: ID (the bound recipe)
        payment, // payment: Coin<SUI> (the escrow; chain-floored at 0.1 SUI — EAmountTooLow — not by this builder)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (crafting kill-switch)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * ② ACCEPT a commission: the NAMED artisan proves their job level ≥ the recipe's required_level (read through their
 * soulbound personal-kiosk cap) and flips the request to accepted, recording their proven level + character. Reads
 * only otherwise — the craft runs later in the customer's `execute`. `recipe` MUST be the request's bound recipe.
 * @param {import("../../../types.js").Context} context
 */
export function commission_accept_ptb(context) {
  const { network } = context
  return ({
    request_id,
    recipe_id,
    artisan_kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!request_id || !recipe_id || !artisan_kiosk_id || !personal_kiosk_cap_id || !character_id)
      throw new Error(
        '[commission_accept_ptb] request_id, recipe_id, artisan_kiosk_id, personal_kiosk_cap_id and character_id are all required.',
      )
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::commission::accept`,
      arguments: [
        as_object_arg(tx, request_id), // request: &mut CraftRequest (shared)
        as_object_arg(tx, recipe_id), // recipe: &Recipe (must be the bound one)
        as_object_arg(tx, artisan_kiosk_id), // artisan_kiosk: &Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // artisan_pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID (the artisan's char — the roll runs at its job level)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (crafting kill-switch)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * ③ EXECUTE an accepted commission (terminal `&Random`): the CUSTOMER runs the craft on THEIR OWN kiosk — burn the
 * kiosk-locked `input_item_ids`, roll the reference-corpus success chance at the recorded artisan level, MINT-on-success LOCKED
 * into the customer's kiosk (kiosk-lock constitution — internal mint-lock, NO receipt tail; the escrow releases to
 * the artisan regardless of the roll, and the artisan's craft XP rides out as a voucher). Mirrors `craft_ptb`. The
 * request is consumed BY VALUE, so double-execute / execute-after-cancel are impossible.
 * @param {import("../../../types.js").Context} context
 */
export function commission_execute_ptb(context) {
  const { network } = context
  return ({
    request_id,
    recipe_id,
    kiosk_id,
    personal_kiosk_cap_id,
    input_item_ids,
    output_template_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!request_id || !recipe_id || !output_template_id)
      throw new Error(
        '[commission_execute_ptb] request_id, recipe_id and output_template_id are required.',
      )
    if (!Array.isArray(input_item_ids) || input_item_ids.length === 0)
      throw new Error(
        "[commission_execute_ptb] input_item_ids must be a non-empty array of the customer's kiosk-locked ingredient item ids.",
      )
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::commission::execute`,
      arguments: [
        as_object_arg(tx, request_id), // request: CraftRequest (shared, consumed BY VALUE + deleted)
        as_object_arg(tx, recipe_id), // recipe: &Recipe (the bound one)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (the CUSTOMER's)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (the customer's)
        tx.pure.vector('id', input_item_ids), // input_item_ids: vector<ID>
        as_object_arg(tx, output_template_id), // output_template: &ItemTemplate (asserted == recipe's output)
        shared_object_arg(tx, network, 'EXTRACT_POLICY', false, a.EXTRACT_POLICY), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig (crafting kill-switch)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        random_arg(network, tx), // r: &Random (0x8) — TERMINAL command → Random-PTB compliant
      ],
    })
    return tx
  }
}

/**
 * CANCEL a request pre-execute and REFUND the escrow to the customer. Ownership-gated ONLY on-chain (either party may
 * trigger it, but the refund always goes to the customer) — no config/version (a refund of the customer's own money
 * is never kill-switched). `execute` consumes the request by value, so cancel-after-execute is impossible.
 * @param {import("../../../types.js").Context} context
 */
export function commission_cancel_ptb(context) {
  const { network } = context
  return ({ request_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!request_id)
      throw new Error('[commission_cancel_ptb] request_id is required — the shared CraftRequest id.')
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::commission::cancel`,
      arguments: [as_object_arg(tx, request_id)], // request: CraftRequest (shared, consumed by value + deleted)
    })
    return tx
  }
}

/**
 * REDEEM a `CraftXpVoucher`: the artisan banks the owed craft XP into their OWN character's job (borrowed through
 * their own personal-kiosk cap). The fight-reward-claim pattern — the XP was owed atomically at `execute`; this is
 * its redemption in the artisan's own tx.
 * @param {import("../../../types.js").Context} context
 */
export function commission_redeem_xp_ptb(context) {
  const { network } = context
  return ({ voucher_id, kiosk_id, personal_kiosk_cap_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!voucher_id || !kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[commission_redeem_xp_ptb] voucher_id, kiosk_id and personal_kiosk_cap_id are all required.',
      )
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::commission::redeem_craft_xp`,
      arguments: [
        as_object_arg(tx, voucher_id), // voucher: CraftXpVoucher (owned, consumed by value + deleted)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (the artisan's)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (the artisan's)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}
