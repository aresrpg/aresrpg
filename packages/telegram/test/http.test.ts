// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { read_update, secret_matches } from '../src/http.ts'

const message = { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, text: '/menu' }
const request = (body: string, init: Readonly<{ secret?: string; path?: string; method?: string }> = {}) =>
  new Request(`https://companion.example${init.path ?? '/telegram'}`, {
    method: init.method ?? 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': init.secret ?? 'fixture' },
    body: init.method === 'GET' ? undefined : body,
  })
const read = (body: unknown, init?: Parameters<typeof request>[1]) =>
  read_update(request(typeof body === 'string' ? body : JSON.stringify(body), init), 'fixture', 1024)
const status = async (body: unknown, init?: Parameters<typeof request>[1]) => {
  const result = await read(body, init)
  return result instanceof Response ? result.status : result
}

test('only an authentic, bounded, well-formed request reaches the update decoder', async () => {
  const update = { update_id: 1, message }
  expect(await status(update, { path: '/other' })).toBe(404)
  expect(await status(update, { method: 'PUT' })).toBe(404)
  expect(await status(update, { secret: 'fixtur' })).toBe(403)
  expect(await status(update, { secret: '' })).toBe(403)
  expect(await status({ ...update, padding: 'x'.repeat(1024) })).toBe(413)
  expect(await status('{"update_id":')).toBe(400)
  // A listener without a secret refuses everything, including a request that sends none.
  expect([secret_matches(null, ''), secret_matches('', ''), secret_matches('fixture', 'fixture')]).toEqual([
    false,
    false,
    true,
  ])
  expect(await read(update)).toEqual({ update_id: 1, sender: 42, locale: 'en', text: '/menu', callback_id: undefined })
})

// Telegram redelivers every update that is not answered 2xx, so nothing authentic may be refused.
test('an authentic update the bot does not act on is acknowledged instead of redelivered', async () => {
  const ignored = {
    group: { update_id: 2, message: { ...message, chat: { id: -100, type: 'supergroup' } } },
    edited: { update_id: 3, edited_message: message },
    forwarded: { update_id: 4, message: { ...message, forward_origin: { type: 'user' } } },
    media: { update_id: 5, message: { ...message, text: undefined, sticker: {} } },
    membership: { update_id: 6, my_chat_member: { chat: { id: 42, type: 'private' }, from: { id: 42 } } },
    inline_callback: { update_id: 7, callback_query: { id: 'query', from: { id: 42, is_bot: false }, data: '/menu' } },
    not_an_update: [],
  }
  for (const [kind, update] of Object.entries(ignored)) expect([kind, await status(update)]).toEqual([kind, 200])
})
