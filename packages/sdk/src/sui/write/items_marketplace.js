// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KioskClient, KioskTransaction } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  character_type,
  item_type,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'
import {
  policy_rule_package,
  resolve_marketplace_rule_targets,
} from '../transfer_policies.js'

import { borrow_personal_kiosk_cap } from './borrow_personal_kiosk_cap.js'
import { fold_stacks_ptb, split_locked_stack_id } from './item_stacks.js'

/**
 * @typedef {Object} MarketplacePolicy
 * @property {string} id
 * @property {string[] | { contents?: ({ name?: string } | string)[] }} rules
 *
 * @typedef {Object} MarketplaceBuyBase
 * @property {string} seller_kiosk_id
 * @property {bigint | string} price_mist seller ask only; the wallet debit before gas is ask + royalty, exposed by
 * `marketplace_purchase_total_mist`
 * @property {string | null} [kiosk_id]
 * @property {string | null} [personal_kiosk_cap_id]
 * @property {MarketplacePolicy} policy
 * @property {Transaction} [tx]
 *
 * @typedef {MarketplaceBuyBase & { item_id: string, existing_stack_ids?: string[] }} MarketplaceItemBuy
 * `existing_stack_ids` — the buyer's already-owned stacks of the bought item's template, in `kiosk_id`
 * (resolve them with `same_template_stack_ids` off the bag rows the client already reads). Supplied, the
 * purchase FOLDS into them in the same PTB, so a bought stack never lands as a duplicate.
 * @typedef {MarketplaceBuyBase & { character_id: string }} MarketplaceCharacterBuy
 *
 * @typedef {Object} MarketplaceStackList
 * @property {string} kiosk_id
 * @property {string} personal_kiosk_cap_id
 * @property {string} item_id the SOURCE stack — the listed object when it already is the lot, else the one split from
 * @property {bigint | number | string} amount the lot being sold (1/10/100/1000)
 * @property {bigint | number | string} [source_amount] units `item_id` holds today; defaults to `amount` (no split)
 * @property {bigint | number | string} price_mist seller ask for the complete lot, excluding royalty
 * @property {MarketplacePolicy} policy
 * @property {Transaction} [tx]
 */

// ITEMS MARKETPLACE PTB BUILDERS — P2P resale of a kiosk-LOCKED item via the Sui kiosk framework (NOT a custom Move
// module). `list`/`delist` are plain `0x2::kiosk` calls on the seller's PERSONAL kiosk (the inner owner cap borrowed
// via the personal-cap dance), so they are pure offline builders. A locked item CAN be listed — that is exactly how a
// kiosk-locked item is offered for sale; the actual transfer happens at purchase, which re-locks it via the policy.
//
// BUY hand-resolves the live TransferPolicy receipts because purchaseAndResolve cannot resolve AresRPG's custom
// rules. Item purchases resolve royalty + listing + lot + kiosk-lock + personal-kiosk; Character purchases keep
// royalty + listing + kiosk-lock + personal-kiosk. The caller supplies the TransferPolicy snapshot fetched during
// pre-flight; its rule TypeNames prove which receipts are required. Move calls target the ceremony-stamped
// linkage/core ids, never TypeName defining ids, environment defaults, or KioskClient.getRulePackageId fallbacks
// (see transfer_policies.js).
//
// FROZEN framework signatures:
//   0x2::kiosk::list<T>(self: &mut Kiosk, cap: &KioskOwnerCap, id: ID, price: u64)
//   0x2::kiosk::delist<T>(self: &mut Kiosk, cap: &KioskOwnerCap, id: ID)

/** Native marketplace lot sizes accepted for stackable Item listings. */
export const LEGAL_LOT_SIZES = Object.freeze([1n, 10n, 100n, 1000n])
/** Universal Item-policy royalty authored by the ceremony (10%). */
export const MARKETPLACE_ROYALTY_BPS = 1000n
const BPS_DENOMINATOR = 10_000n

