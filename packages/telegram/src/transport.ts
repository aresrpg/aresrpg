// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { post_json, type BotFetch } from '@aresrpg/protocol/hosted-bot-client'

/** A button acts in the chat (`callback_data`) or opens a page (`url`). */
type Button = Readonly<{ text: string; callback_data: string } | { text: string; url: string }>
/** One Telegram message: escaped text, the buttons under it, and an optional picture above it. */
export type Card = Readonly<{
  text: string
  parse_mode: 'MarkdownV2'
  reply_markup: { inline_keyboard: readonly (readonly Button[])[] }
  /** A public image address. The text becomes its caption. */
  photo?: string
}>
const escape_markdown = (value: string) => value.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
export const button = (text: string, callback_data: string) => ({ text, callback_data })
/** Telegram's crawlers never fetch a button address, so a one-use page is safe here. */
export const page_button = (text: string, url: string) => ({ text, url })
export const card = (text: string, buttons: Card['reply_markup']['inline_keyboard'] = []): Card => ({
  text: escape_markdown(text),
  parse_mode: 'MarkdownV2',
  reply_markup: { inline_keyboard: buttons },
})

export const create_telegram = (token: string, timeout_ms: number, http: BotFetch = fetch) => {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('telegram_token_required')
  const call = async (method: string, body: object) => {
    const reply = await post_json(http, `https://api.telegram.org/bot${token}/${method}`, body, { timeout_ms })
    if (!reply.ok || reply.value.body.ok !== true) throw new Error('telegram_delivery_failed')
    return reply.value.body.result
  }
  return {
    /** The bot's public name, asked from Telegram: it addresses the chat from a browser. */
    username: async (): Promise<string> => {
      const { username } = (await call('getMe', {})) as { username?: unknown }
      if (typeof username !== 'string' || !/^\w+$/.test(username)) throw new Error('telegram_identity_unknown')
      return username
    },
    send: (sender: number, { photo, text, ...card }: Card) =>
      photo
        ? call('sendPhoto', { chat_id: sender, photo, caption: text, ...card })
        : call('sendMessage', { chat_id: sender, text, ...card, link_preview_options: { is_disabled: true } }),
    acknowledge: (id: string) => call('answerCallbackQuery', { callback_query_id: id }),
  }
}
export type Telegram = ReturnType<typeof create_telegram>
