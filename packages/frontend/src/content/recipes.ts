// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SeedRecipe } from '@aresrpg/sdk/seed'

import source from '../../../../seed/content/recipes.json'

/** Recipe-only consumers import this table alone, not the gameplay catalogue. */
export const recipes = Object.freeze(source as unknown as readonly SeedRecipe[])

const crafted = new Set(recipes.map(({ output_type }) => output_type))
/** Whether a recipe makes this item. */
export const is_crafted = (item_type: string): boolean => crafted.has(item_type)
