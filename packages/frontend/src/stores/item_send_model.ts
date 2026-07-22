// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { cosmetic_icon_of } from '../game/cosmetic_icons.js'

const stackable_categories = new Set([ITEM_CATEGORY.CONSUMABLE, ITEM_CATEGORY.RESOURCE, ITEM_CATEGORY.RUNE])

export interface send_item_source {
  readonly id: string
  readonly kiosk_id: string
  readonly amount: number
}

export interface send_item {
  readonly id: string
  readonly kiosk_id: string
  readonly template_id?: string | null
  readonly slug: string
  readonly name: string
  readonly appearance?: string
  readonly category?: string
  readonly level?: number
  readonly amount: number
  readonly stackable: boolean
  readonly sources: readonly send_item_source[]
}

export interface item_send_transfer {
  readonly item_id: string
  readonly amount: bigint
  readonly available_amount: bigint
}

export interface item_send_transfer_group {
  readonly kiosk_id: string
  readonly item_transfers: readonly item_send_transfer[]
}

export interface item_send_receiver_item {
  readonly name: string
  readonly amount: bigint
}

const positive_amount = (value: unknown): number => {
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 1
}

const item_identity = (item: any): string => String(item?.template_id || item?.item_type || item?.id || '')

const source_of = (item: any): send_item_source | null =>
  item?.id && item?.kiosk_id
    ? { id: String(item.id), kiosk_id: String(item.kiosk_id), amount: positive_amount(item.amount) }
    : null

const source_rows_of = (display_item: any, owned_items: readonly any[], stackable: boolean): readonly any[] =>
  stackable
    ? owned_items.filter((item) => item_identity(item) === item_identity(display_item) && item?.listed !== true)
    : [owned_items.find((item) => item?.id === display_item?.id) ?? display_item]

/** Convert a displayed bag row into a send target while recovering every raw stack object hidden by aggregation. */
export function project_inventory_send_item(display_item: any, owned_items: readonly any[] = []): send_item {
  const category = String(display_item?.item_category ?? display_item?.category ?? '').toLowerCase()
  const stackable = stackable_categories.has(category)
  const sources = source_rows_of(display_item, owned_items, stackable)
    .map(source_of)
    .filter((source): source is send_item_source => source != null)
  const fallback_source = {
    id: String(display_item?.id ?? ''),
    kiosk_id: String(display_item?.kiosk_id ?? ''),
    amount: positive_amount(display_item?.amount),
  }
  const usable_sources = sources.length > 0 ? sources : [fallback_source]

  return {
    id: String(display_item?.id ?? ''),
    kiosk_id: usable_sources[0].kiosk_id,
    template_id: display_item?.template_id ?? null,
    // #491: cosmetic_icon_of() FIRST — item_type alone is the generic slot word for a cosmetic (e.g. "cloak"),
    // shared by ~20 rows; the gift strip rendered blank/wrong icons for exactly the same reason the sell/history/
    // crush surfaces did (the resolver never checked the cosmetic map before falling back to the raw slug).
    slug: String(
      cosmetic_icon_of(display_item) ?? display_item?.icon_slug ?? display_item?.slug ?? display_item?.item_type ?? ''
    ),
    name: String(display_item?.name ?? display_item?.item_type ?? ''),
    appearance: display_item?.appearance,
    category,
    level: Number(display_item?.level) || 0,
    amount: usable_sources.reduce((total, source) => total + source.amount, 0),
    stackable,
    sources: usable_sources,
  }
}

/**
 * Plan exact source-object amounts, grouping them by the kiosk the established gift primitive mutates. Larger
 * stacks are consumed first to minimize split calls, gifted objects, and per-object royalty floors.
 */
export function build_item_send_transfer_groups(
  items: readonly send_item[],
  selected_amount?: bigint
): {
  groups: readonly item_send_transfer_group[]
  receiver_items: readonly item_send_receiver_item[]
  transfer_count: number
} {
  if (items.length === 0) throw new Error('NO_ITEMS')

  const planned = items.map((item) => {
    const requested =
      items.length === 1 && item.stackable && selected_amount != null ? selected_amount : BigInt(item.amount)
    if (requested < 1n) throw new Error('AMOUNT_INVALID')
    const sources = [...item.sources].sort((left, right) => right.amount - left.amount)
    const result = sources.reduce(
      (state, source) => {
        if (state.remaining === 0n) return state
        if (!source.id || !source.kiosk_id) throw new Error('NO_KIOSK')
        const available_amount = BigInt(source.amount)
        const amount = state.remaining < available_amount ? state.remaining : available_amount
        return {
          remaining: state.remaining - amount,
          transfers: [...state.transfers, { kiosk_id: source.kiosk_id, item_id: source.id, amount, available_amount }],
        }
      },
      {
        remaining: requested,
        transfers: [] as readonly (item_send_transfer & { readonly kiosk_id: string })[],
      }
    )
    if (result.remaining > 0n) throw new Error('AMOUNT_EXCEEDS_AVAILABLE')
    return { receiver_item: { name: item.name, amount: requested }, transfers: result.transfers }
  })

  const transfers = planned.flatMap((item) => item.transfers)
  const kiosk_ids = [...new Set(transfers.map((transfer) => transfer.kiosk_id))]
  const groups = kiosk_ids.map((kiosk_id) => ({
    kiosk_id,
    item_transfers: transfers
      .filter((transfer) => transfer.kiosk_id === kiosk_id)
      .map(({ item_id, amount, available_amount }) => ({ item_id, amount, available_amount })),
  }))
  return {
    groups,
    receiver_items: planned.map((item) => item.receiver_item),
    transfer_count: transfers.length,
  }
}
