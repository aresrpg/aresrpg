// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE chat of the game. Every stream that speaks to the player — combat log today, world
// chat tomorrow — lands here; no surface keeps its own log. Lines are SEMANTIC: a template key
// plus tokenized values, so the renderer localizes live and paints each token from the chat
// palette. The correction door: a dispatch may rewrite an existing line only by naming it with
// `replaces` (a chain-adopted amount corrects the line where it already spoke, never appends
// a second number).

import type { AppInput, AppModule, AppState } from '../store.ts'

const MAX_LINES = 100

export type ChatChannel = 'combat' | 'general'

// One colored token. `cls` picks the palette class (chat.css); `seat` marks a fighter
// reference so the renderer prefers the live fight name over the baked fallback text;
// `copy_key` marks a localizable token the renderer resolves from the locale copy.
export type ChatLineValue = Readonly<{ text: string; cls?: string; seat?: number; copy_key?: string }>

export type ChatLine = Readonly<{
  id: string
  channel: ChatChannel
  // template key into the locale copy (fight_hud section); plain template text renders as
  // connective tokens, each {placeholder} renders as its value's colored token
  key: string
  values: Readonly<Record<string, ChatLineValue>>
}>

export type ChatState = Readonly<{ lines: readonly ChatLine[] }>

export type ChatInput =
  | Readonly<{ type: 'chat/line'; line: ChatLine; replaces?: string }>
  // the outbound door — the reducer ignores it (the local echo is its own chat/line from the
  // speaker's edge); the session module owns the link and forwards the text as packet/chat
  | Readonly<{ type: 'chat/speak'; text: string }>

export const initial_chat_state = (): ChatState => Object.freeze({ lines: Object.freeze([]) })

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type !== 'chat/line') return state
  const { line, replaces } = input
  if (replaces === undefined)
    return Object.freeze({
      ...state,
      chat: Object.freeze({ lines: Object.freeze([...state.chat.lines, line].slice(-MAX_LINES)) }),
    })
  const at = state.chat.lines.findIndex((existing) => existing.id === replaces)
  // A correction addressing a line that scrolled away writes nothing: a bare corrected
  // number with no cast above it reads as a hit that never happened.
  if (at < 0) return state
  return Object.freeze({
    ...state,
    chat: Object.freeze({
      lines: Object.freeze(
        state.chat.lines.map((existing, index) => (index === at ? { ...line, id: replaces } : existing))
      ),
    }),
  })
}

// Incoming wire chat re-enters through the reducer door as a chat/line; the id is generated
// HERE at the effect edge so the reducer stays pure.
const observe: NonNullable<AppModule['observe']> = ({ events, dispatch }) => {
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/chat_message') return
    dispatch({
      type: 'chat/line',
      line: Object.freeze({
        id: `wire:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        channel: 'general' as const,
        key: 'chat_line',
        values: Object.freeze({
          name: Object.freeze({ text: packet.character, cls: 'name' }),
          message: Object.freeze({ text: packet.text, cls: 'says' }),
        }),
      }),
    })
  })
}

// pure reducer — the feeds live in the modules that own each stream (fight feeds combat)
export default Object.freeze({ name: 'chat', reduce, observe }) satisfies AppModule
