// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'
import { Button } from '@aresrpg/ui'
import { ArrowLeftRight, BookOpen, Store, Tag } from 'lucide-react'

import { AgentKioskStatus } from '../agents/AgentKioskStatus.tsx'
import type { AgentKioskController } from '../agents/useAgentKiosk.ts'
import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import { NewTabLink } from '../components/links.tsx'
import { ModalFrame } from '../components/ModalFrame.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { market_item_href } from '../site/routes.ts'
import { docs_path } from '../docs/routes.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import type { useMarketSell } from '../marketplace/useMarketSell.ts'

import type { BagCell } from './bag.ts'
import { ACTIONS } from './HeroCard.tsx'

/**
 * One cell of the bag: the item and its stats, then what the player can do with it. A stackable cell stands for
 * every stack of its type, and each action takes them all. Listing opens the page's sale form on the stack the
 * other stacks merge into; the transfer is the one between the owner's two accounts (`useAgentKiosk`), which
 * reads the cell's stacks from the account's `items`. The bot sells by its own commands, so its items offer no
 * listing here.
 */
export const ItemWindow = ({
  copy,
  cell,
  items,
  on_bot,
  kiosk,
  sale,
  close,
}: Readonly<{
  copy: AppCopy
  cell: BagCell
  items: readonly ItemRow[]
  on_bot: boolean
  kiosk: AgentKioskController
  sale: ReturnType<typeof useMarketSell>
  close: () => void
}>) => {
  const { item } = cell
  const market = copy_text(copy.marketplace_page)
  const text = copy_text(copy.portfolio_page)
  const listable = on_bot
    ? undefined
    : sale.items.find(({ row, merge_sources }) => row.id === item.id || merge_sources.includes(item.id))
  const can_transfer = [
    kiosk.state.phase === 'ready',
    !kiosk.busy,
    !kiosk.blocked,
    !cell.items.some(({ id }) => kiosk.pending_ids.has(id)),
  ]
  return (
    <ItemDetailContext.Provider value="summary">
      <ModalFrame label={market('item')} close={close} close_label={copy.wallet_close} max_width="max-w-sm">
        <div
          className="grid gap-4 px-4 pt-1 pb-4 [&_.aui-button]:min-h-11 [&_.aui-button]:gap-2 [&_.aui-button]:no-underline"
          data-portfolio-item={item.id}
        >
          <OwnedItemDetail item={item} copy={copy} />
          <AgentKioskStatus kiosk={kiosk} copy={copy} />
          <div className={ACTIONS}>
            {listable && (
              <Button tone="primary" onClick={() => sale.choose(listable)}>
                <Tag size={16} aria-hidden="true" />
                {market('list_for_sale')}
              </Button>
            )}
            {kiosk.pairing && (
              <Button
                busy={kiosk.busy || kiosk.state.phase === 'loading'}
                disabled={!can_transfer.every(Boolean)}
                onClick={() => {
                  // The move runs on with a toast; the cell shows it moving and the visitor goes on.
                  kiosk.offer([item.id], on_bot ? 'withdraw' : 'deposit', items)
                  close()
                }}
              >
                <ArrowLeftRight size={16} aria-hidden="true" />
                {text(on_bot ? 'transfer_to_player' : 'transfer_to_bot')}
              </Button>
            )}
            <a className="aui-button aui-button--neutral" href={market_item_href(item.item_type)}>
              <Store size={16} aria-hidden="true" />
              {text('view_market')}
            </a>
            <NewTabLink
              className="aui-button aui-button--neutral"
              href={docs_path('items', item.item_type)}
              new_tab={copy.site.new_tab}
            >
              <BookOpen size={16} aria-hidden="true" />
              {copy.encyclopedia}
            </NewTabLink>
          </div>
        </div>
      </ModalFrame>
    </ItemDetailContext.Provider>
  )
}