/** @param {bigint | number | string} amount */
export function is_legal_lot_size(amount) {
  try {
    const value = BigInt(amount)
    return LEGAL_LOT_SIZES.includes(value)
  } catch {
    return false
  }
}

/** @param {bigint | number | string} amount */
function assert_legal_lot_size(amount) {
  if (!is_legal_lot_size(amount))
    throw new Error(
      `[items_marketplace] stack amount must be one of 1, 10, 100, 1000; got ${String(amount)}`,
    )
}

/**
 * `kiosk::list`'s `id: ID` argument accepts either an id KNOWN client-side (a plain string → a pure ID) or one
 * PRODUCED by an earlier command in the same PTB (`extract::split_locked_stack` returns the freshly shaped lot's
 * `ID` — see list_stack_ptb). A result is already an ID value and must be passed through untouched; wrapping it
 * in `tx.pure` would encode the result handle instead of the object it names.
 * @param {Transaction} tx
 * @param {string | import('@mysten/sui/transactions').TransactionArgument} item_id
 */
function id_arg(tx, item_id) {
  return typeof item_id === 'string' ? tx.pure.id(item_id) : item_id
}

/**
 * Exact royalty debit for a kiosk ask: max(floor(ask × 1000 / 10000), the stamped policy floor).
 * @param {bigint | number | string} price_mist seller ask, excluding royalty
 * @param {bigint | number | string} min_amount_mist stamped Item-policy royalty floor
 */
export function marketplace_fee_mist(price_mist, min_amount_mist) {
  const price = BigInt(price_mist)
  const minimum = BigInt(min_amount_mist)
  if (price < 0n) throw new Error('[items_marketplace] price_mist must be >= 0')
  if (minimum < 1n)
    throw new Error(
      '[items_marketplace] royalty min_amount_mist must be stamped and >= 1',
    )
  const proportional = (price * MARKETPLACE_ROYALTY_BPS) / BPS_DENOMINATOR
  return proportional > minimum ? proportional : minimum
}

/**
 * Exact wallet debit before gas for a kiosk purchase: seller ask + universal royalty fee.
 * @param {bigint | number | string} price_mist seller ask, excluding royalty
 * @param {bigint | number | string} min_amount_mist stamped Item-policy royalty floor
 */
export function marketplace_total_mist(price_mist, min_amount_mist) {
  const price = BigInt(price_mist)
  return price + marketplace_fee_mist(price, min_amount_mist)
}

/**
 * Bind the exact purchase-total helper to this network's stamped Item-policy royalty floor.
 * @param {import("../../../types.js").Context} context
 */
export function marketplace_purchase_total_mist(context) {
  const { network } = context
  /** @type {(price_mist: bigint | number | string) => bigint} */
  return price_mist => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    return marketplace_total_mist(price_mist, a.ITEM_ROYALTY_MIN_MIST)
  }
}

/** @param {{ id?: string }} policy @param {string} expected_id */
function assert_policy_id(policy, expected_id) {
  if (!policy?.id || policy.id.toLowerCase() !== expected_id.toLowerCase())
    throw new Error(
      `[items_marketplace] expected TransferPolicy ${expected_id}, got ${policy?.id ?? '<missing>'}`,
    )
}

/**
 * @param {import('../../../types.js').Context} context
 * @param {string} personal_kiosk_package_id
 */
function policy_kiosk_client(context, personal_kiosk_package_id) {
  return new KioskClient({
    client: context.kiosk_client?.client,
    network: context.network,
    packageIds: { personalKioskRulePackageId: personal_kiosk_package_id },
  })
}

/**
 * @param {import('../../../types.js').Context} context
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {string | null | undefined} kiosk_id
 * @param {string | null | undefined} personal_kiosk_cap_id
 * @param {string} personal_kiosk_package_id
 */
