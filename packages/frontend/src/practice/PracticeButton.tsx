// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Swords } from 'lucide-react'
import { Button } from '@aresrpg/ui'

import type { CopyText } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { open_practice } from './entry.ts'

export const PracticeButton = ({ open, t }: Readonly<{ open: boolean; t: CopyText }>) => {
  const character = useAppStore(({ session }) =>
    session.characters.find(({ id }) => id === session.selected_character_id)
  )
  const mounted = useAppStore(({ fight }) => fight.mounted)
  if (!open) return null
  return (
    <Button
      className="tourney-practice-button"
      title={t('practice_hint')}
      disabled={!character || !!character.active_fight || mounted}
      onClick={() => {
        if (character) open_practice(character)
      }}
    >
      <Swords size={15} aria-hidden="true" />
      {t('practice_free')}
    </Button>
  )
}
