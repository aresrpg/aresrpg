// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE chat of the game, rebuilt on the deprecated design: channels are READ FILTERS as
// checkboxes in the header (pick-many-to-view), every checked channel's lines interleave into
// one merged chronological log, and the input posts on the one speakable channel. Combat is a
// VIEW-ONLY channel fed by the fight module. Lines are semantic (template key + tokenized
// values); this component localizes live and paints tokens from the chat palette.

import { useEffect, useMemo, useRef, useState } from 'react'

import type { ChatChannel, ChatLine, ChatLineValue } from '../modules/chat.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import './chat.css'

type ChatText = Readonly<Record<string, string>>
type LiveNames = Readonly<Record<number, string>>

type ChatToken = Readonly<{ text: string; cls: string }>

export const selected_chat_name = (
  session: Readonly<{
    selected_character_id: string | null
    characters: readonly Readonly<{ id: string; name: string }>[]
  }>,
  fallback: string
): string => session.characters.find(({ id }) => id === session.selected_character_id)?.name ?? fallback

const CHANNELS: readonly Readonly<{ channel: ChatChannel; label_key: string }>[] = Object.freeze([
  Object.freeze({ channel: 'general' as const, label_key: 'chat_tab_general' }),
  Object.freeze({ channel: 'combat' as const, label_key: 'chat_tab_combat' }),
])

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
        if (!value) return Object.freeze({ text: part, cls: 'verb' })
        return Object.freeze({ text: value_text(value, text, names), cls: value.cls ?? 'verb' })
      })
  )
}

export const Chat = ({ text, names = Object.freeze({}) }: Readonly<{ text: ChatText; names?: LiveNames }>) => {
  const lines = useAppStore((state) => state.chat.lines)
  const players = useAppStore((state) => state.world.players)
  const self_name = useAppStore((state) => selected_chat_name(state.session, text.chat_you ?? 'me'))
  const log = useRef<HTMLDivElement>(null)
  // a spoken NAME that maps to a nearby player opens the same context menu as their body —
  // minus the duel, which needs the two of them standing together (owner 2026-08-21)
  const open_player_menu = (name: string, x: number, y: number): void => {
    const row = Object.values(players).find((player) => player.name === name)
    if (row) dispatch_app({ type: 'world/player_menu', menu: { character_id: row.character_id, x, y, source: 'chat' } })
  }
  // checked = visible in the merged log; all channels checked by default
  const [enabled, set_enabled] = useState<ReadonlySet<ChatChannel>>(
    () => new Set(CHANNELS.map(({ channel }) => channel))
  )
  const [draft, set_draft] = useState('')
  const rendered = useMemo(
    () =>
      lines
        .filter((line) => enabled.has(line.channel))
        .map((line) =>
          Object.freeze({ id: line.id, channel: line.channel, tokens: chat_line_tokens(line, text, names) })
        ),
    [enabled, lines, names, text]
  )
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [rendered.length])

  const toggle = (channel: ChatChannel): void =>
    set_enabled((current) => {
      const next = new Set(current)
      if (next.has(channel)) next.delete(channel)
      else next.add(channel)
      return next
    })

  const speak = (): void => {
    const message = draft.trim()
    if (!message) return
    set_draft('')
    // the wire send (session forwards to packet/chat when the link is up) + the local echo
    dispatch_app({ type: 'chat/speak', text: message })
    dispatch_app({
      type: 'chat/line',
      line: Object.freeze({
        id: `say:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        channel: 'general' as const,
        key: 'chat_line',
        values: Object.freeze({
          name: Object.freeze({ text: self_name, cls: 'self' }),
          message: Object.freeze({ text: message, cls: 'says' }),
        }),
      }),
    })
  }

  return (
    <aside aria-label={text.chat_title} className="chat">
      <header>
        <span>{text.chat_title}</span>
        <span className="chat__filters">
          {CHANNELS.map(({ channel, label_key }) => (
            <label className="chat__filter" key={channel}>
              <input checked={enabled.has(channel)} onChange={() => toggle(channel)} type="checkbox" />
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
              token.cls === 'name' ? (
                <span
                  className={`chat-tok--${token.cls} chat-tok--clickable`}
                  key={index}
                  onClick={(event) => open_player_menu(token.text, event.clientX, event.clientY)}
                >
                  {token.text}
                </span>
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
        <input
          className="chat__input"
          maxLength={240}
          onChange={(event) => set_draft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') speak()
            event.stopPropagation()
          }}
          placeholder={text.chat_placeholder}
          type="text"
          value={draft}
        />
      </footer>
    </aside>
  )
}
