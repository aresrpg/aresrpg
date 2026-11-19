// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect } from 'bun:test'

import { create_connected } from '../../src/connected.ts'
import { load_copies } from '../../src/copy.ts'
import type { Card, Telegram } from '../../src/transport.ts'

import { fixture, limits } from './connected_fixture.ts'

export const input = (id: number, value: string, callback = false, language_code = 'en') =>
  new Request('https://companion.example/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'fixture' },
    body: JSON.stringify(
      callback
        ? {
            update_id: id,
            callback_query: {
              id: `query-${id}`,
              from: { id: 42, is_bot: false, language_code },
              message: { chat: { id: 42, type: 'private' } },
              data: value,
            },
          }
        : {
            update_id: id,
            message: { from: { id: 42, is_bot: false, language_code }, chat: { id: 42, type: 'private' }, text: value },
          }
    ),
  })
export const copies = await load_copies()
export const en = copies('en')
export const plain = (shown: Card) => shown.text.replaceAll('\\', '')
export const buttons = (shown: Card) => shown.reply_markup.inline_keyboard.flat().map((button) => button.callback_data)
export const labels = (shown: Card) => shown.reply_markup.inline_keyboard.flat().map((button) => button.text)
export const link_url = (shown: Card) => plain(shown).split('\n').at(-1)!

export const setup = async (replaced: Readonly<{ telegram?: Partial<Telegram> }> = {}) => {
  const f = fixture()
  const cards: Card[] = []
  const acknowledgments: string[] = []
  // While set, Telegram accepts no message: every reply to the player is lost.
  const outage = { delivery: false }
  const runtime = create_connected({
    access: f.access,
    links: f.links,
    telegram: {
      send: async (_sender, card) => {
        if (outage.delivery) throw new Error('telegram_delivery_failed')
        // eslint-disable-next-line fp-law/no-mutating-methods -- The fixture records what the player received.
        cards.push(card)
      },
      acknowledge: async (id) => {
        // eslint-disable-next-line fp-law/no-mutating-methods -- The fixture records what Telegram was told.
        acknowledgments.push(id)
      },
      ...replaced.telegram,
    },
    copy: copies,
    secret: 'fixture',
    max_request_bytes: 4096,
    review_ttl_ms: limits.proposal_ttl_ms,
    now: () => f.clock.now,
  })
  const update = { id: 100 }
  const last = () => cards.at(-1)!
  /** A typed message; answers the last card the player received. */
  const say = async (text: string) => {
    await runtime.fetch(input(++update.id, text))
    return last()
  }
  /** Presses the button of the last card whose label or data starts with `match`. */
  const press = async (match: string) => {
    const button = last()
      .reply_markup.inline_keyboard.flat()
      .find(({ text, callback_data }) => text.startsWith(match) || callback_data.startsWith(match))
    if (!button) throw new Error(`no button "${match}" on: ${plain(last())}`)
    await runtime.fetch(input(++update.id, button.callback_data, true))
    return last()
  }
  /** Menu, hero, Play, strategy: ends on the review card. `launch` also approves it. */
  const review = async (name: string, strategy: string) => {
    await say('/menu')
    await press(name)
    await press('play:')
    return press(en.strategies[strategy]!)
  }
  const launch = async (name: string, strategy: string) => {
    await review(name, strategy)
    return press('approve:')
  }
  return { ...f, cards, acknowledgments, outage, runtime, say, press, review, launch, last }
}
export const linked = async () => {
  const f = await setup()
  await f.link()
  return f
}
export const calls = (f: Awaited<ReturnType<typeof setup>>, match: (url: string, name?: string) => boolean) =>
  f.sent.filter(({ url, body }) => match(url, body.params?.name)).length
export const tree_area = (run: { script: any } | undefined) =>
  run?.script.tree.child.children[0].action.target_options.area

// Without update deduplication, Telegram may deliver the same update again (it retries non-2xx).
// Each mutating input is guarded by its own phase or revision: the redelivery acts once and is answered.
export const redeliver = async (f: Awaited<ReturnType<typeof setup>>, update: () => Request) => {
  const before = f.cards.length
  expect((await f.runtime.fetch(update())).status).toBe(200)
  const first = f.cards.length
  expect((await f.runtime.fetch(update())).status).toBe(200)
  expect(first).toBeGreaterThan(before)
  expect(f.cards.length).toBeGreaterThan(first)
}
