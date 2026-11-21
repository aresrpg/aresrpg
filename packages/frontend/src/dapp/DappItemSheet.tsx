// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'
import type { ItemRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { ConsumableEffectSection } from '../encyclopedia/ConsumableEffectSection.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'

import { dapp_text, item_name } from './copy.ts'
import { DappMarketLink, open_market } from './DappMarketLink.tsx'

import './dapp_parts.css'

/**
 * What an item sheet is about: one owned copy, with the exact values it rolled, or an item type, with
 * the ranges the seed authors for it.
 */
export type ItemSubject = Readonly<
  { kind: 'owned'; item: Readonly<Omit<ItemRow, 'kiosk'>> } | { kind: 'type'; item_type: string }
>
const subject_item_type = (subject: ItemSubject): string =>
  subject.kind === 'owned' ? subject.item.item_type : subject.item_type

/** One item of a list: its icon, its name with an optional detail, and one value. It opens that item's sheet. */
export const DappItemRow = ({
  item_type,
  detail,
  value,
  open,
}: Readonly<{ item_type: string; detail?: string; value: string; open: () => void }>) => {
  const icon = item_icon(item_type)
  return (
    <Button className="dapp-row" data-item-row={item_type} onClick={open}>
      {icon && <img src={icon} alt="" />}
      <span className="dapp-row-name">{[item_name(item_type), detail].filter(Boolean).join(' ')}</span>
      <span className="dapp-row-value">{value}</span>
    </Button>
  )
}

/** The game's own detail of an item type: ranges, effect, recipe, who drops it and what it makes. */
const TypeDetail = ({ copy, item_type }: Readonly<{ copy: AppCopy; item_type: string }>) => {
  const item = content_catalog.item(item_type)?.item
  const text = encyclopedia_text(copy)
  if (!item) return null
  return (
    <ItemDetailView
      item_type={item.item_type}
      name={item.name}
      category={item.category}
      level={item.level}
      stats={item.stats}
      damages={item.damages ?? []}
      labels={{
        characteristics: text('characteristics'),
        damages: text('damages'),
        level_short: text('level_short', { level: item.level }),
        range_to: text('range_to'),
      }}
    >
      <ConsumableEffectSection consumable={item.consumable} text={text} />
    </ItemDetailView>
  )
}

/**
 * One item, in the game's own detail view. Its footer leads to the Market tab, the only place with
 * prices: Sell when the bag holds the item, and the link to its listings.
 */
export const DappItemSheet = ({
  copy,
  subject,
  close,
}: Readonly<{ copy: AppCopy; subject: ItemSubject; close: () => void }>) => {
  const item_type = subject_item_type(subject)
  const held = useAppStore(({ session }) =>
    session.agent_inventory.inventory.some((row) => row.item_type === item_type)
  )
  const title = subject.kind === 'owned' ? subject.item.name : item_name(item_type)
  return (
    <NativeModal close={close} label={title} className="aui-modal-scrim">
      <GameWindow
        title={title}
        close={close}
        close_label={dapp_text(copy, 'close')}
        className="aui-inspection aui-inspection--item"
        data-item-sheet={subject.kind}
      >
        {subject.kind === 'owned' ? (
          <OwnedItemDetail item={subject.item} copy={copy} />
        ) : (
          <TypeDetail copy={copy} item_type={item_type} />
        )}
        <footer className="dapp-sheet-foot">
          <DappMarketLink copy={copy} item_type={item_type} on_open={close} />
          {held && (
            <Button
              tone="primary"
              onClick={() => {
                open_market('SELL')
                close()
              }}
            >
              {dapp_text(copy, 'item_sell')}
            </Button>
          )}
        </footer>
      </GameWindow>
    </NativeModal>
  )
}
