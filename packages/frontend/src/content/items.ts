// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SeedItem } from '@aresrpg/sdk/seed'

import source from '../../../../seed/content/items.json'

/** Item-only consumers must not import world compilation or the gameplay catalogue. */
export const items = Object.freeze(source as unknown as readonly SeedItem[])
export const items_by_type: Readonly<Record<string, SeedItem>> = Object.freeze(
  Object.fromEntries(items.map((item) => [item.item_type, item]))
)

export const title_item = (item_type: string | null | undefined): SeedItem | undefined => {
  const item = item_type ? items_by_type[item_type] : undefined
  return item?.category === 'title' ? item : undefined
}

export const title_model = (item_type: string | null | undefined): string | undefined =>
  title_item(item_type)?.title_model

export const box_rewards = (item_type: string) => {
  const effect = items_by_type[item_type]?.consumable
  return effect?.type === 'loot_box' ? effect.rewards : []
}
