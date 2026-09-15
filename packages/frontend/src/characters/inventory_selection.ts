// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemRow } from '@aresrpg/protocol'

import { encumbered_asset_ids } from '../inventory_stacks.ts'

import { is_forge_gear } from './forge_eligibility.ts'

export const select_inventory_item = (selected: readonly string[], id: string, toggle: boolean): readonly string[] => {
  if (!toggle) return [id]
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
}

/** Revalidate the WHOLE reviewed set; never silently crush an available subset. */
export const crush_selection = (
  selected: readonly Readonly<ItemRow>[],
  inventory: readonly Readonly<ItemRow>[],
  blocked: ReadonlySet<string>
): readonly Readonly<ItemRow>[] | null => {
  if (!selected.length) return null
  const live = new Map(inventory.map((item) => [item.id, item]))
  const rows = selected.map((item) => live.get(item.id))
  if (new Set(selected.map(({ id }) => id)).size !== selected.length) return null
  const valid = rows.every(
    (row, index) =>
      row &&
      !blocked.has(row.id) &&
      is_forge_gear(row) &&
      row.kiosk === selected[index]!.kiosk &&
      row.kiosk === selected[0]!.kiosk
  )
  return valid ? (rows as readonly Readonly<ItemRow>[]) : null
}

export const crush_blocked_ids = ({
  listings,
  trades,
  characters,
}: Readonly<{
  listings: Parameters<typeof encumbered_asset_ids>[0]
  trades: Parameters<typeof encumbered_asset_ids>[1]
  characters: readonly Readonly<import('@aresrpg/protocol').CharacterRow>[]
}>): ReadonlySet<string> =>
  new Set([
    ...encumbered_asset_ids(listings, trades),
    ...characters.flatMap(({ equipment }) => equipment.map(({ id }) => id)),
  ])
