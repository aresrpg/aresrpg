// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useCallback, useEffect } from 'react'
import type { CharacterRow } from '@aresrpg/protocol'
import type { DetailTab } from '../../characters/character_navigation.ts'
import type { CharacterSession } from '../../characters/character_session.ts'
import { CharacterWindow, CHARACTER_TABS } from './CharacterWindow.tsx'
import { ConfirmDialog } from '@aresrpg/ui'
import { toggle_fullscreen } from '../../components/FullscreenButton.tsx'
import { type AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../../store.ts'
import type { AppDialog } from '../../modules/navigation.ts'
import inventory_icon from '../../assets/quickslots/inventory.png'
import { hud_key_action } from '../core/hud_input.ts'

import '../../characters/characters.css'
import '../../components/character_surfaces.css'

const panel_from = (dialog: AppDialog | null): DetailTab | null =>
  CHARACTER_TABS.find(({ tab }) => dialog === `character_${tab}`)?.tab ?? null

export const CharacterHud = ({
  copy,
  character: supplied_character,
  session,
  enabled = true,
  leave,
}: Readonly<{
  copy: AppCopy
  character?: Readonly<CharacterRow>
  session?: CharacterSession
  enabled?: boolean
  leave: () => void
}>) => {
  const selected = useAppStore(({ session }) =>
    session.characters.find(({ id }) => id === session.selected_character_id)
  )
  const character = supplied_character ?? selected
  const dialog = useAppStore(({ navigation }) => navigation.dialog)
  const panel = panel_from(dialog)
  const close = useCallback((): void => {
    dispatch_app({ type: 'dialog/open', dialog: null })
  }, [])
  useEffect(() => {
    if (!enabled) return
    const key = (event: Readonly<KeyboardEvent>): void => {
      if (event.repeat || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('input,textarea,select,[contenteditable="true"]')) return
      const current = read_app_state()
      const own_panel = panel_from(current.navigation.dialog)
      const modal = document.querySelector(
        'dialog[open],[aria-modal="true"],[popover]:popover-open:not([data-blocking-overlay="false"])'
      )
      const action = hud_key_action({
        code: event.code,
        panel: own_panel !== null,
        blocked: modal !== null,
        fighting: current.fight.mounted,
      })
      if (!action) return
      event.preventDefault()
      const commands = {
        fullscreen: () => {
          void toggle_fullscreen(copy)
        },
        close,
        inventory: () => dispatch_app({ type: 'dialog/open', dialog: 'character_equipment' }),
        leave: () => dispatch_app({ type: 'dialog/open', dialog: 'leave_game' }),
      }
      commands[action]()
    }
    globalThis.addEventListener('keydown', key)
    return () => globalThis.removeEventListener('keydown', key)
  }, [close, copy, enabled])
  if (!enabled) return null
  return (
    <>
      {panel && character && (
        <CharacterWindow tab={panel} character={character} copy={copy} session={session} close={close} />
      )}
      {dialog === 'leave_game' && (
        <ConfirmDialog
          title={copy.ui.leave_game_title}
          close_label={copy.wallet_close}
          cancel_label={copy.ui.stay_in_game}
          confirm_label={copy.ui.leave_game_confirm}
          on_cancel={close}
          on_confirm={leave}
          icon={<img src={inventory_icon} alt="" />}
        />
      )}
    </>
  )
}