function buyer_kiosk(
  context,
  tx,
  kiosk_id,
  personal_kiosk_cap_id,
  personal_kiosk_package_id,
) {
  if (Boolean(kiosk_id) !== Boolean(personal_kiosk_cap_id))
    throw new Error(
      '[items_marketplace] kiosk_id and personal_kiosk_cap_id must be supplied together',
    )

  const kiosk_client = policy_kiosk_client(context, personal_kiosk_package_id)
  if (kiosk_id && personal_kiosk_cap_id) {
    const personal_cap = tx.object(personal_kiosk_cap_id)
    const [owner_cap, promise] = tx.moveCall({
      target: `${personal_kiosk_package_id}::personal_kiosk::borrow_val`,
      arguments: [personal_cap],
    })
    const ktx = new KioskTransaction({
      transaction: tx,
      kioskClient: kiosk_client,
    })
      .setKiosk(tx.object(kiosk_id))
      .setKioskCap(owner_cap)
    return {
      ktx,
      finalize() {
        tx.moveCall({
          target: `${personal_kiosk_package_id}::personal_kiosk::return_val`,
          arguments: [personal_cap, owner_cap, promise],
        })
      },
    }
  }

  const ktx = new KioskTransaction({
    transaction: tx,
    kioskClient: kiosk_client,
  }).createPersonal(true)
  return { ktx, finalize: () => ktx.finalize() }
}

/**
 * LIST the locked item `item_id` for sale at `price_mist` in the seller's personal kiosk (borrow the KioskOwnerCap, list,
 * return the cap). A buyer later purchases + resolves the transfer policy (re-lock + 10% royalty).
 * @param {import("../../../types.js").Context} context
 */
export function list_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_id,
    price_mist,
    policy,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    assert_policy_id(policy, a.ITEM_POLICY)
    const rule_targets = resolve_marketplace_rule_targets({
      policy,
      kiosk_rule_package_id: a.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      listing_rule_module: 'item',
      listing_rule_type: 'ListingRule',
      listing_rule_package_id: a.LATEST_PACKAGE_ID,
    })
    borrow_personal_kiosk_cap(context)({
      personal_kiosk_cap_id,
      personal_kiosk_package_id: rule_targets.personal_kiosk_rule,
      tx,
      handler: owner_cap => {
        tx.moveCall({
          target: '0x2::kiosk::list',
          typeArguments: [item_type(a)],
          arguments: [
            as_object_arg(tx, kiosk_id), // self: &mut Kiosk (ref-or-id seam — a cached ref must be mutable:true)
            owner_cap, // cap: &KioskOwnerCap
            id_arg(tx, item_id), // id: ID (an id string, or an earlier command's ID result — see list_stack_ptb)
            tx.pure.u64(BigInt(price_mist)), // price: u64
          ],
        })
      },
    })
    return tx
  }
}

/**
 * LIST a stackable lot. `amount` is the lot the seller is SELLING (a legal lot size — the universal `lot_rule`
 * repeats the check against the purchased Item at policy resolution, so a stale or hostile client cannot bypass
 * it); `source_amount` is the units `item_id` currently holds.
 *
 * A gathered stack is an ARBITRARY size (2, 3, 47 units — a bag accumulates whatever the world dropped), while a
 * kiosk lot may only be 1/10/100/1000. Requiring the seller to already own a stack of exactly the lot size made
 * every other stack unlistable (#492: the sell flow simply could not complete). So the general case owns both:
 * when the source IS exactly the lot, list it as-is; when it holds MORE, `extract::split_locked_stack` shapes the
 * lot off IN THE SAME PTB and the CHILD is what gets listed — the remainder stays kiosk-locked with the seller,
 * one signature, no orphan. Splitting is impossible at equality by construction (`item::split` asserts the source
 * keeps >= 1 unit), which is exactly the branch that needs no split.
 * @param {import("../../../types.js").Context} context
 * @returns {(args: MarketplaceStackList) => Transaction}
 */
