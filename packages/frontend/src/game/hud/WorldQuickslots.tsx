// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mastery_reminder_visible } from '../../mastery/model.ts'
import type { CSSProperties } from 'react'
import { CarvedIcon, IconButton } from '@aresrpg/ui'

import { copy_text } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { CHARACTER_TABS } from './CharacterWindow.tsx'
import { pages, type Page } from '../../modules/navigation.ts'
import { HUD_PAGE_META } from './hud_pages.ts'

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
      key: tab === 'equipment' ? 'E' : '',
    })),
    {
      dialog: 'world_map',
      icon: <CarvedIcon name="map" />,
      label: copy.world_hud.world_map,
      key: 'M',
    },
  ] as const
  const destinations = pages.filter(
    (page): page is Exclude<Page, 'world'> => !['world', 'characters', 'settings', 'admin', 'kolizeum'].includes(page)
  )
  const open_page = (page: Exclude<Page, 'world'>) => {
    dispatch_app({ type: 'page/open', page })
  }
  const columns = {
    '--hud-columns': Math.ceil((slots.length + destinations.length) / 2),
    '--hud-mobile-columns': Math.ceil((slots.length + destinations.length) / 2),
  } as CSSProperties
  return (
    <div className="aui-hud-shortcut-row" style={columns}>
      {slots.map((slot) => (
        <IconButton
          key={slot.dialog}
          title=""
          label={slot.label}
          icon={slot.icon}
          hotkey={slot.key}
          aria-pressed={dialog === slot.dialog}
          onClick={() => dispatch_app({ type: 'dialog/open', dialog: dialog === slot.dialog ? null : slot.dialog })}
        />
      ))}
      {destinations.map((page) => (
        <IconButton
          key={page}
          title=""
          label={copy[HUD_PAGE_META[page].label]}
          icon={<CarvedIcon name={HUD_PAGE_META[page].icon} />}
          data-hud-page={page}
          data-notification={(page === 'mastery' && mastery_notification) || undefined}
          onClick={() => open_page(page)}
        />
      ))}
    </div>
  )
}
