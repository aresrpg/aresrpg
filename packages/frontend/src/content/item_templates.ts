// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The chain names an item by its template id; the items table names it by its type.
import { item_template_id } from '@aresrpg/sdk/seed-ids'
import { resolve_pins } from '@aresrpg/sdk/pins'

import { env } from '../env.ts'

import { items } from './items.ts'

/** template id → item_type over the authored catalog — PURE derivation, zero chain reads. */
export const rolled_item_types = (() => {
  let map: Map<string, string> | null = null
  return (): Map<string, string> => {
    if (map) return map
    const pins = resolve_pins(env.network) as { content_root?: { id?: string }; seed_package_original?: string }
    const content_root = pins?.content_root?.id
    const seed_original = pins?.seed_package_original
    map = new Map(
      content_root && seed_original
        ? items.map(({ item_type }) => [item_template_id(content_root, seed_original, item_type), item_type])
        : []
    )
    return map
  }
})()
