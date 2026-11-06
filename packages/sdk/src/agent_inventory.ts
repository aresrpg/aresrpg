// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'

import type { Sdk } from './client.ts'
import { read_personal_kiosks } from './kiosk_discovery.ts'
import { read_agent_equipment } from './agent_equipment.ts'
import { read_item_snapshot } from './item_snapshot.ts'
import { kares_coin_type } from './kares_ptb.ts'
import { STAKE_POSITION_BCS } from './kares_decode.ts'

export type AgentInventoryItem = Readonly<{
  item: ItemRow
  status: 'available' | 'listed' | 'equipped'
  character_id?: string
  slot?: string
  exclusive?: boolean
  direct?: boolean
}>

/** Read only: every owned-object and kiosk page is required, never an incomplete inventory. */
export const read_agent_inventory = async (client: SuiGrpcClient, sdk: Sdk, address: string) => {
  const caps = await read_personal_kiosks(sdk, address)
  const kiosks = await Promise.all(caps.map((cap) => sdk.get_kiosk(cap.kioskId, { withKioskFields: true })))
  if (kiosks.some((kiosk) => !kiosk.kiosk)) throw new Error('Kiosk proceeds could not be read.')
  const coin_type = typeof sdk.pins.kares_coin_type === 'string' ? kares_coin_type(sdk.pins.kares_coin_type) : null
  const owned = await read_owned_inventory(client, address)
  const [sui, kares] = await Promise.all([client.core.getBalance({ owner: address }), sdk.read_kares_balance()])
  const items = (await Promise.all(kiosks.map((kiosk) => read_kiosk_inventory(client, sdk, kiosk)))).flat()
  const direct = owned.filter((row) => row.type === `${sdk.game_type_package}::item::Item`)
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
    .map((row) => Object.freeze({ id: row.objectId, amount: STAKE_POSITION_BCS.parse(row.content).amount.toString() }))
  return Object.freeze({
    items: Object.freeze(items),
    positions: Object.freeze(positions),
    sui_mist: String(sui.balance.balance),
    kares_mist: kares === null ? null : String(kares),
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
export type AgentInventory = Awaited<ReturnType<typeof read_agent_inventory>>

const inventory_item = async (client: SuiGrpcClient, sdk: Sdk, id: string) => {
  const item = await read_item_snapshot(client, sdk.game_type_package, id, true)
  if (item.amount === undefined || !Number.isFinite(item.amount) || !item.version)
    throw new Error('Inventory amount is unavailable.')
  return { ...item, amount: item.amount, version: item.version }
}

const read_kiosk_inventory = async (client: SuiGrpcClient, sdk: Sdk, kiosk: Awaited<ReturnType<Sdk['get_kiosk']>>) => {
  const type = normalizeStructTag(`${sdk.game_type_package}::item::Item`)
  const character_type = normalizeStructTag(`${sdk.game_type_package}::character::Character`)
  const items: AgentInventoryItem[] = []
  for (const row of kiosk.items.filter((item) => normalizeStructTag(item.type) === type))
    items.push({
      item: { ...(await inventory_item(client, sdk, row.objectId)), kiosk: row.kioskId },
      status: row.listing ? 'listed' : 'available',
      exclusive: row.listing?.isExclusive,
    })
  for (const row of kiosk.items.filter((item) => normalizeStructTag(item.type) === character_type)) {
    const equipped = await read_agent_equipment(client, sdk.game_type_package!, row.objectId)
    for (const gear of equipped)
      items.push({
        item: { ...(await inventory_item(client, sdk, gear.item_id)), kiosk: row.kioskId },
        status: 'equipped',
        character_id: row.objectId,
        slot: gear.slot,
      })
  }
  return items
}
