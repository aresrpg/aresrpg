// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const CHAT_CHANNELS = Object.freeze(['general', 'party', 'whisper', 'combat'] as const)
export type ChatChannel = (typeof CHAT_CHANNELS)[number]
export type ChatSpeakChannel = Extract<ChatChannel, 'general' | 'party'>

const is_chat_channel = (value: unknown): value is ChatChannel =>
  typeof value === 'string' && CHAT_CHANNELS.includes(value as ChatChannel)

export const chat_visible_channels_from = (value: unknown): readonly ChatChannel[] => {
  if (!Array.isArray(value) || value.some((channel) => !is_chat_channel(channel))) return CHAT_CHANNELS
  const selected = new Set(value)
  const normalized = CHAT_CHANNELS.filter((channel) => selected.has(channel))
  return Object.isFrozen(value) &&
    normalized.length === value.length &&
    normalized.every((channel, index) => channel === value[index])
    ? (value as readonly ChatChannel[])
    : Object.freeze(normalized)
}

export const chat_speak_channel_from = (value: unknown): ChatSpeakChannel => (value === 'party' ? 'party' : 'general')

export const effective_chat_speak_channel = (
  preferred: ChatSpeakChannel,
  party_available: boolean
): ChatSpeakChannel => (preferred === 'party' && party_available ? 'party' : 'general')

export const toggled_chat_speak_channel = (channel: ChatSpeakChannel): ChatSpeakChannel =>
  channel === 'general' ? 'party' : 'general'

export const toggle_chat_channel = (visible: readonly ChatChannel[], toggled: ChatChannel): readonly ChatChannel[] =>
  Object.freeze(
    CHAT_CHANNELS.filter((channel) => (channel === toggled ? !visible.includes(channel) : visible.includes(channel)))
  )

export type ChatSize = Readonly<{ width: number; height: number }>

export const chat_size_from = (value: unknown): ChatSize | null => {
  if (!value || typeof value !== 'object') return null
  const width: unknown = Reflect.get(value, 'width')
  const height: unknown = Reflect.get(value, 'height')
  return [width, height].every(
    (dimension) => typeof dimension === 'number' && Number.isFinite(dimension) && dimension > 0
  )
    ? Object.freeze({ width: width as number, height: height as number })
    : null
}
