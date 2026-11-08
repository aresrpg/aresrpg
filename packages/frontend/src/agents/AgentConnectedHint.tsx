// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import { Check, MousePointer2 } from 'lucide-react'

import { SendModalShell } from '../components/SendModalShell.tsx'
import { CharacterTab } from '../components/CharacterTab.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

export const AgentConnectedHint = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const characters = useAppStore((app) => app.session.characters)
  const selected = useAppStore((app) => app.session.selected_character_id)
  const character = characters.find(({ id }) => id === selected) ?? characters[0]
  return (
    <SendModalShell
      title={copy.ui.agent_connected}
      close={close}
      close_label={copy.wallet_close}
      locked={false}
      tone="success"
    >
      <section className="agent-connected-hint" data-agent-connected-hint="">
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
        <Button className="agent-connect" tone="primary" onClick={close}>
          {copy.wallet_close}
        </Button>
      </section>
    </SendModalShell>
  )
}
