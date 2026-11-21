// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { inventory_groups } from '@aresrpg/protocol/inventory'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { item_icon } from '../content/assets.ts'
import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'

import { dapp_text, item_name } from './copy.ts'
import type { BagGain } from './bag_feed.ts'
import { DappItemSheet } from './DappItemSheet.tsx'

/** What entered the bag lately, newest first. The bag below stays the truth of what is held. */
const Feed = ({ copy, gains }: Readonly<{ copy: AppCopy; gains: readonly BagGain[] }>) => {
  if (!gains.length) return <p className="dapp-note">{dapp_text(copy, 'bag_feed_empty')}</p>
  return (
    <ul className="dapp-bag-feed" aria-live="polite">
      {gains.map(({ item_type, amount }) => {
        const [name, icon] = [item_name(item_type), item_icon(item_type)]
        return (
          <li key={item_type}>
            {icon && <img src={icon} alt="" />}
            <span>{name}</span>
            <strong>+{amount}</strong>
          </li>
        )
      })}
    </ul>
  )
}

const Items = ({ copy, rows }: Readonly<{ copy: AppCopy; rows: readonly ItemRow[] }>) => {
  const [open, set_open] = useState<ItemRow | null>(null)
  if (!rows.length) return <p className="dapp-note">{dapp_text(copy, 'bag_empty')}</p>
  return (
    <>
      <div className="dapp-bag-grid">
        {inventory_groups(rows).map(({ item, amount }) => (
          <InventoryItemCell key={item.id} item={item} amount={amount} show_level onClick={() => set_open(item)} />
        ))}
      </div>
      {open && <DappItemSheet copy={copy} subject={{ kind: 'owned', item: open }} close={() => set_open(null)} />}
    </>
  )
}

/** What entered the bag lately. It stands beside the board, never in the middle of it. */
export const DappBagFeed = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const gains = useAppStore(({ dapp }) => dapp.bag_feed.gains)
  return (
    <aside className="dapp-bag-feed-panel" aria-label={dapp_text(copy, 'bag_feed_title')}>
      <h2>{dapp_text(copy, 'bag_feed_title')}</h2>
      <Feed copy={copy} gains={gains} />
    </aside>
  )
}

/** The bot's bag, shared by every hero. It is the truth of what is held. */
export const DappBag = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const ready = useAppStore(({ session }) => session.agent_inventory.phase === 'ready')
  const rows = useAppStore(({ session }) => session.agent_inventory.inventory)
  return (
    <section className="dapp-section" aria-label={dapp_text(copy, 'bag_title')}>
      <h2>{dapp_text(copy, 'bag_title')}</h2>
      {ready ? <Items copy={copy} rows={rows} /> : <p className="dapp-note">{dapp_text(copy, 'bag_loading')}</p>}
    </section>
  )
}
