// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'
import type { CaptionTarget } from '@aresrpg/engine'

import { useNametags } from '../game/core/nametag_feed.ts'
import { speech_text } from '../modules/chat.ts'
import { useAppStore } from '../store.ts'

import { player_caption } from './player_caption.ts'

/** Labels receive descriptors, never per-frame DOM transforms. Their owning scene supplies each target. */
export const PlayerNametag = () => {
  const { others, self } = useNametags()
  const owner = useAppStore((state) => state.session.wallet?.address ?? null)
  const admin_label = useAppStore((state) => state.copy?.admin ?? '')
  const veteran_label = useAppStore((state) => state.copy?.ui.nameplate_veteran ?? '')
  const players = useAppStore((state) => state.world.players)
  const speech = useAppStore((state) => state.chat.speech)
  const characters = useAppStore((state) => state.session.characters)
  const selected_id = useAppStore((state) => state.session.selected_character_id)
  const targets = useRef<readonly CaptionTarget[]>([])
  useEffect(() => {
    const owned = Object.fromEntries(
      characters.map(({ id, name, equipment }) => [
        id,
        {
          name,
          owner,
          title: equipment.find(({ slot }) => slot === 'title')?.item_type ?? null,
        },
      ])
    )
    // eslint-disable-next-line functional/immutable-data -- React effect cleanup retains the current scene-owned targets.
    targets.current = [...Object.values(others), ...(self ? [self] : [])]
    Object.entries(others).forEach(([id, target]) => {
      const row = owned[id] ?? players[id]
      target.set(row ? player_caption({ ...row, admin_label, veteran_label, speech: speech_text(speech[id]) }) : null)
    })
    const selected = selected_id ? owned[selected_id] : null
    self?.set(
      selected
        ? player_caption({ ...selected, admin_label, veteran_label, speech: speech_text(speech[selected_id!]) })
        : null
    )
  }, [others, self, players, speech, characters, selected_id, owner, admin_label, veteran_label])
  useEffect(() => () => targets.current.forEach((target) => target.set(null)), [])
  return null
}
