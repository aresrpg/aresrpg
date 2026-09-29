// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { GameWindow, FloatingWindow } from '@aresrpg/ui'
import { useState } from 'react'

import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { CatalogueMobDetails } from '../encyclopedia/CatalogueMobDetails.tsx'
import { WorldsTab } from '../encyclopedia/WorldsTab.tsx'
import { useText } from '../i18n/useText.ts'

type InspectionProps = Readonly<{
  id: string | null
  close: () => void
  select_item: (id: string) => void
  select_world: (id: string) => void
}>
export const MobInspection = ({ id, close, select_item, select_world }: InspectionProps) => {
  const text = useText()
  const mob = id ? encyclopedia_catalog.mob(id)?.mob : null
  if (!mob) return null
  return (
    <FloatingWindow identity={`mob:${id}`} close={close} label={mob.name}>
      <GameWindow
        draggable
        title={mob.name}
        close={close}
        close_label={text('wallet_close')}
        className="aui-catalogue-details"
      >
        <CatalogueMobDetails
          key={id}
          mob_type={mob.mob_type}
          select_item={select_item}
          select_world={select_world}
          text={(key, values) => text(`encyclopedia_page.${key}`, values)}
        />
      </GameWindow>
    </FloatingWindow>
  )
}
export const WorldInspection = ({
  id,
  close,
  select_item,
  select_world,
  select_mob,
}: InspectionProps & Readonly<{ select_mob: (id: string) => void }>) => {
  const text = useText()
  const [place, set_place] = useState<string | null>(null)
  if (!id) return null
  return (
    <FloatingWindow identity={`world:${id}`} close={close} label={titleize(id)}>
      <GameWindow
        draggable
        title={titleize(id)}
        close={close}
        close_label={text('wallet_close')}
        className="aui-world-inspection"
      >
        <WorldsTab
          selected_id={id}
          selected_place={place}
          select_place={(_, place_id) => set_place(place_id)}
          select_world={select_world}
          select_item={select_item}
          select_mob={select_mob}
          text={(key, values) => text(`encyclopedia_page.${key}`, values)}
        />
      </GameWindow>
    </FloatingWindow>
  )
}
