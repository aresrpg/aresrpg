// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { button, card, create_telegram, page_button } from '../src/transport.ts'

test('Telegram delivery disables previews so pairing URLs are not consumed by preview crawlers', async () => {
  let sent: any
  const telegram = create_telegram('123:fixture', 1000, async (_url, init) => {
    sent = JSON.parse(String(init.body))
    return Response.json({ ok: true })
  })
  await telegram.send(42, card('https://companion.example/link/one-use'))
  expect(sent.link_preview_options).toEqual({ is_disabled: true })
})

test('a card with a picture is one photo message: the text is its caption and the buttons stay under it', async () => {
  const calls: { method: string; body: any }[] = []
  const telegram = create_telegram('123:fixture', 1000, async (url, init) => {
    calls.push({ method: String(url).split('/').at(-1)!, body: JSON.parse(String(init.body)) })
    return Response.json({ ok: true })
  })
  const buttons = [[button('Log in', '/link'), page_button('Open', 'https://companion.example/link/one-use')]]
  await telegram.send(42, { ...card('Welcome.', buttons), photo: 'https://game.example/banner.png' })
  expect(calls).toEqual([
    {
      method: 'sendPhoto',
      body: {
        chat_id: 42,
        photo: 'https://game.example/banner.png',
        caption: 'Welcome\\.',
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: buttons },
      },
    },
  ])
})

test('the bot name comes from Telegram and only a plain name is accepted', async () => {
  const named = (username: unknown) =>
    create_telegram('123:fixture', 1000, async () => Response.json({ ok: true, result: { username } })).username()
  expect(await named('aresrpg_bot')).toBe('aresrpg_bot')
  await expect(named('bad/name?start=x')).rejects.toThrow('telegram_identity_unknown')
  await expect(named(undefined)).rejects.toThrow('telegram_identity_unknown')
})
