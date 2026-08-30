// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One viewport-global player menu host. Body, Party, and chat interactions dispatch the same
// identity snapshot; source gates only proximity-bound actions, never whether the menu renders.

import type { PartyRow, TradePhase } from '@aresrpg/protocol'
import { CHAT_MAX_LENGTH, expand_chat_message, type ChatMessage } from '@aresrpg/protocol'
import { useEffect, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { party_invite_allowed, selected_party } from '../modules/party.ts'
import { character_chat_context } from '../modules/chat.ts'
import { selected_character } from '../modules/session.ts'
import { owned_character_position } from '../game/core/owned_character_feed.ts'
import { trade_row_visible } from '../modules/trade.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { HUD_PANEL_CLASS } from './ui/HudPanel.tsx'

const ROW_CLASS =
  'block w-full cursor-pointer px-3 py-2 text-left uppercase tracking-[0.15em] enabled:hover:bg-white/10 enabled:hover:text-[#7fd6d0] disabled:cursor-default disabled:opacity-35'

type MenuIdentity = Readonly<{ character_id: string; name: string; owner: string }>

const has_menu_identity = (
  menu: Readonly<{ character_id: string; name?: string; owner?: string }>
): menu is MenuIdentity => typeof menu.name === 'string' && typeof menu.owner === 'string'

export const menu_target = (
  menu: Readonly<{ character_id: string; name?: string; owner?: string }> | null,
  players: Readonly<Record<string, Readonly<{ character_id: string; name: string; owner: string }>>>
): MenuIdentity | undefined => {
  if (!menu) return undefined
  const visible = players[menu.character_id]
  if (visible) return visible
  return has_menu_identity(menu) ? menu : undefined
}

const trade_menu_disabled = (
  wallet: string | null,
  target: string | null,
  target_phase: TradePhase | undefined,
  outgoing_request: boolean,
  trade_loaded: boolean
): boolean =>
  !trade_loaded ||
  !wallet ||
  wallet.toLowerCase() === target ||
  target_phase === 'requested' ||
  (outgoing_request && !target_phase)

export const party_invite_visible = (
  party: Readonly<PartyRow> | null,
  menu: Readonly<{ character_id: string }> | null
): boolean => {
  const character_id = menu?.character_id
  return (
    character_id !== undefined &&
    !party?.members.some((member) => member.character_id === character_id) &&
    !party?.invited.some((member) => member.character_id === character_id)
  )
}

const WhisperModal = ({
  recipient,
  close,
  copy,
}: Readonly<{
  recipient: Readonly<{ address: string; name: string }> | null
  close: () => void
  copy: AppCopy
}>) => {
  const [message, set_message] = useState('')
  const speaker = useAppStore((state) => selected_character(state.session))
  if (!recipient) return null
  const send = (event: Readonly<FormEvent<HTMLFormElement>>): void => {
    event.preventDefault()
    const text = message.trim()
    if (!text || !speaker) return
    const outgoing: ChatMessage = Object.freeze({ text, items: Object.freeze([]) })
    const position = speaker.world ? owned_character_position(speaker.id, speaker.world) : null
    const parts = expand_chat_message(outgoing, character_chat_context(speaker, position))
    dispatch_app({ type: 'chat/whisper', to: recipient.address, parts })
    dispatch_app({
      type: 'chat/line',
      line: Object.freeze({
        id: `whisper:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        channel: 'whisper',
        key: 'chat_whisper_to',
        values: Object.freeze({
          name: Object.freeze({ text: recipient.name, cls: 'whisper', owner: recipient.address }),
          message: Object.freeze({ text: '', parts, cls: 'whisper' }),
        }),
      }),
    })
    close()
  }
  const title = copy.world_hud.message_title.replace('{{name}}', recipient.name)
  return (
    <ModalFrame close={close} close_label={copy.world_hud.message_cancel} label={title} max_width="max-w-sm" soft>
      <form className="grid gap-4 p-6" onSubmit={send}>
        <header className="pr-8 font-mono text-xs tracking-[0.12em] text-[#ff78b7] uppercase">{title}</header>
        <textarea
          autoFocus
          className="min-h-28 resize-none border border-[#ff78b7]/30 bg-black/25 p-3 font-mono text-xs text-[#ffd1e7] outline-none focus:border-[#ff78b7]/70"
          maxLength={CHAT_MAX_LENGTH}
          onChange={(event) => set_message(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close()
            event.stopPropagation()
          }}
          placeholder={copy.world_hud.message_placeholder}
          value={message}
        />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            className="btn-outline min-h-10 px-4 py-2.5 font-mono text-[9px] font-semibold tracking-[0.18em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff78b7]"
            onClick={close}
            type="button"
          >
            {copy.world_hud.message_cancel}
          </button>
          <button
            className="btn-gold min-h-10 px-4 py-2.5 font-mono text-[9px] tracking-[0.18em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff78b7]"
            disabled={!message.trim()}
            type="submit"
          >
            {copy.world_hud.message_send}
          </button>
        </div>
      </form>
    </ModalFrame>
  )
}

export const PlayerSocialRows = ({
  visible,
  source,
  already_friend,
  can_invite,
  invite_visible,
  trade_disabled,
  copy,
  add_friend,
  invite,
  trade,
  duel,
  message,
}: Readonly<{
  visible: boolean
  source: 'body' | 'chat' | 'party'
  already_friend: boolean
  can_invite: boolean
  invite_visible: boolean
  trade_disabled: boolean
  copy: AppCopy
  add_friend: () => void
  invite: () => void
  trade: () => void
  duel: () => void
  message: () => void
}>) =>
  visible ? (
    <>
      <button className={ROW_CLASS} disabled={already_friend} onClick={add_friend} role="menuitem" type="button">
        {copy.world_hud.menu_friend}
      </button>
      {invite_visible && (
        <button className={ROW_CLASS} disabled={!can_invite} onClick={invite} role="menuitem" type="button">
          {copy.world_hud.menu_group}
        </button>
      )}
      <button className={ROW_CLASS} disabled={trade_disabled} onClick={trade} role="menuitem" type="button">
        {copy.world_hud.menu_trade}
      </button>
      {source === 'body' && (
        <button className={ROW_CLASS} onClick={duel} role="menuitem" type="button">
          {copy.world_hud.menu_duel}
        </button>
      )}
      <button className={ROW_CLASS} onClick={message} role="menuitem" type="button">
        {copy.world_hud.menu_message}
      </button>
    </>
  ) : null

export const RunToRow = ({ visible, label, run }: Readonly<{ visible: boolean; label: string; run: () => void }>) =>
  visible ? (
    <button className={ROW_CLASS} onClick={run} role="menuitem" type="button">
      {label}
    </button>
  ) : null

export const PlayerContextMenu = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const party_text = copy_text(copy.party_panel)
  const [recipient, set_recipient] = useState<Readonly<{ address: string; name: string }> | null>(null)
  const menu = useAppStore((state) => state.world.player_menu)
  const target = useAppStore((state) => menu_target(menu, state.world.players))
  const target_owner = target?.owner.toLowerCase() ?? null
  const already_friend = useAppStore((state) =>
    target_owner ? state.friends.rows.some(({ address }) => address.toLowerCase() === target_owner) : false
  )
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const selected_character_custody = useAppStore(
    (state) => state.session.characters.find(({ id }) => id === state.session.selected_character_id)?.custody
  )
  const own_party = useAppStore(selected_party)
  const invite_visible = party_invite_visible(own_party, menu)
  const can_invite = party_invite_allowed(own_party, selected_character_id, selected_character_custody !== 'fight')
  const wallet_address = useAppStore((state) => state.session.wallet?.address ?? null)
  const target_trade = useAppStore((state) =>
    target_owner
      ? (state.trade.rows.find(
          (row) =>
            trade_row_visible(row) &&
            ((row.a.toLowerCase() === target_owner && row.b === state.session.wallet?.address) ||
              (row.b.toLowerCase() === target_owner && row.a === state.session.wallet?.address))
        ) ?? null)
      : null
  )
  const outgoing_request = useAppStore((state) =>
    state.trade.rows.some(
      (row) => row.phase === 'requested' && row.a.toLowerCase() === state.session.wallet?.address.toLowerCase()
    )
  )
  const trade_loaded = useAppStore((state) => state.trade.loaded)
  const trade_disabled = trade_menu_disabled(
    wallet_address,
    target_owner,
    target_trade?.phase,
    outgoing_request,
    trade_loaded
  )
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

  const duel = (): void => {
    dispatch_app({ type: 'duel/challenged', character_id: target!.character_id, name: target!.name })
    close()
  }
  const add_friend = (): void => {
    dispatch_app({ type: 'friends/add', target: target!.owner })
    close()
  }
  const invite = (): void => {
    dispatch_app({ type: 'party/invite', character_id: target!.character_id, name: target!.name })
    close()
  }
  const trade = (): void => {
    if (target_trade?.phase === 'requested') return
    if (target_trade) dispatch_app({ type: 'trade/open', trade: target_trade.id })
    else dispatch_app({ type: 'trade/create', counterparty: target!.owner })
    close()
  }
  const open_message = (): void => {
    set_recipient(Object.freeze({ address: target!.owner, name: target!.name }))
    close()
  }
  const run_to = (): void => {
    dispatch_app({ type: 'run_to/character', character_id: menu!.character_id })
    close()
  }
  return (
    <>
      {menu && (target || menu.source === 'party') ? (
        <div
          className={`${HUD_PANEL_CLASS} pointer-events-auto fixed z-[140] min-w-[168px] divide-y divide-white/10 text-[11px]`}
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event: Readonly<ReactPointerEvent<HTMLDivElement>>) => event.stopPropagation()}
          role="menu"
        >
          <PlayerSocialRows
            add_friend={add_friend}
            already_friend={already_friend}
            can_invite={can_invite}
            copy={copy}
            duel={duel}
            invite={invite}
            invite_visible={invite_visible}
            message={open_message}
            source={menu.source}
            trade={trade}
            trade_disabled={trade_disabled}
            visible={!!target}
          />
          <RunToRow label={party_text('run_to_position')} run={run_to} visible={menu.source === 'party'} />
        </div>
      ) : null}
      <WhisperModal close={() => set_recipient(null)} copy={copy} recipient={recipient} />
    </>
  )
}
