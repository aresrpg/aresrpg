// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

import { InspectionWindow } from '../../components/ItemDetailView.tsx'
import { OwnedItemDetail } from '../../components/OwnedItemDetail.tsx'
import { useInspections } from '../../components/useInspections.ts'
import { item_icon } from '../../content/assets.ts'
import { content_catalog, titleize, type SeedItem } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { useText } from '../../i18n/useText.ts'
import type { ResultLoot } from '../../modules/fight_result.ts'
import { useAppStore } from '../../store.ts'

/** A settlement receipt spans several loot types. Only missing copies of this reward are pending. */
export const fight_loot_inventory = (
  loot: ResultLoot,
  item_ids: readonly string[],
  inventory: readonly ItemRow[],
  removed_item_versions: Readonly<Record<string, string>>
) => {
  const inventory_ids = new Set(inventory.map(({ id }) => id))
  const received = inventory.filter((item) => item_ids.includes(item.id) && item.item_type === loot.item_type)
  const missing = received.length < loot.qty
  const pending = missing && item_ids.some((id) => !inventory_ids.has(id) && removed_item_versions[id] === undefined)
  return { received, missing, pending }
}

/** Receipt IDs select the delivered copies; a matching older inventory item is never a substitute. */
export const FightLoot = ({
  loot,
  copy,
  items,
  item_ids = [],
}: Readonly<{
  loot: ResultLoot
  copy: AppCopy
  items?: readonly SeedItem[]
  /** Missing IDs cannot identify a delivered roll; those rewards use their catalogue details. */
  item_ids?: readonly string[]
}>) => {
  const root = useRef<HTMLButtonElement>(null)
  const { inspections, open, close } = useInspections(root)
  const inventory = useAppStore(({ session }) => session.inventory)
  const removed_item_versions = useAppStore(({ session }) => session.removed_item_versions)
  const text = useText()
  const template = (id: string) => items?.find(({ item_type }) => item_type === id) ?? content_catalog.item(id)?.item
  const { name, category } = template(loot.item_type) ?? { name: titleize(loot.item_type), category: '' }
  const exact = item_ids.length > 0 && !item_is_stackable(category)
  const { received, missing, pending } = fight_loot_inventory(loot, item_ids, inventory, removed_item_versions)
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
                exact && entry.id === loot.item_type
                  ? () => (
                      <div className="flex flex-col gap-6">
                        {received.map((item) => (
                          <OwnedItemDetail key={item.id} item={item} copy={copy} />
                        ))}
                        {missing && (
                          <p>
                            {pending ? copy.fight_hud.result_waiting_items : copy.fight_hud.result_item_unavailable}
                          </p>
                        )}
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
