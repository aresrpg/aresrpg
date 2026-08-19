// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'
import { Plus } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Page } from '../modules/navigation.ts'

/** The pages whose content is scoped to ONE owned character — the tab strip only lives there. */
const CHARACTER_PAGES: readonly Page[] = Object.freeze(['world', 'characters', 'kolizeum'])

export const character_tabs_visible = (page: Page): boolean => CHARACTER_PAGES.includes(page)

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
}>) => (
  <nav
    aria-label={copy.characters}
    className="pointer-events-auto flex h-[22px] shrink-0 items-stretch overflow-x-auto border border-[#1e1e2e] bg-[#12121a]/95"
    data-character-tabs=""
  >
    {characters.map((character) => {
      const active = character.id === selected_character_id
      return (
        <button
          aria-pressed={active}
          className={`flex min-w-0 max-w-52 shrink-0 cursor-pointer items-center gap-2.5 border-r border-[#1e1e2e] px-5 transition-colors duration-200 ${
            active
              ? 'bg-[#c8963c]/8 text-[#e8c07a] shadow-[inset_0_-2px_0_0_#c8963c]'
              : 'text-[#6b7280] hover:bg-[#c8963c]/5 hover:text-[#d6d1c8]'
          }`}
          data-character-tab={character.id}
          key={character.id}
          onClick={() => select_character(character.id)}
          type="button"
        >
          <span className="truncate text-[10px] tracking-[0.18em] uppercase">{character.name}</span>
          <span className={`text-[8px] tracking-[0.12em] ${active ? 'text-[#c8963c]' : 'text-[#4b5058]'}`}>
            {character.level}
          </span>
        </button>
      )
    })}
    <button
      aria-label={copy.create_character}
      className="grid w-[26px] shrink-0 cursor-pointer place-items-center border-r border-[#1e1e2e] text-[#6b7280] transition-colors duration-200 hover:bg-[#c8963c]/5 hover:text-[#e8c07a]"
      data-character-tab-create=""
      onClick={create_character}
      title={copy.create_character}
      type="button"
    >
      <Plus aria-hidden="true" size={11} />
    </button>
  </nav>
)
