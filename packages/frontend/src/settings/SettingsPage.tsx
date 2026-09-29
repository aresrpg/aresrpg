// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button, SettingsView, type WorkspaceHeader } from '@aresrpg/ui'
import { Globe, LogOut, Music2, Settings, SlidersHorizontal, Swords } from 'lucide-react'

import { LanguageCard, DiscordCard, TelegramCard } from '../components/AccountControls.tsx'
import type { GameSettings } from '../game/core/settings.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { SuinsSettings } from './SuinsSettings.tsx'
import { AudioSettings, GameplaySettings, GraphicsSettings } from './SettingsFields.tsx'

export default function SettingsPage({
  copy,
  settings,
  header,
  update_settings,
}: Readonly<{
  copy: AppCopy
  settings: GameSettings
  header?: WorkspaceHeader
  update_settings?: (settings: GameSettings) => void
}>) {
  const [section, choose] = useState('graphics')
  const locale = useAppStore((state) => state.locale)
  const update = update_settings ?? ((settings: GameSettings) => dispatch_app({ type: 'settings/changed', settings }))
  const change = (patch: Partial<GameSettings>) => update({ ...settings, ...patch })
  const fields = {
    graphics: <GraphicsSettings copy={copy} settings={settings} change={change} />,
    audio: <AudioSettings copy={copy} settings={settings} change={change} />,
    gameplay: <GameplaySettings copy={copy} settings={settings} change={change} />,
    account: <SuinsSettings copy={copy} />,
  }
  return (
    <SettingsView
      header={
        header ?? {
          title: copy.settings,
          icon: <Settings />,
          close: () => dispatch_app({ type: 'page/open', page: 'world' }),
          close_label: copy.wallet_close,
        }
      }
      selected={section}
      select={choose}
      sections={[
        { id: 'graphics', label: copy.quality, icon: <SlidersHorizontal /> },
        { id: 'audio', label: copy.ui.design_volume, icon: <Music2 /> },
        { id: 'gameplay', label: copy.characters, icon: <Swords /> },
        { id: 'account', label: copy.account, icon: <Globe /> },
      ]}
      footer={
        <div className="settings-footer">
          <LanguageCard
            copy={copy}
            locale={locale}
            change_locale={(locale) => dispatch_app({ type: 'locale/changed', locale })}
          />
          <Button tone="danger" onClick={() => dispatch_app({ type: 'dialog/open', dialog: 'leave_game' })}>
            <LogOut size={16} />
            {copy.ui.leave_game_confirm}
          </Button>
          <div className="settings-socials">
            <DiscordCard copy={copy} />
            <TelegramCard copy={copy} />
          </div>
        </div>
      }
    >
      {fields[section as keyof typeof fields]}
    </SettingsView>
  )
}
