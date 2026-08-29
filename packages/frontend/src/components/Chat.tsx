// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE chat of the game, rebuilt on the deprecated design: channels are READ FILTERS as
// checkboxes in the header (pick-many-to-view), every checked channel's lines interleave into
// one merged chronological log, and the input posts on the one speakable channel. Combat is a
// VIEW-ONLY channel fed by the fight module. Lines are semantic (template key + tokenized
// values); this component localizes live and paints tokens from the chat palette.

import { expand_chat_message, type ChatMessagePart } from '@aresrpg/protocol'
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  chat_line_in_fight,
  chat_line_in_party,
  chat_message_from_draft,
  character_chat_context,
  type ChatLine,
  type ChatLineValue,
} from '../modules/chat.ts'
import {
  CHAT_CHANNELS,
  chat_speak_channel_from,
  chat_visible_channels_from,
  effective_chat_speak_channel,
  toggled_chat_speak_channel,
  toggle_chat_channel,
  type ChatChannel,
} from '../game/core/chat_preferences.ts'
import { selected_party } from '../modules/party.ts'
import { selected_character } from '../modules/session.ts'
import { owned_character_position } from '../game/core/owned_character_feed.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { ItemSnapshotTooltip, useItemSnapshotHover } from './ItemSnapshotTooltip.tsx'
import { HUD_PANEL_CLASS } from './ui/HudPanel.tsx'
import { RunToRow } from './PlayerContextMenu.tsx'
import './chat.css'

type ChatText = Readonly<Record<string, string>>
type LiveNames = Readonly<Record<number, string>>

type ChatToken = Readonly<{
  text: string
  cls: string
  owner?: string
  character_id?: string
  position?: Readonly<{ world: string; x: number; z: number }>
  item?: Readonly<{ id: string; name: string }>
}>

const part_token = (part: Readonly<ChatMessagePart>, cls: string): ChatToken => {
  if (part.kind === 'position')
    return Object.freeze({
      text: `[${part.world} · ${Math.round(chain_to_client_coordinate(part.x))}, ${Math.round(chain_to_client_coordinate(part.z))}]`,
      cls: 'position',
      position: Object.freeze({ world: part.world, x: part.x, z: part.z }),
    })
  if (part.kind === 'item')
    return Object.freeze({ text: `[${part.name}]`, cls: 'item', item: Object.freeze({ id: part.id, name: part.name }) })
  return Object.freeze({ text: part.text, cls })
}

export const selected_chat_name = (
  session: Readonly<{
    selected_character_id: string | null
    characters: readonly Readonly<{ id: string; name: string }>[]
  }>,
  fallback: string
): string => session.characters.find(({ id }) => id === session.selected_character_id)?.name ?? fallback

const CHANNEL_LABEL_KEYS = Object.freeze({
  general: 'chat_tab_general',
  party: 'chat_tab_party',
  whisper: 'chat_tab_private',
  combat: 'chat_tab_combat',
}) satisfies Readonly<Record<ChatChannel, string>>
const CHANNEL_FILTERS = Object.freeze(
  CHAT_CHANNELS.map((channel) => Object.freeze({ channel, label_key: CHANNEL_LABEL_KEYS[channel] }))
)

const value_text = (value: Readonly<ChatLineValue>, text: ChatText, names: LiveNames): string => {
  if (value.seat !== undefined && names[value.seat]) return names[value.seat]
  if (value.copy_key && text[value.copy_key]) return text[value.copy_key]
  return value.text
}

// '{caster} casts {spell}' -> connective tokens (verb class) interleaved with value tokens
export const chat_line_tokens = (line: Readonly<ChatLine>, text: ChatText, names: LiveNames): readonly ChatToken[] => {
  const template = text[line.key] ?? line.key
  return Object.freeze(
    template
      .split(/(\{\w+\})/)
      .filter((part) => part.length > 0)
      .map((part) => {
        const match = /^\{(\w+)\}$/.exec(part)
        const value = match ? line.values[match[1]!] : undefined
        if (!value)
          return Object.freeze({
            text: part,
            cls: line.channel === 'party' ? 'party' : line.channel === 'whisper' ? 'whisper' : 'verb',
          })
        return value.parts
          ? value.parts.map((part) => part_token(part, value.cls ?? 'verb'))
          : Object.freeze({
              text: value_text(value, text, names),
              cls: value.cls ?? 'verb',
              owner: value.owner,
              character_id: value.character_id,
            })
      })
      .flat()
  )
}

