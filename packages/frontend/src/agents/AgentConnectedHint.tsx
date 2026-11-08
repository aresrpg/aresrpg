// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '@aresrpg/ui'
import { Check, MousePointer2, X } from 'lucide-react'

import { CharacterTab } from '../components/CharacterTab.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

export const AgentConnectedHint = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const characters = useAppStore((app) => app.session.characters)
  const selected = useAppStore((app) => app.session.selected_character_id)
  const character = characters.find(({ id }) => id === selected) ?? characters[0]
  useEffect(() => {
    const dismiss = (event: Readonly<KeyboardEvent>) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [close])
  return createPortal(
    <aside
      className="agent-connected-hint agent-setup"
      data-agent-connected-hint=""
      aria-label={copy.ui.agent_connected}
    >
      <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={close} />
      <h2>{copy.ui.agent_connected}</h2>
      {character ? (
        <>
          <div className="agent-hint-demo" aria-hidden="true" inert>
            <div className="agent-hint-tab character-tabs">
              <CharacterTab character={character} selected tabIndex={-1} />
            </div>
            <MousePointer2 className="agent-hint-pointer" size={22} />
            <div className="agent-hint-menu">
              <Check size={16} />
              {copy.ui.agent_send}
            </div>
          </div>
          <p>{copy.ui.agent_hint_desktop}</p>
        </>
      ) : (
        <p>{copy.ui.agent_hint_create}</p>
      )}
    </aside>,
    document.body
  )
}
