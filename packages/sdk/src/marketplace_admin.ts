// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Marketplace revenue admin: official kiosk policy reads + one wallet-signed withdrawal PTB.

import type { TransferPolicyCap } from '@mysten/kiosk'

import { receipt_digest } from './cache.ts'
import type { Sdk } from './client.ts'

export type MarketplaceRoyalty = Readonly<{
  kind: 'item' | 'character'
  type: string
  policy_id: string
  cap: TransferPolicyCap | null
  balance_mist: bigint
}>

type MarketplaceAdminSdk = Pick<
  Sdk,
  'pins' | 'get_owned_transfer_policies' | 'get_transfer_policies' | 'tx' | 'withdraw_transfer_policy' | 'execute'
>

const policy_targets = (sdk: MarketplaceAdminSdk) => {
  const package_id = sdk.pins.package
  if (typeof package_id !== 'string' || !package_id) throw new Error('Marketplace royalties need pins.package')
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
  const claimable = royalties.filter(({ cap, balance_mist }) => cap && balance_mist > 0n)
  if (claimable.length === 0) throw new Error('No marketplace royalties are currently collectable')
  const transaction = sdk.tx()
  claimable.forEach(({ cap }) => {
    if (cap) sdk.withdraw_transfer_policy(transaction, cap, address)
  })
  const receipt = await sdk.execute(transaction)
  return Object.freeze({
    digest: receipt_digest(receipt),
    amount_mist: claimable.reduce((sum, { balance_mist }) => sum + balance_mist, 0n),
    policies: Object.freeze(claimable.map(({ kind }) => kind)),
  })
}