export function list_stack_ptb(context) {
  const list_item = list_ptb(context)
  const split_locked_stack = split_locked_stack_id(context)
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_id,
    amount,
    source_amount = amount,
    price_mist,
    policy,
    tx = new Transaction(),
  }) => {
    assert_legal_lot_size(amount)
    const lot = BigInt(amount)
    const held = BigInt(source_amount)
    if (held < lot)
      throw new Error(
        `[items_marketplace] stack ${item_id} holds ${String(held)} units — cannot list a lot of ${String(lot)}`,
      )

    // The split MUST be composed before `list_item` opens the personal-cap borrow: it takes the cap by immutable
    // reference, and the borrow_val/return_val dance between them would leave no cap to read.
    const [child_id] =
      held === lot
        ? [item_id]
        : split_locked_stack({
            kiosk_id,
            personal_kiosk_cap_id,
            item_id,
            amount: lot,
            tx,
          })

    return list_item({
      kiosk_id,
      personal_kiosk_cap_id,
      item_id: child_id,
      price_mist,
      policy,
      tx,
    })
  }
}

/**
 * DELIST the item `item_id` (pull a live listing) from the seller's personal kiosk.
 * @param {import("../../../types.js").Context} context
 */
export function delist_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_id,
    policy,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    assert_policy_id(policy, a.ITEM_POLICY)
    const rule_targets = resolve_marketplace_rule_targets({
      policy,
      kiosk_rule_package_id: a.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      listing_rule_module: 'item',
      listing_rule_type: 'ListingRule',
      listing_rule_package_id: a.LATEST_PACKAGE_ID,
    })
    borrow_personal_kiosk_cap(context)({
      personal_kiosk_cap_id,
      personal_kiosk_package_id: rule_targets.personal_kiosk_rule,
      tx,
      handler: owner_cap => {
        tx.moveCall({
          target: '0x2::kiosk::delist',
          typeArguments: [item_type(a)],
          arguments: [
            as_object_arg(tx, kiosk_id), // self: &mut Kiosk (ref-or-id seam — a cached ref must be mutable:true)
            owner_cap, // cap: &KioskOwnerCap
            tx.pure.id(item_id), // id: ID
          ],
        })
      },
    })
    return tx
  }
}

/**
 * @param {import('../../../types.js').Context} context
 * @param {'item' | 'character'} kind
 */
