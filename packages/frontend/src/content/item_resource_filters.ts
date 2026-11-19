// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { encyclopedia_catalog } from './catalog.ts'

/** Reuse the authored-content facet; pet food remains a resource on chain. */
const pet_food_item_types = new Set(
  encyclopedia_catalog.item_filters.find(({ group, id }) => group === 'resource' && id === 'pet_food')?.item_types ?? []
)

export const item_is_pet_food = (item_type: string): boolean => pet_food_item_types.has(item_type)
