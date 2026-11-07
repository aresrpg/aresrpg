// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentInventoryItem } from '@aresrpg/sdk/agent-inventory'
import type { AgentTransferIntent } from '@aresrpg/sdk/agent-transfer-actions'
import type { AgentAssetIntent } from '@aresrpg/sdk/agent-asset-transfer'

import { inventory_groups } from '../inventory_stacks.ts'
import { parse_sui_amount } from '../wallet_amount.ts'

export type TransferDirection = 'deposit' | 'withdraw'
export type TransferToken = 'sui' | 'kares'
export type AssetOffer = Extract<AgentAssetIntent, { kind: 'asset_offer' }>

export const parse_asset_amount = (value: string): bigint | null =>
  /^(?:0(?:\.0{1,9})?)?$/.test(value.trim()) ? 0n : parse_sui_amount(value)

/** Preserve every represented object and amount. A missing selected cell refuses the whole group. */
export const selected_transfer_items = (rows: readonly AgentInventoryItem[], ids: readonly string[]) => {
  const available = rows.filter(agent_item_available)
  const groups = inventory_groups(available.map((row) => row.item))
  const chosen = groups.filter(({ item }) => ids.includes(item.id))
  if (!ids.length || chosen.length !== new Set(ids).size) return null
  const objects = new Set(chosen.flatMap(({ items }) => items.map(({ id }) => id)))
  const selected = available.filter(({ item }) => objects.has(item.id))
  if (selected.some(({ item }) => !item.version)) return null
  return selected.map(({ item, direct, character_id, slot }) =>
    Object.freeze({
      item_id: item.id,
      kiosk: item.kiosk,
      version: item.version!,
      direct,
      character_id,
      slot,
    })
  )
}

export const coin_transfer_intent = ({
  token,
  amount,
  reserve,
  balance,
  recipient,
}: Readonly<{
  token: TransferToken
  amount: string
  reserve: string
  balance: bigint | null
  recipient: string
}>): AssetOffer | null => {
  const value = parse_asset_amount(amount),
    retained = parse_asset_amount(reserve)
  if (value === null || value <= 0n || retained === null || balance === null || value > balance) return null
  return {
    kind: 'asset_offer',
    recipient,
    items: [],
    sui_mist: token === 'sui' ? String(value) : '0',
    kares_mist: token === 'kares' ? String(value) : '0',
    reserve_mist: String(retained),
  }
}

export const is_coin_transfer = (intent: AgentTransferIntent): boolean =>
  intent.kind === 'asset_offer' && intent.items.length === 0

export const agent_item_available = (row: AgentInventoryItem): boolean => row.status !== 'listed' && !row.exclusive

/** Locked fragments keep their own disabled cell; they never inflate a transferable stack. */
export const agent_inventory_groups = (rows: readonly AgentInventoryItem[]) => {
  const by_id = new Map(rows.map((row) => [row.item.id, row]))
  const available = inventory_groups(rows.filter(agent_item_available).map(({ item }) => item))
  return [
    ...available.map((group) => ({ ...group, status: by_id.get(group.item.id)!.status, locked: false })),
    ...rows
      .filter((row) => !agent_item_available(row))
      .map(({ item, status, exclusive }) => ({
        item,
        amount: item.amount,
        items: [item],
        status: exclusive ? ('reserved' as const) : status,
        locked: true,
      })),
  ]
}
