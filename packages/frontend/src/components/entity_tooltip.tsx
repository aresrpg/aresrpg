// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import { use_template_t } from '../i18n/template_t'

import { onchain_template_to_detail_props, use_mouse_tooltip } from './items'
import { ItemDetailView, RemovedItemNotice } from './item_detail_view'

/**
 * The SHARED hover tooltip for the 3 chain-direct surfaces (findables/WorldCard, recall/ResultCard,
 * Inventory equipment+bag). Feed it a raw on-chain ItemTemplate (normalize_item_template shape) — it
 * converges through onchain_template_to_detail_props (display-first + bias-decode) into the SAME
 * ItemDetailView the encyclopedia/admin surfaces already render. One component, three surfaces.
 * Descriptions localize via tt (lazy item_desc catalog, item_type-keyed; Display EN fallback).
 *
 * `pet_food_row` (pets show WHAT THEY EAT on the hover card): an optional pre-bound node
 * this hook mounts under the card for PET items only. The DATA arrives from the caller (Inventory binds
 * `virtual:item_catalog`'s pet_food_slugs + the seed receipt) because this module must stay bun-importable
 * — a `virtual:` import here would break every test that transitively renders the entity_display barrel.
 */
export function use_onchain_item_tooltip({ pet_food_row }: { pet_food_row?: ReactNode } = {}) {
  const tt = use_template_t()
  return use_mouse_tooltip<Parameters<typeof onchain_template_to_detail_props>[0]>((tmpl) => {
    const detail = onchain_template_to_detail_props(tmpl, tt)
    return (
      <div
        className="pointer-events-none z-50"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid rgba(200,150,60,0.3)',
          boxShadow: '0 0 20px rgba(200,150,60,0.1)',
          padding: '12px 16px',
          maxWidth: 280,
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        {/* ORPHAN state: the item's ItemTemplate was deleted on-chain, so there is
            no stat/level/display data to join — show the honest "removed from the game, crush it for runes"
            notice instead of a de-slugged name with empty stats. Inventory flags `removed` on the hover payload
            (is_template_removed — the ONE detection home). */}
        {(tmpl as any)?.removed ? (
          <RemovedItemNotice />
        ) : (
          <ItemDetailView item={detail}>{detail.category.toUpperCase() === 'PET' && pet_food_row}</ItemDetailView>
        )}
      </div>
    )
  })
}
