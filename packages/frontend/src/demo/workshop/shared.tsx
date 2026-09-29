// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, type ItemView, type WorkspaceHeader } from '@aresrpg/ui'
import { useState, useMemo, useContext, createContext, type ReactNode } from 'react'

import { ItemCraftSessionContext } from '../../components/ItemCrafting.tsx'
import { adventure_character } from '../../adventure/character.ts'
import { adventure_character_row } from '../../adventure/projection.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { character_icon, item_icon } from '../../content/assets.ts'
import { content_catalog, type SeedItem } from '../../content/catalog.ts'

export const WorkshopCloseContext = createContext<(() => void) | undefined>(undefined)

export const WorkshopSurface = ({
  title,
  icon,
  copy,
  children,
  on_close,
}: Readonly<{
  title: string
  icon?: ReactNode
  copy: AppCopy
  on_close?: () => void
  children: (header: WorkspaceHeader) => ReactNode
}>) => {
  const close_host = useContext(WorkshopCloseContext)
  const craft_session = useMemo(
    () => ({ character: adventure_character_row(adventure_character()), inventory: [] }),
    []
  )
  const [open, set_open] = useState(true)
  return (
    <ItemCraftSessionContext.Provider value={craft_session}>
      {!open && <Button onClick={() => set_open(true)}>{title}</Button>}
      {open &&
        children({
          title,
          icon,
          close: () => {
            set_open(false)
            ;(on_close ?? close_host)?.()
          },
          close_label: copy.wallet_close,
        })}
    </ItemCraftSessionContext.Provider>
  )
}

export const item_view = (item: Readonly<SeedItem>, quantity?: number): ItemView => ({
  id: item.item_type,
  label: item.name,
  image: item_icon(item.item_type) ?? undefined,
  quantity,
})
export const preview_items = (category: string, count = 12): readonly ItemView[] =>
  content_catalog.items
    .filter((item) => item.category === category)
    .slice(0, count)
    .map((item) => item_view(item))

type PreviewPerson = Readonly<{
  id: string
  name: string
  detail: string
  portrait?: string
  status?: string
  online?: boolean
  health?: number
}>
export const preview_people: readonly PreviewPerson[] = [
  {
    id: 'senshi',
    name: 'Senshi',
    detail: 'Senshi · 198',
    portrait: character_icon('senshi', 'male') ?? undefined,
    online: true,
    health: 100,
  },
  {
    id: 'rin',
    name: 'Rin',
    detail: 'Rojin · 162',
    portrait: character_icon('rojin', 'female') ?? undefined,
    online: true,
    health: 86,
  },
  {
    id: 'kaori',
    name: 'Kaori',
    detail: 'Shugo · 155',
    portrait: character_icon('shugo', 'female') ?? undefined,
    online: true,
    health: 74,
  },
  {
    id: 'taro',
    name: 'Taro',
    detail: 'Tomoda · 140',
    portrait: character_icon('tomoda', 'male') ?? undefined,
    online: false,
    health: 100,
  },
  {
    id: 'mei',
    name: 'Mei',
    detail: 'Tokei · 128',
    portrait: character_icon('tokei', 'female') ?? undefined,
    online: false,
    health: 92,
  },
  {
    id: 'aki',
    name: 'Aki',
    detail: 'Yajin · 116',
    portrait: character_icon('yajin', 'male') ?? undefined,
    online: true,
    health: 64,
  },
]
