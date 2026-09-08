// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Marketplace revenue admin: official kiosk policy reads + one wallet-signed withdrawal PTB.

import type { TransferPolicyCap } from '@mysten/kiosk'

import { receipt_digest, receipt_events } from './cache.ts'
import type { Sdk } from './client.ts'
import { kares_clock, kares_pins, kares_shared } from './kares.ts'
import { event_u64 } from './receipt_decode.ts'

export type MarketplaceRoyalty = Readonly<{
  kind: 'item' | 'character'
  type: string
  policy_id: string
  cap: TransferPolicyCap | null
  balance_mist: bigint
}>

type MarketplaceAdminSdk = Pick<
  Sdk,
  | 'pins'
  | 'game_type_package'
  | 'get_owned_transfer_policies'
  | 'get_transfer_policies'
  | 'tx'
  | 'hydrate_unknown'
  | 'door_context'
  | 'execute'
>

const policy_targets = (sdk: MarketplaceAdminSdk) => {
  // types are named by the first-publish package id; pins.package drifts with every upgrade
  const package_id = sdk.game_type_package
  if (typeof package_id !== 'string' || !package_id)
    throw new Error('Marketplace royalties need a published game package in pins.json')
  return Object.freeze([
    Object.freeze({ kind: 'item' as const, type: `${package_id}::item::Item`, pin: sdk.pins.item_policy }),
    Object.freeze({
      kind: 'character' as const,
      type: `${package_id}::character::Character`,
      pin: sdk.pins.character_policy,
    }),
  ])
}

const policy_id = (pin: unknown, kind: string): string => {
  const id = pin && typeof pin === 'object' ? (pin as Readonly<{ id?: unknown }>).id : null
  if (typeof id !== 'string' || !id) throw new Error(`Marketplace royalties need pins.${kind}_policy`)
  return id
}

export const read_marketplace_royalties = async (
  sdk: MarketplaceAdminSdk,
  address: string
): Promise<readonly MarketplaceRoyalty[]> => {
  const caps = (await sdk.get_owned_transfer_policies(address)) ?? []
  return Promise.all(
    policy_targets(sdk).map(async ({ kind, type, pin }) => {
      const expected_policy = policy_id(pin, kind)
      const cap = caps.find((candidate) => candidate.type === type && candidate.policyId === expected_policy) ?? null
      const policies = await sdk.get_transfer_policies(type)
      const policy = policies.find(({ id }) => id === expected_policy)
      if (!policy) throw new Error(`The published ${kind} TransferPolicy ${expected_policy} is unavailable`)
      return Object.freeze({ kind, type, policy_id: expected_policy, cap, balance_mist: BigInt(policy.balance) })
    })
  )
}

export const claim_marketplace_royalties = async (sdk: MarketplaceAdminSdk, address: string) => {
  const royalties = await read_marketplace_royalties(sdk, address)
  const missing_caps = royalties.filter(({ cap }) => !cap).map(({ kind }) => kind)
  if (missing_caps.length > 0)
    throw new Error(`The connected wallet does not own the ${missing_caps.join(' and ')} TransferPolicyCap`)
  if (royalties.every(({ balance_mist }) => balance_mist === 0n))
    throw new Error('No marketplace royalties are currently collectable')
  const pins = kares_pins(sdk.pins)
  await sdk.hydrate_unknown(royalties.flatMap(({ policy_id, cap }) => (cap ? [policy_id, cap.policyCapId] : [])))
  const transaction = sdk.tx()
  const withdrawn = royalties.flatMap(({ type, policy_id, cap }) =>
    cap
      ? [
          transaction.moveCall({
            target: '0x2::transfer_policy::withdraw',
            typeArguments: [type],
            arguments: [
              sdk.door_context.obj(transaction, policy_id, true),
              sdk.door_context.obj(transaction, cap.policyCapId, false),
              transaction.pure.option('u64', null),
            ],
          }),
        ]
      : []
  )
  const [proceeds, ...other_proceeds] = withdrawn
  if (!proceeds) throw new Error('No marketplace royalty capability is available')
  if (other_proceeds.length) transaction.mergeCoins(proceeds, other_proceeds)
  const remainder = transaction.moveCall({
    target: `${pins.package}::staking::fund_royalties`,
    arguments: [kares_shared(transaction, pins.pool), proceeds, kares_clock(transaction)],
  })
  transaction.transferObjects([remainder], address)
  const receipt = await sdk.execute(transaction)
  const funded = receipt_events(receipt, `${pins.original}::staking::RoyaltyFunded`)
  if (funded.length !== 1) throw new Error('The royalty receipt did not certify its staking allocation')
  const amount_mist = BigInt(event_u64(funded[0]!, 'amount'))
  const staking_mist = BigInt(event_u64(funded[0]!, 'staking'))
  return Object.freeze({
    digest: receipt_digest(receipt),
    amount_mist,
    staking_mist,
    treasury_mist: amount_mist - staking_mist,
    policies: Object.freeze(royalties.map(({ kind }) => kind)),
  })
}
