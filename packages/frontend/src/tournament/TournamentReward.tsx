// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { rolled_item_types } from '../modules/claims.ts'
import { useAppStore } from '../store.ts'
import { copy_text } from '../i18n/copy.ts'
import { EncyclopediaItemIcon } from '../encyclopedia/EncyclopediaItemIcon.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { ItemDetailContext } from '../components/ItemDetailContext.ts'

import { TournamentDialog } from './TournamentControls.tsx'

export const tournament_item = (template: string) => {
  const type = rolled_item_types().get(template)
  return type ? (encyclopedia_catalog.item(type)?.item ?? null) : null
}

export const TournamentReward = ({ template, amount }: Readonly<{ template: string; amount: number }>) => {
  const copy = useAppStore((state) => state.copy)!
  const t = copy_text(copy.tournament_page)
  const encyclopedia = encyclopedia_text(copy)
  const item = tournament_item(template)
  const [opened, set_opened] = useState(false)
  if (!item)
    return (
      <Button className="tourney-reward" disabled title={template}>
        {amount} × {t('unknown_item')}
      </Button>
    )
  return (
    <>
      <Button
        className="tourney-reward"

        onClick={() => set_opened(true)}
        title={item.name}
      >
        {<EncyclopediaItemIcon item_type={item.item_type} label={item.name} />}
        <span>
          {amount} × {item.name}
        </span>
      </Button>
      {opened && (
        <TournamentDialog title={item.name} close={() => set_opened(false)} t={t}>
          <ItemDetailContext.Provider value="summary">
            <ItemDetailView
              {...item}
              damages={item.damages ?? []}
              labels={{
                characteristics: encyclopedia('characteristics'),
                damages: encyclopedia('damages'),
                level_short: encyclopedia('level_short', { level: item.level }),
                range_to: encyclopedia('range_to'),
              }}
            />
          </ItemDetailContext.Provider>
          <p className="tourney-note">{t('rolled_items_notice')}</p>
        </TournamentDialog>
      )}
    </>
  )
}
