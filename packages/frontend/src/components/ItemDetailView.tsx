// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { GameWindow, FloatingWindow } from '@aresrpg/ui'
import { useRef, useContext, type ReactNode } from 'react'

import { encyclopedia_catalog, type SeedItem } from '../content/catalog.ts'
import { useText } from '../i18n/useText.ts'

import { MobInspection, WorldInspection } from './CatalogueInspection.tsx'
import { ItemDetailContext } from './ItemDetailContext.ts'
import { ItemAcquisition } from './ItemAcquisition.tsx'
import { ItemCrafting } from './ItemCrafting.tsx'
import { ItemDetailBody, type ItemDetailProps } from './ItemDetailBody.tsx'
import {
  InspectionContext,
  inspection_identity as identity,
  useInspections,
  type Inspection,
} from './useInspections.ts'

export {
  InlineField,
  item_stat_rows,
  item_stat_display_range,
  type ItemDetailPath,
  type ItemDetailValue,
  type ItemDetailEdit,
  type ItemStatRow,
} from './ItemDetailBody.tsx'

export type { Inspection } from './useInspections.ts'

export const ItemDetailView = (props: ItemDetailProps) => {
  const context = useContext(ItemDetailContext)
  const root = useRef<HTMLDivElement>(null)
  const { inspections, open, close } = useInspections(root)
  return (
    <div ref={root} className="item-sheet-container">
      <ItemDetailBody {...props}>
        {props.children}
        {!props.edit && context === 'full' && (
          <>
            <ItemCrafting item_type={props.item_type} session={props.craft_session} open_ingredient={open('item')} />
            <ItemAcquisition
              item_type={props.item_type}
              select_item={open('item')}
              select_mob={props.select_mob ?? open('mob')}
              select_world={props.select_world ?? open('world')}
            />
          </>
        )}
      </ItemDetailBody>
      {inspections.map((entry) => (
        <InspectionWindow key={identity(entry)} entry={entry} props={props} close={() => close(entry)} open={open} />
      ))}
    </div>
  )
}

export const InspectionWindow = ({
  entry,
  props,
  close,
  open,
  render_item,
  item: supplied_item,
}: InspectionWindowProps) => {
  switch (entry.kind) {
    case 'mob':
      return <MobInspection id={entry.id} close={close} select_item={open('item')} select_world={open('world')} />
    case 'world':
      return (
        <WorldInspection
          id={entry.id}
          close={close}
          select_item={open('item')}
          select_world={open('world')}
          select_mob={open('mob')}
        />
      )
    case 'item':
      return (
        <ItemInspection
          entry={entry}
          props={props}
          close={close}
          open={open}
          render_item={render_item}
          item={supplied_item}
        />
      )
  }
}

type InspectionWindowProps = Readonly<{
  item?: SeedItem
  entry: Inspection
  render_item?: (id: string) => ReactNode
  props: Pick<ItemDetailProps, 'labels' | 'craft_session' | 'select_mob' | 'select_world'>
  close: () => void
  open: (kind: Inspection['kind']) => (id: string) => void
}>

const ItemInspection = ({ entry, props, close, open, render_item, item: supplied_item }: InspectionWindowProps) => {
  const text = useText()
  const item = supplied_item ?? encyclopedia_catalog.item(entry.id)?.item
  if (!item) return null
  return (
    <InspectionContext.Provider value={open}>
      <FloatingWindow identity={identity(entry)} close={close} label={item.name}>
        <GameWindow
          draggable
          title={item.name}
          close={close}
          close_label={text('wallet_close')}
          className="aui-inspection aui-inspection--item"
        >
          {render_item ? (
            render_item(entry.id)
          ) : (
            <ItemDetailView
              {...item}
              damages={item.damages ?? []}
              labels={{
                ...props.labels,
                level_short: text('encyclopedia_page.level_short', { level: item.level }),
              }}
              craft_session={props.craft_session}
              select_mob={open('mob')}
              select_world={open('world')}
            />
          )}
        </GameWindow>
      </FloatingWindow>
    </InspectionContext.Provider>
  )
}
