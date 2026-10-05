// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemRow } from '@aresrpg/protocol'

import { content_catalog } from '../content/catalog.ts'
import { available_item_stacks } from '../inventory_stacks.ts'

export type JourneyIngredient = Readonly<{ item: string; have: number; need: number }>

/** The recipe owns quantities; fragments and already-owned resources count toward one attempt. */
export const journey_ingredients = (
  output: string,
  inventory: readonly ItemRow[],
  encumbered: ReadonlySet<string>,
  kiosk: string | null
): readonly JourneyIngredient[] =>
  (content_catalog.item(output)?.recipe?.ingredients ?? []).map(({ item_type, quantity }) => ({
    item: item_type,
    need: quantity,
    have:
      kiosk === null
        ? 0
        : available_item_stacks(inventory, encumbered, item_type, kiosk).reduce((sum, item) => sum + item.amount, 0),
  }))
