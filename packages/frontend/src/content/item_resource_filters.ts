// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pet_food_outputs } from './item_filters.ts'
import { items_by_type } from './items.ts'
import { recipes } from './recipes.ts'

/** Pet food is a resource a rare pet-food recipe makes; on chain it remains a resource. It reads the item and
 *  recipe tables alone. */
const pet_food_item_types = new Set(
  [...pet_food_outputs(recipes)].filter((item_type) => items_by_type[item_type]?.category === 'resource')
)

export const item_is_pet_food = (item_type: string): boolean => pet_food_item_types.has(item_type)
