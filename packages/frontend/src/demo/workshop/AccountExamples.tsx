// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { LanguageView } from '@aresrpg/ui'
import { Languages, Settings } from 'lucide-react'

import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { LOCALES } from '../../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { FpsPanel } from '../../components/FpsPanel.tsx'
import { WalletCard } from '../../components/WalletCard.tsx'
import { GamePageWindow } from '../../components/GamePageWindow.tsx'
import { WorldAccount } from '../../game/hud/WorldAccount.tsx'
import SettingsPage from '../../settings/SettingsPage.tsx'
import { CharacterTabs } from '../../components/CharacterTabs.tsx'
import { adventure_character, adventure_companion } from '../../adventure/character.ts'
import { adventure_character_row } from '../../adventure/projection.ts'

import { WorkshopSurface } from './shared.tsx'

export const LanguageExample = ({ copy, on_close }: Readonly<{ copy: AppCopy; on_close?: () => void }>) => {
  const locale = useAppStore((state) => state.locale)
  return (
    <WorkshopSurface
      copy={copy}
      title={copy_text(copy.kares_page)('language')}
      icon={<Languages />}
      on_close={on_close}
    >
      {(header) => (
        <LanguageView
          header={header}
          value={locale}
          languages={LOCALES.map((row) => ({ value: row.code, label: row.native, badge: row.badge }))}
          choose={(value) => {
            const next = LOCALES.find((row) => row.code === value)
            if (next) dispatch_app({ type: 'locale/changed', locale: next.code })
          }}
        />
      )}
    </WorkshopSurface>
  )
}

export const SettingsExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const saved = useAppStore((state) => state.settings)
  const [settings, update_settings] = useState(saved)
  return (
    <WorkshopSurface copy={copy} title={copy.settings} icon={<Settings />}>
      {(header) => <SettingsPage copy={copy} settings={settings} update_settings={update_settings} header={header} />}
    </WorkshopSurface>
  )
}
export const WalletExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  return (
    <div className="world-account">
      <WalletCard copy={copy} session={session} disconnect={() => dispatch_app({ type: 'auth/disconnected' })} />
    </div>
  )
}
export const AccountToolsExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [quality, set_quality] = useState<'low' | 'medium' | 'high'>('high')
  return (
    <div className="aui-account-tools">
      <FpsPanel
        active
        copy={copy}
        quality={quality}
        change_quality={set_quality}

        fight_access={null}
        party_available={false}
      />
      <WorldAccount copy={copy} />
      <GamePageWindow copy={copy} />
    </div>
  )
}

export const CharacterSwitcherExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const characters = [adventure_character_row(adventure_character()), adventure_character_row(adventure_companion())]
  const [selected, select] = useState(characters[0]!.id)
  return (
    <CharacterTabs
      copy={copy}
      characters={characters}
      selected_character_id={selected}
      select_character={select}
      create_character={null}
    />
  )
}
