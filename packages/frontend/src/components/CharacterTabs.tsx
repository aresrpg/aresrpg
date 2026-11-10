// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { PortraitAppearance } from '@aresrpg/immutable/portrait'
import { Button, IconButton } from '@aresrpg/ui'
import { MAX_TRACKED_CHARACTERS, type CharacterRow } from '@aresrpg/protocol'
import { Plus, UsersRound } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { send_character_to_agent } from '../agents/send_character.ts'
import { AgentSetup } from '../agents/AgentSetup.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { crafting_lock_id } from '../modules/craft_character_lock.ts'
import { owned_party_invite_view } from '../modules/party.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { CharacterTab } from './CharacterTab.tsx'
import { CharacterDeleteModal } from './CharacterDeleteModal.tsx'
import './character_tabs.css'
import { ContextMenu } from './ContextMenu.tsx'
import { PortraitShareModal } from './PortraitShare.tsx'

export const character_tab_invite_enabled = (
  character_id: string,
  invite_view: ReturnType<typeof owned_party_invite_view>
): boolean => invite_view.enabled && invite_view.candidates.some(({ id }) => id === character_id)

const CreateCharacterTab = ({
  copy,
  create,
  count,
}: Readonly<{ copy: AppCopy; create: (() => void) | null; count: number }>) => {
  if (!create || count >= MAX_TRACKED_CHARACTERS) return null
  return (
    <Button
      aria-label={copy.create_character}
      className="grid w-[34px] shrink-0 cursor-pointer place-items-center border-r border-border text-[#6b7280] transition-colors duration-200 hover:bg-[#c8963c]/5 hover:text-[#e8c07a]"
      data-character-tab-create=""
      onClick={create}
      title={copy.create_character}
      type="button"
    >
      <Plus aria-hidden="true" size={11} />
    </Button>
  )
}

type CharacterTabDialogState = Readonly<
  { kind: 'agent' } | { kind: 'delete'; character_id: string } | { kind: 'portrait'; appearance: PortraitAppearance }
> | null

const CharacterTabDialog = ({
  dialog,
  copy,
  close,
}: Readonly<{
  dialog: CharacterTabDialogState
  copy: AppCopy
  close: () => void
}>) => {
  switch (dialog?.kind) {
    case 'portrait':
      return <PortraitShareModal appearance={dialog.appearance} copy={copy} close={close} />
    case 'agent':
      return <AgentSetup copy={copy} close={close} />
    case 'delete':
      return <CharacterDeleteModal character_id={dialog.character_id} copy={copy} close={close} />
    case undefined:
      return null
  }
}

const CharacterAgentAction = ({
  character_id,
  copy,
  open,
}: Readonly<{
  character_id: string
  copy: AppCopy
  open: (dialog: CharacterTabDialogState) => void
}>) => {
  const paired = useAppStore((state) => state.session.inventory_pairing?.signer_mode === 'host-persistent')
  return (
    <button
      type="button"
      role="menuitem"
      className="w-full cursor-pointer rounded-[5px] px-3 py-2 text-left text-text hover:bg-white/5"
      onClick={() => {
        if (paired) {
          open(null)
          send_character_to_agent(character_id, copy)
        } else open({ kind: 'agent' })
      }}
    >
      {paired ? copy.ui.agent_send : copy.ui.agent_setup}
    </button>
  )
}

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
  create_character: (() => void) | null
  select_character: (character_id: string) => void
  selected_character_id: string | null
}>) => {
  const [expanded, set_expanded] = useState(false)
  const selector_id = useId()
  const selector = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: Readonly<PointerEvent>) => {
      if (!selector.current?.contains(event.target as Node)) set_expanded(false)
    }
    const escape = (event: Readonly<KeyboardEvent>) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      set_expanded(false)
      selector.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape, true)
    }
  }, [expanded])
  const locked_character = useAppStore(crafting_lock_id)
  const wallet = useAppStore((state) => state.session.wallet)
  const [dialog, set_dialog] = useState<CharacterTabDialogState>(null)
  useEffect(() => set_dialog(null), [wallet])
  const party_by_character = useAppStore((state) => state.party.party_by_character)
  const parties = useAppStore((state) => state.party.by_id)
  const pending_by_character = useAppStore((state) => state.party.pending_by_character)
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
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
      }
    }
    globalThis.addEventListener('pointerdown', close)
    globalThis.addEventListener('keydown', keydown, true)
    return () => {
      globalThis.removeEventListener('pointerdown', close)
      globalThis.removeEventListener('keydown', keydown, true)
    }
  }, [menu])

  return (
    <>
      <div className="character-switcher" ref={selector}>
        <IconButton
          className="character-switcher-trigger world-utility-button"
          label={copy.characters}
          aria-expanded={expanded}
          aria-controls={selector_id}
          onClick={() => set_expanded(!expanded)}
          icon={<UsersRound size={22} />}
        />
        <nav
          id={selector_id}
          data-expanded={expanded}
          aria-label={copy.characters}
          className="character-tabs"
          data-character-tabs=""
          data-tutorial-target="character_tabs"
        >
          {characters.map((character) => {
            const active = character.id === selected_character_id
            const locked = !!locked_character && character.id !== locked_character
            return (
              <CharacterTab
                character={character}
                key={character.id}
                selected={active}
                disabled={locked}
                onClick={() => {
                  select_character(character.id)
                  set_expanded(false)
                }}
                onContextMenu={(event: Readonly<ReactMouseEvent<HTMLButtonElement>>) => {
                  event.preventDefault()
                  if (!create_character) return
                  set_menu({ character_id: character.id, x: event.clientX, y: event.clientY })
                }}
                title={locked ? copy.settings_page.always_craft_from_hint : undefined}
                type="button"
              />
            )
          })}
          <CreateCharacterTab copy={copy} create={create_character} count={characters.length} />
        </nav>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y}>
          <div className="grid" data-character-tab-menu="">
            <button
              type="button"
              role="menuitem"
              className="w-full cursor-pointer rounded-[5px] px-3 py-2 text-left text-text hover:bg-white/5"
              onClick={() => {
                const target = characters.find(({ id }) => id === menu.character_id)
                if (target) set_dialog({ kind: 'portrait', appearance: target })
                set_menu(null)
              }}
            >
              {copy.ui.portrait_share}
            </button>
            <CharacterAgentAction
              character_id={menu.character_id}
              copy={copy}
              open={(next) => {
                set_menu(null)
                set_dialog(next)
              }}
            />
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
            <button
              className="w-full cursor-pointer rounded-[5px] px-3 py-2 text-left text-[#ff7d94] hover:bg-[#ff496c]/10"
              onClick={() => {
                set_dialog({ kind: 'delete', character_id: menu.character_id })
                set_menu(null)
              }}
              role="menuitem"
              type="button"
            >
              {copy_text(copy.characters_page)('delete_character')}
            </button>
          </div>
        </ContextMenu>
      )}
      <CharacterTabDialog dialog={dialog} close={() => set_dialog(null)} copy={copy} />
    </>
  )
}
