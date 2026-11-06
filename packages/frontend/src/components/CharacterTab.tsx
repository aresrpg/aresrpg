// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ComponentProps } from 'react'
import { NavigationRow } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { Bot } from 'lucide-react'

import { character_icon } from '../content/assets.ts'

import './character_tabs.css'

/** Agent ornament is presentation only. Live callers must first have a verified custody projection. */
export const CharacterTab = ({
  character,
  agent,
  ...props
}: Readonly<{
  character: CharacterRow
  agent?: Readonly<{ status: 'agent' | 'recall'; label: string }>
}> &
  Omit<ComponentProps<typeof NavigationRow>, 'children'>) => (
  <NavigationRow
    {...props}
    className="character-tab"
    data-character-tab={character.id}
    data-delegated={agent?.status}
    aria-description={agent?.label}
  >
    <span className="character-tab-avatar">
      <img
        className="character-tab-portrait"
        src={character_icon(character.classe, character.sex, character) ?? undefined}
        alt=""
      />
      {agent && <Bot className="character-tab-bot" size={12} aria-hidden="true" />}
    </span>
    <span className="character-tab-name">{character.name}</span>
    <small className="character-tab-level">{character.level}</small>
  </NavigationRow>
)