const LinkedItemToken = ({
  copy,
  item,
  text,
}: Readonly<{ copy: AppCopy; item: Readonly<{ id: string; name: string }>; text: string }>) => {
  const item_hover = useItemSnapshotHover(item.id)
  return (
    <>
      <span
        className="chat-tok--item"
        onMouseEnter={(event) => item_hover.open(event.currentTarget)}
        onMouseLeave={item_hover.close}
      >
        {text}
      </span>
      <ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />
    </>
  )
}

const spoken_line = ({
  channel,
  party,
  parts,
  speaker,
}: Readonly<{
  channel: 'general' | 'party'
  party: string | null
  parts: readonly ChatMessagePart[]
  speaker: string
}>): ChatLine => {
  const scoped = channel === 'party' && party !== null
  const content = Object.freeze({
    id: `say:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    key: scoped ? 'chat_party_line' : 'chat_line',
    values: Object.freeze({
      name: Object.freeze({ text: speaker, cls: scoped ? 'party' : 'self' }),
      message: Object.freeze({ text: '', parts, cls: scoped ? 'party' : 'says' }),
    }),
  })
  return scoped
    ? Object.freeze({ ...content, channel: 'party', party })
    : Object.freeze({ ...content, channel: 'general' })
}

export const Chat = ({
  copy,
  names = Object.freeze({}),
  fight,
}: Readonly<{ copy: AppCopy; names?: LiveNames; fight?: string }>) => {
  const text = useMemo(() => ({ ...copy.party_panel, ...copy.simulator_page, ...copy.fight_hud }), [copy])
  const lines = useAppStore((state) => state.chat.lines)
  const draft = useAppStore((state) => state.chat.draft)
  const settings = useAppStore((state) => state.settings)
  const self_name = useAppStore((state) => selected_chat_name(state.session, text.chat_you ?? 'me'))
  const speaker = useAppStore((state) => selected_character(state.session))
  const party = useAppStore(selected_party)
  const log = useRef<HTMLDivElement>(null)
  // The wire's authoritative speaker identity opens the shared menu even outside presence;
  // only the body-sourced menu may offer the proximity-bound duel.
  const open_player_menu = (token: Readonly<ChatToken>, x: number, y: number): void => {
    if (!token.character_id || !token.owner) return
    dispatch_app({
      type: 'world/player_menu',
      menu: {
        character_id: token.character_id,
        name: token.text,
        owner: token.owner,
        x,
        y,
        source: 'chat',
      },
    })
  }
  const visible_channels = chat_visible_channels_from(settings.chat_visible_channels)
  const preferred_speak_channel = chat_speak_channel_from(settings.chat_speak_channel)
  const speak_channel = effective_chat_speak_channel(preferred_speak_channel, party !== null)
  const [position_menu, set_position_menu] = useState<Readonly<{
    world: string
    x: number
    z: number
    left: number
    top: number
  }> | null>(null)
  useEffect(() => {
    if (!position_menu) return undefined
    const dismiss = (): void => set_position_menu(null)
    globalThis.addEventListener('pointerdown', dismiss)
    globalThis.addEventListener('keydown', dismiss)
    return () => {
      globalThis.removeEventListener('pointerdown', dismiss)
      globalThis.removeEventListener('keydown', dismiss)
    }
  }, [position_menu])
  const rendered = useMemo(
    () =>
      lines
        .filter(
          (line) =>
            visible_channels.includes(line.channel) &&
            chat_line_in_fight(line, fight) &&
            chat_line_in_party(line, party?.id)
        )
        .map((line) =>
          Object.freeze({ id: line.id, channel: line.channel, tokens: chat_line_tokens(line, text, names) })
        ),
    [fight, lines, names, party?.id, text, visible_channels]
  )
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [rendered.length])

  const toggle = (channel: ChatChannel): void =>
    dispatch_app({
      type: 'settings/changed',
      settings: Object.freeze({
        ...settings,
        chat_visible_channels: toggle_chat_channel(visible_channels, channel),
      }),
    })

  const speak = (): void => {
    const message = chat_message_from_draft(draft)
    if (!message.text || !speaker) return
    const position = speaker.world ? owned_character_position(speaker.id, speaker.world) : null
    const parts = expand_chat_message(message, character_chat_context(speaker, position))
    // the wire send (session forwards to packet/chat when the link is up) + the local echo
    dispatch_app({ type: 'chat/speak', channel: speak_channel, parts })
    dispatch_app({ type: 'chat/draft_sent' })
    dispatch_app({
      type: 'chat/line',
      line: spoken_line({ channel: speak_channel, party: party?.id ?? null, parts, speaker: self_name }),
    })
  }

  return (
    <aside aria-label={text.chat_title} className="chat">
      <header>
        <span>{text.chat_title}</span>
        <span className="chat__filters">
          {CHANNEL_FILTERS.map(({ channel, label_key }) => (
            <label className="chat__filter" key={channel}>
              <input checked={visible_channels.includes(channel)} onChange={() => toggle(channel)} type="checkbox" />
              <span aria-hidden="true" className="chat__box" />
              {text[label_key]}
            </label>
          ))}
        </span>
      </header>
      <div className="chat__lines" ref={log} role="log">
        {rendered.map((line) => (
          <p className={`chat__line chat__line--${line.channel}`} key={line.id}>
            {line.tokens.map((token, index) =>
              token.owner && token.character_id ? (
                <span
                  className={`chat-tok--${token.cls} chat-tok--clickable`}
                  key={index}
                  onClick={(event) => open_player_menu(token, event.clientX, event.clientY)}
                >
                  {token.text}
                </span>
              ) : token.position ? (
                <span
                  className="chat-tok--position chat-tok--clickable"
                  key={index}
                  onClick={(event) => {
                    set_position_menu({
                      ...token.position!,
                      left: event.clientX,
                      top: event.clientY,
                    })
                  }}
                >
                  {token.text}
                </span>
              ) : token.item ? (
                <LinkedItemToken copy={copy} item={token.item} key={index} text={token.text} />
              ) : (
                <span className={`chat-tok--${token.cls}`} key={index}>
                  {token.text}
                </span>
              )
            )}
          </p>
        ))}
      </div>
      <footer>
        <button
          className={speak_channel === 'party' ? 'chat__scope is-party' : 'chat__scope'}
          disabled={!party}
          onClick={() =>
            dispatch_app({
              type: 'settings/changed',
              settings: Object.freeze({
                ...settings,
                chat_speak_channel: toggled_chat_speak_channel(preferred_speak_channel),
              }),
            })
          }
          type="button"
        >
          {text[speak_channel === 'party' ? 'chat_tab_party' : 'chat_tab_general']}
        </button>
        <input
          className="chat__input"
          maxLength={240}
          onChange={(event) => dispatch_app({ type: 'chat/draft_changed', text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') speak()
            event.stopPropagation()
          }}
          placeholder={text.chat_placeholder}
          type="text"
          value={draft.text}
        />
      </footer>
      {position_menu && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`${HUD_PANEL_CLASS} pointer-events-auto fixed z-[140] min-w-[168px] divide-y divide-white/10 text-[11px]`}
              onPointerDown={(event) => event.stopPropagation()}
              role="menu"
              style={{ left: position_menu.left, top: position_menu.top }}
            >
              <RunToRow
                label={text.run_to_position}
                run={() => {
                  dispatch_app({
                    type: 'run_to/position',
                    world: position_menu.world,
                    x: position_menu.x,
                    z: position_menu.z,
                  })
                  set_position_menu(null)
                }}
                visible
              />
            </div>,
            document.body
          )
        : null}
    </aside>
  )
}

export const WorldChat = (properties: Parameters<typeof Chat>[0]) => (
  <div className="gw-worldchat">
    <Chat {...properties} />
  </div>
)
