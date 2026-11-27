// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What a shop purchase bought: the item, what a crate can hold, the way to the bag, and for a crate the same
// opening as the game's. The opening loads on demand, so the site carries none of its sound or motion before then.
import { lazy, Suspense, useState } from 'react'
import { Button } from '@aresrpg/ui'
import type { ItemRow } from '@aresrpg/protocol'
import { Backpack, PackageOpen } from 'lucide-react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { items_by_type } from '../content/items.ts'
import { titleize } from '../content/titles.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'
import { SITE_ADDRESSES } from '../site/routes.ts'
import { SiteLink } from '../site/SiteShell.tsx'
import { useAppStore } from '../store.ts'

import { CrateRewards } from './CrateContents.tsx'
import { useMasterySource } from './MasterySource.tsx'
import { offer_view } from './model.ts'

const UseBoxModal = lazy(async () => ({ default: (await import('../characters/UseBoxModal.tsx')).UseBoxModal }))

export const PurchasedOffer = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const { mastery, dispatch } = useMasterySource()
  const inventory = useAppStore(({ session }) => session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const [opening, set_opening] = useState<ItemRow | null>(null)
  const { purchased } = mastery
  if (!purchased) return null
  const { item_type, count } = purchased
  const text = copy_text(copy.mastery_page)
  const close = () => dispatch({ type: 'mastery/purchase_closed' })
  if (opening)
    return (
      <Suspense fallback={null}>
        <UseBoxModal box={opening} copy={copy} close={close} />
      </Suspense>
    )
  const blocked = encumbered_asset_ids(listings, trades)
  // The receipt does not name the bought pile: it is the one of this item the bag shows once the purchase arrives.
  const pile = inventory.find((row) => row.item_type === item_type && !blocked.has(row.id))
  const is_crate = offer_view(item_type).contents !== null
  const icon = item_detail_icon(item_type)
  return (
    <ModalFrame label={text('offer_purchased')} close={close} close_label={copy.wallet_close} max_width="max-w-xl">
      <div className="grid gap-4 px-4 pt-2 pb-4" data-mastery-purchased={item_type}>
        <div className="flex items-center gap-4">
          {icon && <img alt="" className="size-20 shrink-0 object-contain" src={icon} />}
          <div className="min-w-0">
            <strong className="block font-ui text-base font-bold text-gold">
              {items_by_type[item_type]?.name ?? titleize(item_type)}
            </strong>
            <span className="text-xs text-muted tabular-nums">× {count}</span>
          </div>
        </div>
        {is_crate && <CrateRewards copy={copy} item_type={item_type} />}
        <div className="flex flex-wrap justify-end gap-3">
          <SiteLink
            className="aui-button aui-button--neutral min-h-11 gap-2 no-underline"
            href={SITE_ADDRESSES.portfolio}
          >
            <Backpack size={16} aria-hidden="true" />
            {text('purchase_inventory')}
          </SiteLink>
          {is_crate && (
            <Button
              className="min-h-11"
              tone="primary"
              busy={!pile}
              disabled={!pile}
              title={pile ? undefined : text('purchase_arriving')}
              onClick={() => pile && set_opening(pile)}
              type="button"
            >
              <PackageOpen size={16} aria-hidden="true" />
              {text('purchase_open')}
            </Button>
          )}
        </div>
      </div>
    </ModalFrame>
  )
}
