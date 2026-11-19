// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { post_json, type BotFetch } from '@aresrpg/protocol/hosted-bot-client'

/** One Telegram message: escaped text and the buttons under it. */
export type Card = Readonly<{
  text: string
  parse_mode: 'MarkdownV2'
  reply_markup: { inline_keyboard: readonly (readonly { text: string; callback_data: string }[])[] }
}>
const escape_markdown = (value: string) => value.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
export const button = (text: string, callback_data: string) => ({ text, callback_data })
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
  }
  return {
    send: (sender: number, card: Card) =>
      call('sendMessage', { chat_id: sender, ...card, link_preview_options: { is_disabled: true } }),
    acknowledge: (id: string) => call('answerCallbackQuery', { callback_query_id: id }),
  }
}
export type Telegram = ReturnType<typeof create_telegram>
