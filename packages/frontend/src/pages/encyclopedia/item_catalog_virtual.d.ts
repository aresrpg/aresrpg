// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Types for the `virtual:item_catalog` module (packages/frontend/dev/item_catalog_plugin.ts) — the encyclopedia
// stat catalog + name→slug map derived from seed/mainnet at build/serve time. Shapes mirror the shared transform
// (scripts/lib/item_catalog_transform.mjs) and item_catalog.ts's CatalogData.
declare module 'virtual:item_catalog' {
  export const catalog: Record<
    string,
    {
      rarity?: string
      weapon_class?: string
      stats?: Record<string, [number, number]>
      damages?: { element: string; from: number; to: number }[]
    }
  >
  export const slugs: Record<string, string>
  /** The GLOBAL feedable food slugs (D757 pet-agnostic pet-feed mechanic) — build_pet_food_slugs. */
  export const pet_food_slugs: string[]
}
