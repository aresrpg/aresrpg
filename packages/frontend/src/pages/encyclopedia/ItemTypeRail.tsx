// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE THIRD COLUMN (issue #31 ①): the item-type list, as a compact rail beside the grid — never a top tab.
// Same house rail idiom the marketplace's ItemTypeColumn already ships (compact, monospace, uppercase, gold
// left-accent on the active row, zero border-radius, alternating row shade) so the encyclopedia and the
// marketplace read as one system; the two components differ only in their data shape (item_type_rail.ts's
// {type,count} buckets here vs marketplace listings there), never in the visual language.
import { useTranslation } from 'react-i18next'

import { marketplace_item_type_key } from '../../components/marketplace/marketplace_model'

import type { ItemTypeBucket } from './item_type_rail'

export function ItemTypeRail({
  buckets,
  active,
  mobile,
  on_pick,
}: {
  buckets: readonly ItemTypeBucket[]
  active: string | null
  mobile: boolean
  on_pick: (type: string) => void
}) {
  const { t } = useTranslation()
  return (
    <nav
      data-encyclopedia-item-type-rail
      aria-label={t('encyclopedia.item_type')}
      className={`app-mobile-chip-row flex flex-col min-h-0 overflow-y-auto border-r border-border shrink-0 ${mobile ? 'w-full' : 'w-40'}`}
    >
      {buckets.map(({ type, count }, index) => {
        const is_active = active === type
        return (
          <button
            key={type}
            type="button"
            className={`flex items-center justify-between gap-3 w-full px-4 py-2.5 text-left border-l-2 ${mobile ? 'min-w-max' : ''}`}
            style={{
              borderLeftColor: is_active ? '#c8963c' : 'transparent',
              background: is_active
                ? 'rgba(200,150,60,0.08)'
                : index % 2 === 1
                  ? 'rgba(255,255,255,0.018)'
                  : 'transparent',
            }}
            aria-pressed={is_active}
            onClick={() => on_pick(is_active ? '' : type)}
          >
            <span
              className={`text-[9px] tracking-[0.1em] uppercase truncate ${is_active ? 'text-gold' : 'text-muted'}`}
            >
              {t(marketplace_item_type_key(type), type)}
            </span>
            <span className="text-[8px] text-muted/50 tabular-nums shrink-0">{count}</span>
          </button>
        )
      })}
    </nav>
  )
}
