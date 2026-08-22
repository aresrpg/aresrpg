// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
// Player nametags — the house nametag (NametagCard.tsx) carrying a name and, beneath it, an
// equipped title. The ENGINE owns every element's position (CSS2D crowns riding the frame's own
// camera pass); this component only portals card content into them. Self renders while the
// cursor hovers our body.

import { createPortal } from 'react-dom'

import { content_catalog } from '../content/catalog.ts'
import { useNametags } from '../game/core/nametag_feed.ts'
import { useAppStore } from '../store.ts'

import { NametagCard, type NametagLine } from './NametagCard.tsx'

/** An equipped title item is the ONLY subtitle source — no invented fallbacks (SSOT). */
const title_line = (title: string | null): readonly NametagLine[] => {
  const name = title ? (content_catalog.item(title)?.item.name ?? null) : null
  return name ? [{ key: 'title', text: name }] : []
}

export const PlayerNametag = () => {
  const { others, self } = useNametags()
  const players = useAppStore((state) => state.world.players)
  const selected = useAppStore(
    (state) => state.session.characters.find(({ id }) => id === state.session.selected_character_id) ?? null
  )

  return (
    <>
      {Object.entries(others).map(([character_id, element]) => {
        const row = players[character_id]
        if (!row) return null
        return createPortal(<NametagCard lines={title_line(row.title)} name={row.name} />, element, character_id)
      })}
      {self !== null && selected !== null
        ? createPortal(
            <NametagCard
              lines={title_line(selected.equipment.find(({ slot }) => slot === 'title')?.name ?? null)}
              name={selected.name}
            />,
            self,
            'self'
          )
        : null}
    </>
  )
}
