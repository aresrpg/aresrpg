// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { useAppStore } from '../../store.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { PartyFrame, PartyInviteCard } from '../../components/PartyFrame.tsx'
import { AutomationPanel } from '../../components/AutomationPanel.tsx'
import { Minimap } from './Minimap.tsx'
import { MultiplayerHud } from './MultiplayerHud.tsx'
import { WorldAccount } from './WorldAccount.tsx'

export const WorldSocialDock = ({
  copy,
  terrain,
  children,
}: Readonly<{ copy: AppCopy; terrain?: unknown; children?: ReactNode }>) => {
  const fighting = useAppStore((state) => state.fight.mounted)
  return (
    <aside className="world-social-dock" data-fighting={fighting || undefined}>
      <WorldAccount copy={copy} />
      {!fighting && (
        <>
          <Minimap copy={copy} terrain={terrain} />
          <MultiplayerHud copy={copy} />
        </>
      )}
      <div className="world-party-tools">
        {children === undefined ? (
          <>
            <PartyFrame copy={copy} />
            <PartyInviteCard copy={copy} />
            <AutomationPanel copy={copy} enabled={!fighting} />
          </>
        ) : (
          children
        )}
      </div>
    </aside>
  )
}
