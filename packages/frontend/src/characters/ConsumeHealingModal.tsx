// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { Heart } from 'lucide-react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { item_icon } from '../content/assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'
import { useAppStore } from '../store.ts'

import { consumable_plan } from './consumable_plan.ts'

export const ConsumeHealingModal = ({
  character,
  item,
  copy,
  close,
  confirm,
}: Readonly<{
  character: Readonly<CharacterRow>
  item: Readonly<ItemRow> | null
  copy: AppCopy
  close: () => void
  confirm: (item: Readonly<ItemRow>, mode: 'one' | 'full') => void
}>) => {
  const t = copy_text(copy.characters_page)
  const inventory = useAppStore(({ session }) => session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  if (!item) return null
  const plan = consumable_plan(character, item, inventory, encumbered_asset_ids(listings, trades), Date.now())
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={item.name} max_width="max-w-md" soft>
      <div className="p-6">
        <div className="flex items-center gap-3 pr-6">
          <img alt="" className="size-12 object-contain" src={item_icon(item.item_type) ?? undefined} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text">{item.name}</h2>
            <p className="mt-1 text-xs text-muted">
              {t('consume_healing_stock', { heal: plan.heal, available: plan.available })}
            </p>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted">
              <Heart aria-hidden="true" size={13} />
              {t('health')}
            </span>
            <span className="text-text tabular-nums">
              {plan.hp} / {plan.maximum}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-rose-400/80"
              style={{ width: `${Math.min(100, (plan.hp / plan.maximum) * 100)}%` }}
            />
          </div>
        </div>
        <div className="mt-5 flex items-stretch justify-end gap-2">
          <button
            className="btn-outline min-h-10 px-4 py-2 text-xs disabled:opacity-40"
            disabled={plan.needed === 0 || plan.available < 1}
            onClick={() => confirm(item, 'one')}
            style={{ textTransform: 'none' }}
            type="button"
          >
            {t('consume_one')}
          </button>
          <button
            className="btn-gold min-h-10 px-4 py-2 text-xs disabled:opacity-40"
            disabled={plan.needed === 0 || plan.available < plan.needed}
            onClick={() => confirm(item, 'full')}
            style={{ textTransform: 'none' }}
            type="button"
          >
            {t('consume_until_full')} <span className="ml-1.5 opacity-70 tabular-nums">×{plan.needed}</span>
          </button>
        </div>
        {plan.available < plan.needed && (
          <p className="mt-3 text-xs text-muted">{t('consume_healing_insufficient', { count: plan.needed })}</p>
        )}
      </div>
    </ModalFrame>
  )
}
