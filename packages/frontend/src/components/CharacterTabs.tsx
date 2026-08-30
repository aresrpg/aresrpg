// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MAX_TRACKED_CHARACTERS, type CharacterRow } from '@aresrpg/protocol'
import { Plus } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { is_jobs_pathname, type Page } from '../modules/navigation.ts'
import { owned_party_invite_view } from '../modules/party.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { HUD_PANEL_CLASS } from './ui/HudPanel.tsx'

/** The pages whose content is scoped to ONE owned character — the tab strip only lives there. */
const CHARACTER_PAGES: readonly Page[] = Object.freeze(['world', 'characters', 'kolizeum'])

export const character_tabs_visible = (page: Page): boolean => CHARACTER_PAGES.includes(page)

export const character_tab_invite_enabled = (
  character_id: string,
  invite_view: ReturnType<typeof owned_party_invite_view>
): boolean => invite_view.enabled && invite_view.candidates.some(({ id }) => id === character_id)

export const character_tab_locked = (
  pathname: string,
  craft_character_id: string | null | undefined,
  character_id: string
): boolean => is_jobs_pathname(pathname) && !!craft_character_id && character_id !== craft_character_id

/** The app-wide character selector: one tab per owned character, plus a create tab. Selecting
 *  a tab re-points every character-scoped surface (world embodiment, stats, gear, spells,
 *  jobs) through the one session `character/select` door. */
export const CharacterTabs = ({
  characters,
  copy,
  create_character,
  select_character,
  selected_character_id,
}: Readonly<{
  characters: readonly CharacterRow[]
  copy: AppCopy
  create_character: () => void
  select_character: (character_id: string) => void
  selected_character_id: string | null
}>) => {
  const party_by_character = useAppStore((state) => state.party.party_by_character)
  const parties = useAppStore((state) => state.party.by_id)
  const pending_by_character = useAppStore((state) => state.party.pending_by_character)
  const pathname = useAppStore((state) => state.navigation.pathname)
  const craft_character_id = useAppStore((state) => state.settings.always_craft_from_character_id)
  const [menu, set_menu] = useState<Readonly<{ character_id: string; x: number; y: number }> | null>(null)
  const party_id = selected_character_id ? party_by_character[selected_character_id] : undefined
  const party = party_id ? (parties[party_id] ?? null) : null
  const invite_view = useMemo(
    () => owned_party_invite_view(characters, selected_character_id, party_by_character, party),
    [characters, party, party_by_character, selected_character_id]
  )
  const can_invite = menu ? character_tab_invite_enabled(menu.character_id, invite_view) : false
  const pending = selected_character_id ? pending_by_character[selected_character_id] : null

  useEffect(() => {
    if (!menu) return undefined
    const close = (): void => set_menu(null)
    const keydown = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') close()
    }
    globalThis.addEventListener('pointerdown', close)
    globalThis.addEventListener('keydown', keydown)
    return () => {
      globalThis.removeEventListener('pointerdown', close)
      globalThis.removeEventListener('keydown', keydown)
    }
  }, [menu])

  return (
    <>
      <nav
        aria-label={copy.characters}
        className="pointer-events-auto flex h-[22px] shrink-0 items-stretch overflow-x-auto border border-border bg-surface/95"
        data-character-tabs=""
        data-tutorial-target="character_tabs"
      >
        {characters.map((character) => {
          const active = character.id === selected_character_id
          const locked = character_tab_locked(pathname, craft_character_id, character.id)
          return (
            <button
              aria-pressed={active}
              className={`flex min-w-0 max-w-52 shrink-0 items-center gap-2.5 border-r border-border px-5 transition-colors duration-200 ${
                locked ? 'cursor-not-allowed opacity-35' : 'cursor-pointer'
              } ${
                active
                  ? 'bg-[#c8963c]/8 text-[#e8c07a] shadow-[inset_0_-2px_0_0_#c8963c]'
                  : 'text-[#6b7280] hover:bg-[#c8963c]/5 hover:text-[#d6d1c8]'
              }`}
              data-character-tab={character.id}
              disabled={locked}
              key={character.id}
              onClick={() => select_character(character.id)}
              onContextMenu={(event: Readonly<ReactMouseEvent<HTMLButtonElement>>) => {
                event.preventDefault()
                set_menu({ character_id: character.id, x: event.clientX, y: event.clientY })
              }}
              title={locked ? copy.settings_page.always_craft_from_hint : undefined}
              type="button"
            >
              <span className="truncate text-[10px] tracking-[0.18em] uppercase">{character.name}</span>
              <span className={`text-[8px] tracking-[0.12em] ${active ? 'text-[#c8963c]' : 'text-[#4b5058]'}`}>
                {character.level}
              </span>
            </button>
          )
        })}
        {characters.length < MAX_TRACKED_CHARACTERS && (
          <button
            aria-label={copy.create_character}
            className="grid w-[26px] shrink-0 cursor-pointer place-items-center border-r border-border text-[#6b7280] transition-colors duration-200 hover:bg-[#c8963c]/5 hover:text-[#e8c07a]"
            data-character-tab-create=""
            onClick={create_character}
            title={copy.create_character}
            type="button"
          >
            <Plus aria-hidden="true" size={11} />
          </button>
        )}
      </nav>
      {menu && (
        <div
          className={`${HUD_PANEL_CLASS} pointer-events-auto fixed z-[170] min-w-44 overflow-hidden !rounded-[8px] p-1 text-[9px] tracking-[0.14em] uppercase`}
          data-character-tab-menu=""
          onPointerDown={(event: Readonly<ReactPointerEvent<HTMLDivElement>>) => event.stopPropagation()}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="w-full cursor-pointer rounded-[5px] px-3 py-2 text-left text-[#d6d1c8] hover:bg-[#4a9eff]/10 hover:text-[#67adff] disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!can_invite || !!pending}
            onClick={() => {
              const target = characters.find(({ id }) => id === menu.character_id)
              if (can_invite && target)
                dispatch_app({ type: 'party/invite', character_id: target.id, name: target.name })
              set_menu(null)
            }}
            role="menuitem"
            type="button"
          >
            {copy.world_hud.menu_group}
          </button>
        </div>
      )}
    </>
  )
}
