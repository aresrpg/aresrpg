// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type Input = Readonly<{
  update_id: number
  sender: number
  locale: string
  text: string
  callback_id?: string
}>
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const positive_id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const locale_of = (value: unknown) => (typeof value === 'string' ? value.split('-')[0]! : 'en')
const source_of = (update: Record<string, unknown>) => {
  const callback = record(update.callback_query)
  const message = record(update.message ?? callback.message)
  return {
    message,
    sender: record(update.message ? message.from : callback.from),
    text: update.message ? message.text : callback.data,
    callback_id: update.message ? undefined : callback.id,
    is_callback: !update.message,
  }
}
const private_message = (source: ReturnType<typeof source_of>) => {
  const { message, sender } = source
  const chat = record(message.chat)
  return (
    [positive_id(sender.id), sender.is_bot === false, chat.type === 'private', chat.id === sender.id].every(Boolean) &&
    ![message.forward_origin, message.forward_date, message.via_bot].some(Boolean)
  )
}
// Only ordinary private messages and callbacks are accepted. Edited/forwarded messages never carry intent.
export const decode_update = (value: unknown): Input | null => {
  const update = record(value)
  const source = source_of(update)
  if (
    ![
      Number.isSafeInteger(update.update_id),
      Number(update.update_id) >= 0,
      private_message(source),
      !update.edited_message,
    ].every(Boolean)
  )
    return null
  if (typeof source.text !== 'string') return null
  if (source.is_callback && typeof source.callback_id !== 'string') return null
  return {
    update_id: update.update_id as number,
    sender: source.sender.id as number,
    locale: locale_of(source.sender.language_code),
    text: source.text,
    callback_id: source.callback_id as string | undefined,
  }
}
