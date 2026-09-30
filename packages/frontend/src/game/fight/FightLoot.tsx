// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useRef } from 'react'
import { createPortal } from 'react-dom'

import { InspectionWindow } from '../../components/ItemDetailView.tsx'
import { OwnedItemDetail } from '../../components/OwnedItemDetail.tsx'
import { useInspections } from '../../components/useInspections.ts'
import { item_icon } from '../../content/assets.ts'
import { content_catalog, titleize, type SeedItem } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { useText } from '../../i18n/useText.ts'
import type { ResultLoot } from '../../modules/fight_result.ts'
import { useAppStore } from '../../store.ts'

/** Receipt IDs select the delivered copies; a matching older inventory item is never a substitute. */
export const FightLoot = ({
  loot,
  copy,
  items,
  item_ids,
}: Readonly<{
  loot: ResultLoot
  copy: AppCopy
  items?: readonly SeedItem[]
  /** Undefined is catalogue-only loot (another player's result or a local preview). */
  item_ids?: readonly string[]
}>) => {
  const root = useRef<HTMLButtonElement>(null)
  const { inspections, open, close } = useInspections(root)
  const inventory = useAppStore(({ session }) => session.inventory)
  const text = useText()
  const template = (id: string) => items?.find(({ item_type }) => item_type === id) ?? content_catalog.item(id)?.item
  const name = template(loot.item_type)?.name ?? titleize(loot.item_type)
  const received = inventory.filter(({ id, item_type }) => item_ids?.includes(id) && item_type === loot.item_type)
  const pending = item_ids?.some((id) => !inventory.some((item) => item.id === id))
  return (
    <>
      <button
        ref={root}
        type="button"
        onClick={() => open('item')(loot.item_type)}
        aria-label={name}
        className="fe-tile"
      >
        {item_icon(loot.item_type) ? (
          <img alt="" className="item-icon" src={item_icon(loot.item_type)!} />
        ) : (
          <span className="fe-tile__letter">{name.trim()[0]?.toUpperCase() ?? '?'}</span>
        )}
        <span className="fe-tile__qty">×{loot.qty}</span>
        <span className="fe-tile__tooltip" role="tooltip">
          {name}
        </span>
      </button>
      {typeof document !== 'undefined' &&
        createPortal(
          inspections.map((entry) => (
            <InspectionWindow
              key={`${entry.kind}:${entry.id}`}
              entry={entry}
              item={template(entry.id)}
              open={open}
              close={() => close(entry)}
              render_item={
                item_ids && entry.id === loot.item_type
                  ? () => (
                      <div className="flex flex-col gap-6">
                        {received.map((item) => (
                          <OwnedItemDetail key={item.id} item={item} copy={copy} />
                        ))}
                        {(pending || received.length === 0) && <p>{copy.fight_hud.chat_fetching_item}</p>}
                      </div>
                    )
                  : undefined
              }
              props={{
                labels: {
                  characteristics: text('encyclopedia_page.characteristics'),
                  damages: text('encyclopedia_page.damages'),
                  range_to: text('encyclopedia_page.range_to'),
                  level_short: '',
                },
              }}
            />
          )),
          document.body
        )}
    </>
  )
}
