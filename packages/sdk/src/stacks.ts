// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Generic stack reshaping. Move mutates amounts; every resulting Item remains kiosk-locked.

import type { KioskOwnerCap } from '@mysten/kiosk'
import type { Transaction, TransactionArgument, TransactionObjectArgument } from '@mysten/sui/transactions'

import { created_object_id, receipt_digest } from './cache.ts'
import type { Sdk } from './client.ts'

type StackContext = Readonly<{ kiosk_cap: (kiosk_id?: string) => Promise<KioskOwnerCap | null> }>
type KioskArguments = Readonly<{ kiosk: TransactionObjectArgument; cap: TransactionObjectArgument }>
export type StackMergeGroup = Readonly<{ kiosk: string; target_id: string; source_ids: readonly string[] }>

const merge_plan = (
  groups: readonly StackMergeGroup[]
): Readonly<{ actionable: readonly StackMergeGroup[]; kiosk: string | null }> => {
  const actionable = groups.filter(({ source_ids }) => source_ids.length > 0)
  const kiosk = actionable[0]?.kiosk ?? null
  if (kiosk !== null && actionable.some((group) => group.kiosk !== kiosk))
    throw new Error('One stack merge transaction cannot span kiosks.')
  const objects = actionable.flatMap(({ target_id, source_ids }) => [target_id, ...source_ids])
  if (new Set(objects).size !== objects.length) throw new Error('The stack merge plan reuses an object.')
  if (objects.length - actionable.length > 1_000)
    throw new Error('One stack normalization transaction cannot exceed 1000 merges.')
  return Object.freeze({ actionable, kiosk })
}

const package_id = (sdk: Sdk): string => {
  const value = sdk.pins.package
  if (typeof value !== 'string' || !value) throw new Error('Stack actions need a published game package.')
  return value
}

export const split_stack_ptb = (
  sdk: Sdk,
  tx: Transaction,
  custody: KioskArguments,
  { item_id, amount }: Readonly<{ item_id: string; amount: number }>
): TransactionArgument =>
  tx.moveCall({
    target: `${package_id(sdk)}::api::split_stack`,
    arguments: [
      custody.kiosk,
      custody.cap,
      sdk.door_context.pin(tx, 'item_policy', false),
      tx.pure.id(item_id),
      tx.pure.u32(amount),
      sdk.door_context.pin(tx, 'version', false),
    ],
  })

export const merge_stacks_ptb = (
  sdk: Sdk,
  tx: Transaction,
  custody: KioskArguments,
  { target_id, source_id }: Readonly<{ target_id: string; source_id: string }>
): TransactionArgument =>
  tx.moveCall({
    target: `${package_id(sdk)}::api::merge_stacks`,
    arguments: [
      custody.kiosk,
      custody.cap,
      sdk.door_context.pin(tx, 'item_protected_policy', false),
      tx.pure.id(target_id),
      tx.pure.id(source_id),
      sdk.door_context.pin(tx, 'version', false),
    ],
  })

export type StackActions = Readonly<{
  split: (
    input: Readonly<{ kiosk: string; item_id: string; amount: number }>
  ) => Promise<Readonly<{ digest: string; item_id: string }>>
  merge: (
    input: Readonly<{ kiosk: string; target_id: string; source_id: string }>
  ) => Promise<Readonly<{ digest: string }>>
  merge_many: (groups: readonly StackMergeGroup[]) => Promise<Readonly<{ digest: string | null }>>
}>

export const stack_actions = (sdk: Sdk, { kiosk_cap }: StackContext): StackActions => {
  const cap = async (kiosk: string): Promise<KioskOwnerCap> => {
    const found = await kiosk_cap(kiosk)
    if (!found) throw new Error('No personal kiosk holds this stack.')
    return found
  }
  return Object.freeze({
    split: async ({ kiosk, item_id, amount }) => {
      if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('A split amount must be a positive integer.')
      const tx = sdk.tx()
      sdk.with_owner_kiosk(tx, await cap(kiosk), (kiosk_arg, cap_arg) => {
        split_stack_ptb(sdk, tx, { kiosk: kiosk_arg, cap: cap_arg }, { item_id, amount })
      })
      const receipt = await sdk.execute(tx, { include: { objectTypes: true } })
      const created = created_object_id(receipt, '::item::Item')
      if (!created) throw new Error('The split receipt carried no new Item.')
      return Object.freeze({ digest: receipt_digest(receipt), item_id: created })
    },
    merge: async ({ kiosk, target_id, source_id }) => {
      if (target_id === source_id) throw new Error('A stack cannot merge into itself.')
      const tx = sdk.tx()
      sdk.with_owner_kiosk(tx, await cap(kiosk), (kiosk_arg, cap_arg) => {
        merge_stacks_ptb(sdk, tx, { kiosk: kiosk_arg, cap: cap_arg }, { target_id, source_id })
      })
      return Object.freeze({ digest: receipt_digest(await sdk.execute(tx)) })
    },
    merge_many: async (groups) => {
      const { actionable, kiosk } = merge_plan(groups)
      if (kiosk === null) return Object.freeze({ digest: null })
      const tx = sdk.tx()
      sdk.with_owner_kiosk(tx, await cap(kiosk), (kiosk_arg, cap_arg) => {
        for (const { target_id, source_ids } of actionable)
          for (const source_id of source_ids)
            merge_stacks_ptb(sdk, tx, { kiosk: kiosk_arg, cap: cap_arg }, { target_id, source_id })
      })
      return Object.freeze({ digest: receipt_digest(await sdk.execute(tx)) })
    },
  })
}
