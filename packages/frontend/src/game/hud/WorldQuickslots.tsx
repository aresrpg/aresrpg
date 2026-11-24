// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mastery_reminder_visible } from '../../mastery/model.ts'
import { CarvedIcon, IconButton } from '@aresrpg/ui'

import { copy_text } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { CHARACTER_TABS } from './CharacterWindow.tsx'
import { HUD_PAGE_META } from './hud_pages.ts'
import { CHARACTER_SHORTCUTS } from '../core/hud_input.ts'
import './hud_controls.css'

export const WorldQuickslots = () => {
  const copy = useAppStore((state) => state.copy)
  const mastery_notification = useAppStore((state) =>
    mastery_reminder_visible(state.session.characters.length, state.mastery.row, state.session.current_epoch)
  )
  const dialog = useAppStore((state) => state.navigation.dialog)
  if (!copy) return null
  const text = copy_text(copy.characters_page)
  const slots = [
    ...CHARACTER_TABS.map(({ tab, icon }) => ({
      dialog: `character_${tab}` as const,
      icon: <CarvedIcon name={icon} />,
      label: text(`tab_${tab}`),
      key: CHARACTER_SHORTCUTS.find((shortcut) => shortcut.tab === tab)?.key ?? '',
    })),
    {
      dialog: 'world_map',
      icon: <CarvedIcon name="map" />,
      label: copy.world_hud.world_map,
      key: 'M',
    },
  ] as const
  const mastery = HUD_PAGE_META.mastery
  return (
    <div className="aui-hud-shortcut-row">
      {slots.map((slot) => (
        <IconButton
          key={slot.dialog}
          title=""
          label={slot.label}
          icon={slot.icon}
          hotkey={slot.key}
          aria-keyshortcuts={slot.key || undefined}
          aria-pressed={dialog === slot.dialog}
          onClick={() => dispatch_app({ type: 'dialog/open', dialog: dialog === slot.dialog ? null : slot.dialog })}
        />
      ))}
      <IconButton
        title=""
        label={copy[mastery.label]}
        icon={<CarvedIcon name={mastery.icon} />}
        data-notification={mastery_notification || undefined}
        onClick={() => dispatch_app({ type: 'page/open', page: 'mastery' })}
      />
    </div>
  )
}
