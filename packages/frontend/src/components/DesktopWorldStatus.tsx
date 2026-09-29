// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppCopy } from '../i18n/copy.ts'
import { JourneyTracker } from '../journey/JourneyPanel.tsx'
import { selected_dungeon_run } from '../modules/dungeon.ts'
import { selected_party } from '../modules/party.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { CharacterHud } from '../game/hud/CharacterHud.tsx'

import { social_hud_visible } from './app_layout.ts'
import { WorldStatus } from './WorldStatus.tsx'
import { FriendsPanel } from './FriendsPanel.tsx'
import { CharacterTabs } from './CharacterTabs.tsx'

export const DesktopWorldStatus = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const navigation = useAppStore((state) => state.navigation)
  const fight_active = useAppStore((state) => state.fight.mounted)
  const dungeon_active = useAppStore((state) => selected_dungeon_run(state) !== null)
  const party_available = useAppStore((state) => selected_party(state) !== null)
  const in_app = !!session.wallet
  const social_hud_open = social_hud_visible(navigation.page, fight_active, dungeon_active)
  return (
    <>
      <CharacterHud copy={copy} enabled={in_app} leave={() => dispatch_app({ type: 'auth/disconnected' })} />
      <WorldStatus copy={copy} party_available={party_available} active={navigation.page === 'world'}>
        {in_app && (
          <CharacterTabs
            characters={session.characters}
            copy={copy}
            selected_character_id={session.selected_character_id}
            select_character={(character_id) => dispatch_app({ type: 'character/select', character_id })}
            create_character={() => dispatch_app({ type: 'dialog/open', dialog: 'character_create' })}
          />
        )}
        {in_app && social_hud_open && <FriendsPanel copy={copy} />}
        <JourneyTracker copy={copy} />
      </WorldStatus>
    </>
  )
}
