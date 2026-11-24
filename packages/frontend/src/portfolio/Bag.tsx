// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The bag tab: the market's groups as one row of choices, then the account's cells. A choice never moves the page:
// every cell keeps its place in the grid, and the cells of other groups only hide behind the ones shown.
import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'
import { useState, type ReactNode } from 'react'

import type { AgentKioskController } from '../agents/useAgentKiosk.ts'
import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { ITEM_GROUPS } from '../marketplace/market_browse.ts'
import { Choice } from '../marketplace/MarketParts.tsx'
import type { useMarketSell } from '../marketplace/useMarketSell.ts'
import type { MarketGroup } from '../modules/marketplace.ts'

import { in_group, type BagCell } from './bag.ts'
import { ItemWindow } from './ItemWindow.tsx'

export const BAG = 'grid grid-cols-[repeat(auto-fill,64px)] gap-2 [&_.chr-cell]:size-16'

/** All the bag, or one group of the market, each with its count once the account answered. */
const BagFilter = ({
  copy,
  cells,
  group,
  choose,
}: Readonly<{
  copy: AppCopy
  cells: readonly BagCell[] | null
  group: MarketGroup | null
  choose: (group: MarketGroup | null) => void
}>) => {
  const numbers = useNumbers()
  const market = copy_text(copy.marketplace_page)
  const count = (choice: MarketGroup | null) => (cells ? numbers.number(cells.filter(in_group(choice)).length) : '')
  return (
    <nav className="flex scrollbar-none gap-x-5 overflow-x-auto *:flex-none" aria-label={market('browse')}>
      {[null, ...ITEM_GROUPS].map((choice) => (
        <Choice key={choice ?? 'all'} chosen={group === choice} pick={() => choose(choice)}>
          {choice ? market(`group_${choice.toLowerCase()}`) : market('filter_all')}
          <span className="min-w-[2ch] font-mono text-xs leading-[normal] font-normal text-faint tabular-nums">
            {count(choice)}
          </span>
        </Choice>
      ))}
    </nav>
  )
}

/** The cells, or what stands in their place: the boxes while the account loads, else a sentence. */
export const Bag = ({
  copy,
  cells,
  items,
  on_bot,
  kiosk,
  sale,
  waiting,
}: Readonly<{
  copy: AppCopy
  cells: readonly BagCell[] | null
  /** The account's items its cells stand for: a transfer reads the stacks of a cell from them. */
  items: readonly ItemRow[]
  on_bot: boolean
  kiosk: AgentKioskController
  sale: ReturnType<typeof useMarketSell>
  waiting: ReactNode
}>) => {
  const [group, choose] = useState<MarketGroup | null>(null)
  const [opened, open] = useState<string | null>(null)
  // The window follows its cell through merges and closes by itself once the cell leaves this account.
  const cell = cells?.find(({ items: stacks }) => stacks.some(({ id }) => id === opened))
  const shown = in_group(group)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <BagFilter copy={copy} cells={cells} group={group} choose={choose} />
      {cells?.length ? (
        <div className={`${BAG} relative`} data-portfolio-bag="">
          {cells.map((row) => (
            <InventoryItemCell
              key={row.item.id}
              item={row.item}
              amount={row.amount}
              show_level={!item_is_stackable(row.item.category)}
              pending={row.items.some(({ id }) => kiosk.pending_ids.has(id))}
              class_name={shown(row) ? undefined : 'invisible order-1'}
              onClick={() => open(row.item.id)}
            />
          ))}
          {!cells.some(shown) && (
            <p className="absolute inset-x-0 top-0 py-6 leading-normal text-soft">
              {copy_text(copy.portfolio_page)('bag_group_empty')}
            </p>
          )}
        </div>
      ) : (
        waiting
      )}
      {cell && (
        <ItemWindow
          copy={copy}
          cell={cell}
          items={items}
          on_bot={on_bot}
          kiosk={kiosk}
          sale={sale}
          close={() => open(null)}
        />
      )}
    </div>
  )
}
