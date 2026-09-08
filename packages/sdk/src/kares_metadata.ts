// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'

import { KARES_CURRENCY_BCS } from './kares_decode.ts'
import { kares_coin_type, kares_shared, type KaresPins } from './kares_ptb.ts'
import type { Sdk } from './client.ts'

export type KaresMetadataUpdate = Readonly<{ name: string; description: string; icon_url: string }>
export type KaresMetadata = KaresMetadataUpdate &
  Readonly<{
    symbol: string
    decimals: number
    total_supply: bigint
    metadata_cap: string | null
    owner: string | null
  }>

export const read_kares_metadata = async (
  client: SuiGrpcClient,
  currency_pin: KaresPins['currency'],
  original: string
): Promise<KaresMetadata> => {
  const coin_type = `${normalizeSuiObjectId(original)}::kares::KARES`
  const { object } = await client.core.getObject({ objectId: currency_pin.id, include: { content: true } })
  if (normalizeStructTag(object.type) !== normalizeStructTag(`0x2::coin_registry::Currency<${coin_type}>`))
    throw new Error('The metadata object is not the canonical KARES Currency')
  if (object.owner.$kind !== 'Shared' || object.owner.Shared.initialSharedVersion !== currency_pin.shared_version)
    throw new Error('KARES Currency does not match its shared deployment pin')
  const currency = KARES_CURRENCY_BCS.parse(object.content)
  if (currency.id !== normalizeSuiObjectId(currency_pin.id) || currency.supply?.$kind !== 'BurnOnly')
    throw new Error('KARES metadata does not belong to the burn-only Currency')
  const metadata_cap = currency.metadata_cap_id.$kind === 'Claimed' ? currency.metadata_cap_id.Claimed : null
  const owner = await metadata_cap_owner(client, metadata_cap, coin_type)
  return Object.freeze({
    name: currency.name,
    description: currency.description,
    icon_url: currency.icon_url,
    symbol: currency.symbol,
    decimals: currency.decimals,
    total_supply: currency.supply.BurnOnly,
    metadata_cap,
    owner,
  })
}

const metadata_cap_owner = async (
  client: SuiGrpcClient,
  metadata_cap: string | null,
  coin_type: string
): Promise<string | null> => {
  if (!metadata_cap) return null
  const { object } = await client.core.getObject({ objectId: metadata_cap, include: { content: true } })
  if (normalizeStructTag(object.type) !== normalizeStructTag(`0x2::coin_registry::MetadataCap<${coin_type}>`))
    throw new Error('Unexpected KARES metadata capability type')
  if (bcs.Address.parse(object.content) !== metadata_cap || object.owner.$kind !== 'AddressOwner')
    throw new Error('KARES metadata capability is not held by an address')
  return normalizeSuiObjectId(object.owner.AddressOwner)
}

/** Presentation fields only. The native supply, symbol, and decimal rules have no update door here. */
export const update_kares_metadata_into = (
  tx: Transaction,
  sdk: Sdk,
  pins: KaresPins,
  metadata_cap: string,
  update: KaresMetadataUpdate
): void => {
  if (!update.name.trim() || update.name.length > 128 || update.description.length > 2_000)
    throw new Error('KARES metadata name or description has an invalid length')
  if (new URL(update.icon_url).protocol !== 'https:') throw new Error('KARES icon must use HTTPS')
  const fields = { name: update.name, description: update.description, icon_url: update.icon_url }
  for (const [field, value] of Object.entries(fields)) {
    tx.moveCall({
      target: `0x2::coin_registry::set_${field}`,
      typeArguments: [kares_coin_type(pins.original)],
      arguments: [
        kares_shared(tx, pins.currency),
        sdk.door_context.obj(tx, metadata_cap, false),
        tx.pure.string(value),
      ],
    })
  }
}
