// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { GameWindow, NativeModal } from '@aresrpg/ui'

import { CatalogueItemDetails } from '../../encyclopedia/CatalogueItemDetails.tsx'
import { stat_name, type AppCopy } from '../../i18n/copy.ts'
import { content_catalog } from '../../content/catalog.ts'
import { encyclopedia_text } from '../../encyclopedia/copy.ts'
import { MobDetailsDialog } from '../../game/hud/MobDetailsDialog.tsx'

import { WorldMapExample } from './MapExamples.tsx'
const ItemSheet = ({ id, copy, close }: Readonly<{ id: string; copy: AppCopy; close: () => void }>) => {
  const [selected, select] = useState(id)
  const [mob_id, select_mob] = useState<string | null>(null)
  const [world, select_world] = useState<string | null>(null)
  const item = content_catalog.item(selected)?.item
  const mob = mob_id ? content_catalog.mob(mob_id)?.mob : null
  if (!item) return null
  return (
    <>
      <NativeModal close={close} label={item.name} className="aui-modal-scrim">
        <GameWindow
          title={item.name}
          close={close}
          close_label={copy.wallet_close}
          draggable
          className="aui-inspection aui-inspection--item"
        >
          <CatalogueItemDetails
            item_type={selected}
            select_item={select}
            select_mob={select_mob}
            select_world={select_world}
            text={encyclopedia_text(copy)}
            stat_name={(stat) => stat_name(copy, stat)}
          />
        </GameWindow>
      </NativeModal>
      {mob && <MobDetailsDialog mob={mob} copy={copy} close={() => select_mob(null)} />}{' '}
      {world && <WorldMapExample copy={copy} initial_world={world} on_close={() => select_world(null)} />}
    </>
  )
}
export const WorkshopItemDetails = ({
  id,
  copy,
  close,
}: Readonly<{ id: string | null; copy: AppCopy; close: () => void }>) =>
  id ? <ItemSheet key={id} id={id} copy={copy} close={close} /> : null
