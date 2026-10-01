// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

import adventure_content from '../../../../seed/content/adventure.json'
import { mob_icon, character_icon, item_icon } from '../content/assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { initial_journey_state } from '../journey/model.ts'
import { JourneySourceContext, type JourneySource } from '../journey/source.tsx'
import { dispatch_app, useAppStore } from '../store.ts'

import { ADVENTURE_QUESTS, adventure_completed_quests } from './quest.ts'
import { adventure_mob, adventure_item } from './content.ts'

const journal = (open: boolean) => dispatch_app({ type: 'adventure/journal', open })

/** Only local data/actions differ. The production tracker, panel and modal own every pixel. */
export const AdventureJourneySource = ({ copy, children }: Readonly<{ copy: AppCopy; children: ReactNode }>) => {
  const adventure = useAppStore((state) => state.adventure)
  const quests = ADVENTURE_QUESTS.map((id) => ({
    id,
    chapter: 'adventure',
    item: adventure_content.quest_art[id],
    kind: 'tutorial' as const,
  }))
  const text = copy_text({
    ...copy.journey,
    ...copy.adventure,
    equip_objective: copy_text(copy.adventure)('equip_objective', {
      confirm: copy_text(copy.characters_page)('accept'),
    }),
    equip_body: copy_text(copy.adventure)('equip_body', { confirm: copy_text(copy.characters_page)('accept') }),
    title: copy.adventure.journal!,
    eyebrow: copy.adventure.chapter!,
    chapter_adventure: copy.adventure.chapter!,
  })
  const source: JourneySource = {
    state: {
      ...initial_journey_state('adventure'),
      ready: true,
      completed: adventure_completed_quests(adventure),
      journal_open: adventure.journal_open,
      collapsed: adventure.journal_collapsed,
    },
    quests,
    text,
    available: adventure.phase === 'explore',
    icon: (id) =>
      id === adventure_content.companion.id
        ? character_icon(adventure_content.companion.classe, 'male')
        : adventure_item(id)
          ? item_icon(id)
          : mob_icon(id),
    name: (item) =>
      item === adventure_content.companion.id
        ? adventure_content.companion.name
        : (adventure_item(item)?.name ?? adventure_mob(item)?.name ?? ''),
    journal,
    collapse: (collapsed) => dispatch_app({ type: 'adventure/journal_collapsed', collapsed }),
    acknowledge: () => journal(false),
    activate: (quest) => {
      journal(false)
      if (quest.id === 'equip') dispatch_app({ type: 'dialog/open', dialog: 'character_equipment' })
    },
  }
  return <JourneySourceContext value={source}>{children}</JourneySourceContext>
}
