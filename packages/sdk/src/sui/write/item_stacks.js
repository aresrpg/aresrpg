// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { is_stackable_category } from '../../items.js'
import { as_object_arg } from '../object_arg.js'

/**
 * @typedef {Object} SplitStackArgs
 * @property {string} kiosk_id
 * @property {string} personal_kiosk_cap_id
 * @property {string} item_id
 * @property {bigint | number | string} amount
 * @property {Transaction} [tx]
 *
 * @typedef {Omit<SplitStackArgs, 'tx'> & {tx: Transaction}} SplitStackCommandArgs
 *
 * @typedef {Object} MergeStackArgs
 * @property {string} kiosk_id
 * @property {string} personal_kiosk_cap_id
 * @property {string} target_item_id
 * @property {string} source_item_id
 * @property {Transaction} [tx]
 */

/** @param {bigint | number | string} amount */
function positive_amount(amount) {
  const value = BigInt(amount)
  if (value < 1n)
    throw new Error(`[item_stacks] amount must be >= 1; got ${String(amount)}`)
  return value
}

/**
 * Compose the canonical locked-stack split and return its new stack ID so another command can consume it in the
 * same PTB. Keeping this command here prevents callers such as gift send from duplicating the Move target or its
 * policy/version arguments.
 * @param {import("../../../types.js").Context} context
 * @returns {(args: SplitStackCommandArgs) => import('@mysten/sui/transactions').TransactionResult}
 */
export function split_locked_stack_id(context) {
  const { network } = context
  return ({ kiosk_id, personal_kiosk_cap_id, item_id, amount, tx }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    return tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::extract::split_locked_stack`,
      arguments: [
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        tx.pure.id(item_id),
        tx.pure.u64(positive_amount(amount)),
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ),
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY),
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION),
      ],
    })
  }
}

/**
 * Split `amount` units from a kiosk-locked stack. The Move door extracts the source, applies the package-private
 * Item arithmetic, and re-locks both survivors into this same personal kiosk before returning the new stack ID.
 * @param {import("../../../types.js").Context} context
 * @returns {(args: SplitStackArgs) => Transaction}
 */
export function split_stack_ptb(context) {
  const split_locked_stack = split_locked_stack_id(context)
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_id,
    amount,
    tx = new Transaction(),
  }) => {
    split_locked_stack({
      kiosk_id,
      personal_kiosk_cap_id,
      item_id,
      amount,
      tx,
    })
    return tx
  }
}

/**
 * Merge two same-template kiosk-locked stacks. The Move door extracts both and re-locks the surviving target into
 * this same personal kiosk; no address-delivery path exists in the composer.
 * @param {import("../../../types.js").Context} context
 * @returns {(args: MergeStackArgs) => Transaction}
 */
export function merge_stack_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    target_item_id,
    source_item_id,
    tx = new Transaction(),
  }) => {
    if (!target_item_id || !source_item_id)
      throw new Error(
        '[item_stacks] target_item_id and source_item_id are required',
      )
    if (target_item_id === source_item_id)
      throw new Error('[item_stacks] cannot merge a stack with itself')

    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::extract::merge_locked_stacks_and_relock`,
      arguments: [
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        tx.pure.id(target_item_id),
        tx.pure.id(source_item_id),
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ),
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY),
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION),
      ],
    })
    return tx
  }
}

/**
 * The BATCH shape of the merge above: fold N (target, source) pairs into ONE transaction. Every stackable
 * acquisition mints a NEW Item of amount 1, so a bag accumulates same-template singletons and the client's
 * sweep (#1495) has N-1 pairs per template to discharge — one transaction, one signature, one gas payment.
 * Each pair carries its own kiosk + cap (a wallet may hold several personal kiosks), and every guard of the
 * singular composer applies unchanged: this is a loop over it, never a second PTB shape.
 * @param {import("../../../types.js").Context} context
 * @returns {(args: { merges: Omit<MergeStackArgs, 'tx'>[], tx?: Transaction }) => Transaction}
 */
export function merge_stacks_ptb(context) {
  const merge_one = merge_stack_ptb(context)
  return ({ merges, tx = new Transaction() }) => {
    for (const merge of merges ?? []) merge_one({ ...merge, tx })
    return tx
  }
}

// ── MERGE-AT-THE-DOOR (#1495) ────────────────────────────────────────────────────────────────────────────
// The sweep above discharges duplicates AFTER the fact; these three fold an ACQUISITION into the stack the
// player already owns, in the acquiring transaction itself — so the duplicate is never created in the first
// place. Only the doors whose arriving item id is KNOWN at composition time can do this (a marketplace buy,
// a gift claim); every mint-class door still needs its Move returning-variant, and until those land the boot
// sweep stays the safety net for what slips through.

/**
 * One acquisition's fold budget. A gift can carry many stacks and each arriving template can meet several
 * siblings, so an UNBOUNDED fold would let a big claim compose an arbitrarily gas-heavy PTB — and a
 * transaction the sponsor's per-tx ceiling refuses is a transaction the player cannot make AT ALL. Bounded,
 * the acquisition always fits and the leftovers are exactly what the boot sweep already exists to discharge
 * (frontend `auto_merge_stacks.js`, whose shipped whole-PTB envelope is 32 merges); half that budget leaves
 * room for the acquisition's own commands (a marketplace buy is ~14 before any fold).
 */