function marketplace_buy_ptb(context, kind) {
  const { network } = context
  const fold_stacks = fold_stacks_ptb(context)
  return ({
    item_id,
    character_id,
    seller_kiosk_id,
    price_mist,
    kiosk_id = null,
    personal_kiosk_cap_id = null,
    existing_stack_ids = [],
    policy,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const is_item = kind === 'item'
    const policy_id = is_item ? a.ITEM_POLICY : a.CHARACTER_POLICY
    const listing_rule_module = is_item ? 'item' : 'character_listing_rule'
    // the item listing rule moved into `item` at the republish restructure; the character one still has its module
    const listing_rule_type = is_item ? 'ListingRule' : 'Rule'
    const asset_type = is_item ? item_type(a) : character_type(a)
    const asset_id = is_item ? item_id : character_id
    if (!asset_id || !seller_kiosk_id)
      throw new Error(
        `[items_marketplace] ${is_item ? 'item_id' : 'character_id'} and seller_kiosk_id are required`,
      )
    if (!is_item && existing_stack_ids?.length)
      throw new Error(
        '[items_marketplace] existing_stack_ids is item-only — characters never stack',
      )
    assert_policy_id(policy, policy_id)

    const rule_targets = resolve_marketplace_rule_targets({
      policy,
      kiosk_rule_package_id: a.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      listing_rule_module,
      listing_rule_type,
      listing_rule_package_id: a.LATEST_PACKAGE_ID,
    })
    let lot_rule_target = null
    if (is_item) {
      policy_rule_package(policy, 'item', 'LotRule')
      lot_rule_target = a.LATEST_PACKAGE_ID
    }

    // Preserve the live marketplace command shape: branded header, personal-cap borrow/create, purchase, policy
    // receipts, confirm, then return/share the personal cap.
    tx.moveCall({ target: `${a.LATEST_PACKAGE_ID}::header::aresrpg` })
    const binding = buyer_kiosk(
      context,
      tx,
      kiosk_id,
      personal_kiosk_cap_id,
      rule_targets.personal_kiosk_rule,
    )
    const { ktx } = binding
    const [asset, request] = ktx.purchase({
      itemType: asset_type,
      itemId: asset_id,
      price: BigInt(price_mist),
      sellerKiosk: seller_kiosk_id,
    })
    const policy_arg = tx.object(policy.id)
    const fee = tx.moveCall({
      target: `${rule_targets.royalty_rule}::royalty_rule::fee_amount`,
      typeArguments: [asset_type],
      arguments: [policy_arg, tx.pure.u64(BigInt(price_mist))],
    })
    const [fee_coin] = tx.splitCoins(tx.gas, [fee])
    tx.moveCall({
      target: `${rule_targets.royalty_rule}::royalty_rule::pay`,
      typeArguments: [asset_type],
      arguments: [policy_arg, request, fee_coin],
    })

    tx.moveCall({
      target: `${rule_targets.listing_rule}::${listing_rule_module}::${is_item ? 'prove_listing_amount' : 'prove_level'}`,
      arguments: is_item
        ? [asset, request]
        : [asset, tx.object(a.GAME_CONFIG), request],
    })
    if (lot_rule_target)
      tx.moveCall({
        target: `${lot_rule_target}::item::prove_lot`,
        arguments: [asset, request],
      })
    ktx.lock({ itemType: asset_type, item: asset, policy: policy_arg })
    const kiosk = ktx.getKiosk()
    tx.moveCall({
      target: `${rule_targets.kiosk_lock_rule}::kiosk_lock_rule::prove`,
      typeArguments: [asset_type],
      arguments: [request, kiosk],
    })
    tx.moveCall({
      target: `${rule_targets.personal_kiosk_rule}::personal_kiosk_rule::prove`,
      typeArguments: [asset_type],
      arguments: [kiosk, request],
    })
    tx.moveCall({
      target: '0x2::transfer_policy::confirm_request',
      typeArguments: [asset_type],
      arguments: [policy_arg, request],
    })
    binding.finalize()
    // AFTER finalize, never before: the fold's Move door borrows the owner cap out of the PersonalKioskCap
    // itself, which the purchase held borrowed until here. The bought stack is locked in the buyer's kiosk by
    // this point, so it folds into the stacks they already owned (#1495 — no duplicate is ever created). A
    // first-time buyer (no cap ⇒ a kiosk created in this very PTB) owns nothing to fold into.
    fold_stacks({
      kiosk_id,
      personal_kiosk_cap_id,
      folds: [
        { sibling_item_ids: existing_stack_ids, incoming_item_ids: [asset_id] },
      ],
      tx,
    })
    return tx
  }
}

/**
 * Build a secondary-market Item purchase from an already-fetched TransferPolicy snapshot.
 * @param {import('../../../types.js').Context} context
 * @returns {(args: MarketplaceItemBuy) => Transaction}
 */
export function marketplace_buy_item_ptb(context) {
  return marketplace_buy_ptb(context, 'item')
}

/**
 * Build a secondary-market Character purchase from an already-fetched TransferPolicy snapshot.
 * @param {import('../../../types.js').Context} context
 * @returns {(args: MarketplaceCharacterBuy) => Transaction}
 */
export function marketplace_buy_character_ptb(context) {
  return marketplace_buy_ptb(context, 'character')
}
