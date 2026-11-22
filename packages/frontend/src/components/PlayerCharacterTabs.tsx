// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { watch_agent_character } from '../agents/watch_character.ts'
import { useCharacterRecall } from '../agents/useCharacterRecall.tsx'

import { CharacterTabs } from './CharacterTabs.tsx'

/** Live custody augments display only; the composition lab's tabs keep their own supplied roster. */
export const PlayerCharacterTabs = ({
  copy,
  create_character,
}: Readonly<{
  copy: AppCopy
  create_character: (() => void) | null
}>) => {
  const characters = useAppStore(({ session }) => session.characters)
  const selected_character_id = useAppStore(({ session }) => session.selected_character_id)
  const { agent, recall, busy, funding } = useCharacterRecall(copy)
  return (
    <>
      <CharacterTabs
        characters={characters}
        agent_characters={agent.characters}
        select_agent={(id) => watch_agent_character(id, copy)}
        recall_agent={recall}
        agent_busy={busy}
        copy={copy}
        create_character={create_character}
        selected_character_id={selected_character_id}
        select_character={(character_id) => dispatch_app({ type: 'character/select', character_id })}
      />
      {funding}
    </>
  )
}