export const MAX_FOLDS_PER_ACQUISITION = 16

/**
 * @typedef {Object} StackFold one template's fold: what is already owned + what is arriving
 * @property {string[]} sibling_item_ids same-template stacks ALREADY locked in the destination kiosk
 * @property {string[]} incoming_item_ids the arriving same-template stack ids (bought, claimed, …)
 */

/**
 * The PURE plan of an acquisition fold: which merges leave exactly ONE stack per template.
 *
 * The survivor is the LOWEST sibling id. Object ids carry no age, so this is a DETERMINISM rule (the same
 * fold always composes the same commands), not an "oldest wins" one; every other sibling and every arriving
 * stack folds into that one target, so N siblings + M incoming compose N-1+M merges.
 *
 * ZERO siblings ⇒ NO merges: a first acquisition IS the only stack and must never pay for a merge it does
 * not need. A caller with a non-stackable template resolves zero siblings (`same_template_stack_ids`), so
 * this stays a no-op there by construction — the chain's `ENotStackable` is never reached.
 * @param {StackFold[]} folds
 * @returns {{ target_item_id: string, source_item_id: string }[]}
 */
export function plan_stack_folds(folds) {
  return (folds ?? []).flatMap(({ sibling_item_ids, incoming_item_ids }) => {
    const siblings = [...new Set(sibling_item_ids ?? [])]
      .filter(Boolean)
      .map(String)
      .sort()
    const incoming = [...new Set(incoming_item_ids ?? [])]
      .filter(Boolean)
      .map(String)
    if (!siblings.length || !incoming.length) return []
    const [target_item_id, ...rest] = siblings
    return [...rest, ...incoming].map(source_item_id => ({
      target_item_id,
      source_item_id,
    }))
  })
}

/**
 * The sibling half of a fold: the destination kiosk's existing stacks of ONE template, derived from the bag
 * rows the client ALREADY reads (`get_owned_items` shape). Pure — rows in, ids out; the SDK never fetches.
 *
 * Four exclusions, each because the Move door would abort otherwise: a non-stackable category
 * (`ENotStackable`), a row in ANOTHER kiosk (one merge extracts and re-locks through ONE kiosk + its cap),
 * a row with no template id (same `item_type` is NOT proof of same template — `ETemplateMismatch`), and a
 * LISTED row (marketplace inventory, which would need a delist first).
 * @param {{ items?: any[], kiosk_id: string, template_id: string, item_category: string,
 *   exclude_item_ids?: string[] }} args
 * @returns {string[]} sibling stack ids, ascending
 */
export function same_template_stack_ids({
  items,
  kiosk_id,
  template_id,
  item_category,
  exclude_item_ids = [],
}) {
  if (!kiosk_id || !template_id || !is_stackable_category(item_category))
    return []
  const excluded = new Set(exclude_item_ids.map(String))
  return (items ?? [])
    .filter(
      row =>
        row?.id &&
        row?.listed !== true &&
        String(row.kiosk_id ?? '') === String(kiosk_id) &&
        String(row.template_id ?? '') === String(template_id) &&
        is_stackable_category(row.item_category) &&
        !excluded.has(String(row.id)),
    )
    .map(row => String(row.id))
    .sort()
}

/**
 * Append an acquisition's folds to a transaction that is ALREADY landing the incoming stacks in
 * `kiosk_id` — the composer the wireable doors (marketplace buy, gift claim) share. Every merge rides the
 * same `merge_stacks_ptb` batch as the boot sweep: one Move door, one set of guards, one home.
 *
 * Ordering is the caller's contract: the folds must be appended AFTER the commands that lock the incoming
 * items into this kiosk AND after any `personal_kiosk::borrow_val` has been returned (the Move door borrows
 * the owner cap out of the PersonalKioskCap itself).
 *
 * BOUNDED: at most `MAX_FOLDS_PER_ACQUISITION` merges ride one acquisition (see the constant). Dropping a
 * fold is always safe — an unmerged stack is the status quo the sweep tidies later, whereas a PTB over the
 * sponsor's per-tx ceiling would refuse the ACQUISITION itself.
 * @param {import("../../../types.js").Context} context
 * @returns {(args: { kiosk_id: string, personal_kiosk_cap_id: string, folds: StackFold[],
 *   tx?: Transaction }) => Transaction}
 */
export function fold_stacks_ptb(context) {
  const merge_all = merge_stacks_ptb(context)
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    folds,
    tx = new Transaction(),
  }) => {
    const merges = plan_stack_folds(folds).slice(0, MAX_FOLDS_PER_ACQUISITION)
    if (!merges.length) return tx
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[item_stacks] folding into existing stacks needs kiosk_id and personal_kiosk_cap_id',
      )
    return merge_all({
      merges: merges.map(merge => ({
        kiosk_id,
        personal_kiosk_cap_id,
        ...merge,
      })),
      tx,
    })
  }
}
