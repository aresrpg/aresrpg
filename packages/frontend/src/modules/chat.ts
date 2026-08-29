// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE chat of the game. Every stream that speaks to the player — combat log today, world
// chat tomorrow — lands here; no surface keeps its own log. Lines are SEMANTIC: a template key
// plus tokenized values, so the renderer localizes live and paints each token from the chat
// palette. The correction door: a dispatch may rewrite an existing line only by naming it with
// `replaces` (a chain-adopted amount corrects the line where it already spoke, never appends
// a second number).

import {
  CHAT_MAX_ITEM_LINKS,
  CHAT_MAX_LENGTH,
  type CharacterRow,
  type ChatItemLink,
  type ChatMacroContext,
  type ChatMessage,
  type ChatMessagePart,
  type ServerPacket,
} from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'
import type { ChatChannel } from '../game/core/chat_preferences.ts'

export type { ChatChannel } from '../game/core/chat_preferences.ts'

const MAX_LINES = 100

// One colored token. `cls` picks the palette class (chat.css); `seat` marks a fighter
// reference so the renderer prefers the live fight name over the baked fallback text;
// `copy_key` marks a localizable token the renderer resolves from the locale copy.
export type ChatLineValue = Readonly<{
  text: string
  parts?: readonly ChatMessagePart[]
  cls?: string
  seat?: number
  copy_key?: string
  /** address provenance for social actions on a spoken player name */
  owner?: string
  character_id?: string
}>

type ChatLineContent = Readonly<{
  id: string
  // template key into the locale copy (fight_hud section); plain template text renders as
  // connective tokens, each {placeholder} renders as its value's colored token
  key: string
  values: Readonly<Record<string, ChatLineValue>>
}>

export type ChatLine = ChatLineContent &
  Readonly<
    | { channel: 'combat'; fight: string; party?: never }
    | { channel: 'general'; fight?: never; party?: never }
    | { channel: 'party'; party: string; fight?: never }
    | { channel: 'whisper'; fight?: never; party?: never }
  >

export type ChatDraft = Readonly<{ text: string; items: readonly ChatItemLink[] }>
export type ChatState = Readonly<{ lines: readonly ChatLine[]; draft: ChatDraft }>

export type ChatInput =
  | Readonly<{ type: 'chat/line'; line: ChatLine; replaces?: string }>
  // the outbound door — the reducer ignores it (the local echo is its own chat/line from the
  // speaker's edge); the session module owns the link and forwards the typed parts as packet/chat
  | Readonly<{ type: 'chat/speak'; channel: 'general' | 'party'; parts: readonly ChatMessagePart[] }>
  | Readonly<{ type: 'chat/whisper'; to: string; parts: readonly ChatMessagePart[] }>
  | Readonly<{ type: 'chat/draft_changed'; text: string }>
  | Readonly<{ type: 'chat/link_item'; item: ChatItemLink }>
  | Readonly<{ type: 'chat/draft_sent' }>

const empty_draft = (): ChatDraft => Object.freeze({ text: '', items: Object.freeze([]) })

export const initial_chat_state = (): ChatState => Object.freeze({ lines: Object.freeze([]), draft: empty_draft() })

export const chat_message_from_draft = (draft: Readonly<ChatDraft>): ChatMessage =>
  Object.freeze({ text: draft.text.trim(), items: draft.items })

export const character_chat_context = (
  character: Readonly<CharacterRow>,
  position: Readonly<{ x: number; z: number }> | null
): ChatMacroContext => {
  const world = character.world ?? character.checkpoint_world ?? ''
  const at = position ?? Object.freeze({ x: character.x ?? 0, z: character.z ?? 0 })
  return Object.freeze({
    classe: character.classe,
    level: character.level,
    experience: character.experience,
    world,
    x: at.x,
    z: at.z,
  })
}

export const chat_line_in_fight = (line: Readonly<ChatLine>, fight: string | undefined): boolean =>
  line.channel !== 'combat' || (fight !== undefined && line.fight === fight)

export const chat_line_in_party = (line: Readonly<ChatLine>, party: string | undefined): boolean =>
  line.channel !== 'party' || (party !== undefined && line.party === party)

const fold_draft = (state: AppState, input: AppInput): AppState | null => {
  if (input.type === 'chat/draft_changed')
    return Object.freeze({
      ...state,
      chat: Object.freeze({ ...state.chat, draft: Object.freeze({ ...state.chat.draft, text: input.text }) }),
    })
  if (input.type === 'chat/link_item') {
    if (state.chat.draft.items.length >= CHAT_MAX_ITEM_LINKS) return state
    const marker = `[${input.item.name}]`
    const separator = state.chat.draft.text.length > 0 && !state.chat.draft.text.endsWith(' ') ? ' ' : ''
    const text = `${state.chat.draft.text}${separator}${marker}`
    if (text.length > CHAT_MAX_LENGTH) return state
    return Object.freeze({
      ...state,
      chat: Object.freeze({
        ...state.chat,
        draft: Object.freeze({ text, items: Object.freeze([...state.chat.draft.items, input.item]) }),
      }),
    })
  }
  if (input.type === 'chat/draft_sent')
    return Object.freeze({ ...state, chat: Object.freeze({ ...state.chat, draft: empty_draft() }) })
  return null
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const drafted = fold_draft(state, input)
  if (drafted) return drafted
  if (input.type !== 'chat/line') return state
  const { line, replaces } = input
  if (replaces === undefined)
    return Object.freeze({
      ...state,
      chat: Object.freeze({ ...state.chat, lines: Object.freeze([...state.chat.lines, line].slice(-MAX_LINES)) }),
    })
  const at = state.chat.lines.findIndex((existing) => existing.id === replaces)
  // A correction addressing a line that scrolled away writes nothing: a bare corrected
  // number with no cast above it reads as a hit that never happened.
  if (at < 0) return state
  return Object.freeze({
    ...state,
    chat: Object.freeze({
      ...state.chat,
      lines: Object.freeze(
        state.chat.lines.map((existing, index) => (index === at ? { ...line, id: replaces } : existing))
      ),
    }),
  })
}

const wire_chat_line = (packet: Readonly<Extract<ServerPacket, { type: 'packet/chat_message' }>>): ChatLine | null => {
  const channel = { world: 'general', party: 'party', whisper: 'whisper' }[packet.channel] as Exclude<
    ChatChannel,
    'combat'
  >
  if (channel === 'party' && !packet.scope) return null
  const cls = { general: null, party: 'party', whisper: 'whisper' }[channel]
  const content = {
    id: `wire:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    key: { general: 'chat_line', party: 'chat_party_line', whisper: 'chat_line' }[channel],
    values: Object.freeze({
      name: Object.freeze({
        text: packet.character,
        cls: cls ?? 'name',
        owner: packet.from,
        character_id: packet.character_id,
      }),
      message: Object.freeze({ text: '', parts: packet.parts, cls: cls ?? 'says' }),
    }),
  }
  return channel === 'party'
    ? Object.freeze({ ...content, channel, party: packet.scope! })
    : Object.freeze({ ...content, channel })
}

// Incoming wire chat re-enters through the reducer door as a chat/line; the id is generated
// HERE at the effect edge so the reducer stays pure.
const observe: NonNullable<AppModule['observe']> = ({ events, dispatch }) => {
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/chat_message') return
    const line = wire_chat_line(packet)
    if (line) dispatch({ type: 'chat/line', line })
  })
}

// pure reducer — the feeds live in the modules that own each stream (fight feeds combat)
export default Object.freeze({ name: 'chat', reduce, observe }) satisfies AppModule
