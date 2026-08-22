// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The right-click menu on a nearby player — the four social doors (owner 2026-08-20: all four
// visible, no header, one row per option). Group invite, trade and whisper render disabled
// until their phases wire them; the duel is live. The DUEL row belongs to the menu opened on a
// BODY only (owner 2026-08-21): a challenge needs the two characters standing together, and a
// name clicked in the chat log says nothing about where its owner is.

import { useEffect, type PointerEvent as ReactPointerEvent } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { HUD_PANEL_CLASS } from './ui/HudPanel.tsx'

const ROW_CLASS =
  'block w-full px-3 py-2 text-left uppercase tracking-[0.15em] enabled:hover:bg-white/10 enabled:hover:text-[#7fd6d0] disabled:opacity-35'

export const PlayerContextMenu = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const menu = useAppStore((state) => state.world.player_menu)
  const target = useAppStore((state) => (menu ? state.world.players[menu.character_id] : undefined))
  const close = () => dispatch_app({ type: 'world/player_menu', menu: null })

  useEffect(() => {
    if (!menu) return undefined
    const dismiss = (event: Readonly<KeyboardEvent | MouseEvent>): void => {
      if (event instanceof KeyboardEvent && event.code !== 'Escape') return
      close()
    }
    globalThis.addEventListener('pointerdown', dismiss)
    globalThis.addEventListener('keydown', dismiss)
    return () => {
      globalThis.removeEventListener('pointerdown', dismiss)
      globalThis.removeEventListener('keydown', dismiss)
    }
  }, [menu])

  if (!menu || !target) return null
  const duel = (): void => {
    dispatch_app({ type: 'duel/challenged', character_id: target.character_id, name: target.name })
    close()
  }
  return (
    <div
      className={`${HUD_PANEL_CLASS} pointer-events-auto fixed z-[140] min-w-[168px] divide-y divide-white/10 text-[11px]`}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event: Readonly<ReactPointerEvent<HTMLDivElement>>) => event.stopPropagation()}
      role="menu"
    >
      <button className={ROW_CLASS} disabled role="menuitem" type="button">
        {copy.world_hud.menu_group}
      </button>
      <button className={ROW_CLASS} disabled role="menuitem" type="button">
        {copy.world_hud.menu_trade}
      </button>
      {menu.source === 'body' && (
        <button className={ROW_CLASS} onClick={duel} role="menuitem" type="button">
          {copy.world_hud.menu_duel}
        </button>
      )}
      <button className={ROW_CLASS} disabled role="menuitem" type="button">
        {copy.world_hud.menu_message}
      </button>
    </div>
  )
}
