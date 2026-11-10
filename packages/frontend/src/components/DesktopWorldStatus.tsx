// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AgentSpectator } from '../agents/AgentSpectator.tsx'
import { AgentSetupButton } from '../agents/AgentSetup.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { JourneyTracker } from '../journey/JourneyPanel.tsx'
import { selected_dungeon_run } from '../modules/dungeon.ts'
import { selected_party } from '../modules/party.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { WorldSocialDock } from '../game/hud/WorldSocialDock.tsx'
import { CharacterHud } from '../game/hud/CharacterHud.tsx'

import { social_hud_visible } from './app_layout.ts'
import { WorldStatus } from './WorldStatus.tsx'
import { PlayerCharacterTabs } from './PlayerCharacterTabs.tsx'

export const DesktopWorldStatus = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const navigation = useAppStore((state) => state.navigation)
  const fight_active = useAppStore((state) => state.fight.mounted)
  const dungeon_active = useAppStore((state) => selected_dungeon_run(state) !== null)
  const party_available = useAppStore((state) => selected_party(state) !== null)
  const in_app = !!session.wallet
  const social_hud_open = social_hud_visible(navigation.page, fight_active, dungeon_active)
  if (session.agent_view.request) return <AgentSpectator copy={copy} />
  return (
    <>
      {in_app && (!dungeon_active || fight_active) && <WorldSocialDock copy={copy} />}
      <CharacterHud copy={copy} enabled={in_app} leave={() => dispatch_app({ type: 'auth/disconnected' })} />
      <WorldStatus copy={copy} party_available={party_available} active={navigation.page === 'world'}>
        {in_app && (
          <PlayerCharacterTabs
            copy={copy}
            create_character={() => dispatch_app({ type: 'dialog/open', dialog: 'character_create' })}
          />
        )}
        {in_app && social_hud_open && (
          <AgentSetupButton copy={copy} label={copy.ui.agent_connect_your} class_name="min-h-11 pointer-events-auto" />
        )}
        <JourneyTracker copy={copy} />
      </WorldStatus>
    </>
  )
}
