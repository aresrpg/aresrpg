// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MISSING-ARTIFACT (#117): packages/sdk/src/items.json (aliased items-data) ships as an empty `{}`
// placeholder in this public repo — the real item catalog is authored+transformed by the content pipeline
// (private repo, item_catalog_transform). Any surface deriving from it (simulator-equip, quest_ladder,
// commission_recipes' craft_recipes/recipe_ingredients, …) degrades to empty results here.
import items_data from '@aresrpg/sdk/items-data'

export const ITEMS_CATALOG_AVAILABLE = Object.keys(items_data).length > 0
