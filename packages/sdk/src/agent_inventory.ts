// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import { read_item_snapshot } from './item_snapshot.ts'
import { kares_coin_type, rewards_shared_pin } from './kares_ptb.ts'
import { STAKE_POSITION_BCS, REWARD_SCALE } from './kares_decode.ts'

export type AgentKioskAsset = Readonly<{
  kind: 'item' | 'character'
  id: string
  kiosk: string
  listed: boolean
  exclusive: boolean
}>

export type AgentInventoryItem = Readonly<{
  item: ItemRow
  status: 'available' | 'listed' | 'equipped'
  character_id?: string
  slot?: string
  exclusive?: boolean
  direct?: boolean
}>

/** Explicit recovery audit for direct objects, staking and proceeds. Game inventory uses indexed subscriptions. */
export const read_agent_recovery_assets = async (client: SuiGrpcClient, sdk: Sdk, address: string) => {
  const caps = await read_personal_kiosks(sdk, address)
  const kiosks = await Promise.all(caps.map((cap) => sdk.get_kiosk(cap.kioskId, { withKioskFields: true })))
  if (kiosks.some((kiosk) => !kiosk.kiosk)) throw new Error('Kiosk proceeds could not be read.')
  const coin_type = typeof sdk.pins.kares_coin_type === 'string' ? kares_coin_type(sdk.pins.kares_coin_type) : null
  const owned = await read_owned_inventory(client, address)
  const items: AgentInventoryItem[] = []
  const direct = owned.filter(
    (row) => normalizeStructTag(row.type) === normalizeStructTag(`${sdk.game_type_package}::item::Item`)
  )
  for (const row of direct)
    items.push({
      item: { ...(await inventory_item(client, sdk, row.objectId)), kiosk: '' },
      status: 'available',
      direct: true,
    })
  if (new Set(items.map((row) => row.item.id)).size !== items.length)
    throw new Error('Inventory custody changed. Refresh before selecting.')
  const type = normalizeStructTag(`${sdk.game_type_package}::item::Item`)
  const character_type = normalizeStructTag(`${sdk.game_type_package}::character::Character`)
  const position_type =
    coin_type && typeof sdk.pins.kares_rewards_package_original === 'string'
      ? normalizeStructTag(`${sdk.pins.kares_rewards_package_original}::staking::StakePosition<${coin_type}>`)
      : null
  const positions = owned
    .filter((row) => normalizeStructTag(row.type) === position_type)
    .map((row) => {
      const position = STAKE_POSITION_BCS.parse(row.content)
      const pool = rewards_shared_pin(sdk.pins.kares_staking_pool, 'staking pool')
      if (position.id !== row.objectId || position.pool !== pool.id)
        throw new Error('Staking position identity changed.')
      return {
        id: row.objectId,
        amount: position.amount.toString(),
        exhausted:
          position.amount === 0n && position.kares_accrued < REWARD_SCALE && position.sui_accrued < REWARD_SCALE,
      }
    })
  return Object.freeze({
    kiosk_caps: Object.freeze(caps.map(({ objectId }) => objectId)),
    kiosk_assets: Object.freeze(
      kiosks.flatMap((kiosk) =>
        kiosk.items.flatMap((row): AgentKioskAsset[] => {
          const kind =
            normalizeStructTag(row.type) === type
              ? 'item'
              : normalizeStructTag(row.type) === character_type
                ? 'character'
                : null
          return kind
            ? [
                {
                  kind,
                  id: row.objectId,
                  kiosk: row.kioskId,
                  listed: !!row.listing,
                  exclusive: !!row.listing?.isExclusive,
                },
              ]
            : []
        })
      )
    ),
    items: Object.freeze(items),
    positions: Object.freeze(positions.filter(({ exhausted }) => !exhausted).map(({ id, amount }) => ({ id, amount }))),
    exhausted_positions: Object.freeze(positions.filter(({ exhausted }) => exhausted).map(({ id }) => id)),
    proceeds: Object.freeze(
      kiosks
        .map((kiosk, index) => ({ kiosk: caps[index]!.kioskId, sui_mist: kiosk.kiosk!.profits }))
        .filter((row) => BigInt(row.sui_mist) > 0n)
    ),
    owned: Object.freeze(owned.map((row) => Object.freeze({ id: row.objectId, type: row.type }))),
    other_kiosk_objects: Object.freeze(
      kiosks.flatMap((kiosk) =>
        kiosk.items
          .filter((row) => ![type, character_type].includes(normalizeStructTag(row.type)))
          .map((row) => Object.freeze({ id: row.objectId, type: row.type, kiosk: row.kioskId }))
      )
    ),
  })
}

const read_owned_inventory = async (client: SuiGrpcClient, owner: string) => {
  const objects = []
  const seen = new Set<string>()
  let cursor: string | null | undefined
  do {
    const page = await client.core.listOwnedObjects({ owner, cursor, include: { content: true } })
    objects.push(...page.objects)
    cursor = page.hasNextPage ? page.cursor : null
    if (page.hasNextPage && (!cursor || seen.has(cursor))) throw new Error('Inventory pagination changed.')
    if (cursor) seen.add(cursor)
  } while (cursor)
  if (new Set(objects.map((row) => row.objectId)).size !== objects.length)
    throw new Error('Inventory ownership changed.')
  return objects
}
export type AgentRecoveryAssets = Awaited<ReturnType<typeof read_agent_recovery_assets>>

const inventory_item = async (client: SuiGrpcClient, sdk: Sdk, id: string) => {
  const item = await read_item_snapshot(client, sdk.game_type_package, id, true)
  if (item.amount === undefined || !Number.isFinite(item.amount) || !item.version)
    throw new Error('Inventory amount is unavailable.')
  return { ...item, amount: item.amount, version: item.version }
}
