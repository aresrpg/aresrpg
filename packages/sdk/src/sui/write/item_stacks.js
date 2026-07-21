// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
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
