// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { card } from '../src/transport.ts'

import { MIRA, identity, limits } from './helpers/connected_fixture.ts'
import {
  buttons,
  calls,
  copies,
  en,
  input,
  labels,
  link_url,
  linked,
  plain,
  redeliver,
  setup,
} from './helpers/runtime_fixture.ts'

test('a redelivered /link, /enable, /join or /unlink acts once and is answered again', async () => {
  const f = await setup()
  await redeliver(f, () => input(20, '/link'))
  expect(calls(f, (url) => url.endsWith('/oauth/register'))).toBe(1)
  expect(link_url(f.last())).toBe(link_url(f.cards.at(-2)!))
  const waiting = await setup()
  await waiting.identify()
  await waiting.access.remove(identity.owner)
  await redeliver(waiting, () => input(21, '/join'))
  expect((await waiting.access.waiting()).map(({ owner }) => owner)).toEqual([identity.owner])
  await waiting.access.admit(identity.owner)
  await redeliver(waiting, () => input(22, '/enable'))
  expect(calls(waiting, (url) => url.endsWith('/oauth/register'))).toBe(2)
  expect(link_url(waiting.last())).toBe(link_url(waiting.cards.at(-2)!))
  const unlinking = await linked()
  const revokes = calls(unlinking, (url) => url.endsWith('/oauth/revoke'))
  await redeliver(unlinking, () => input(23, '/unlink'))
  expect(calls(unlinking, (url) => url.endsWith('/oauth/revoke'))).toBe(revokes + 1)
})

test('a redelivered return from the browser links once and the repeat shows the current state', async () => {
  const f = await setup()
  await f.runtime.fetch(input(30, '/link'))
  const opened = await f.runtime.fetch(new Request(link_url(f.last())))
  const state = new URL(opened.headers.get('location')!).searchParams.get('state')!
  const shown_before = f.cards.length
  const page = await f.runtime.fetch(
    new Request(`https://companion.example/oauth/callback?iss=https://bot.example&code=code&state=${state}`, {
      headers: { cookie: opened.headers.get('set-cookie')!.split(';')[0]! },
    })
  )
  // Regression: the service sent the code to the chat that began the link. Whoever began it could then
  // confirm a login made in another person's browser, and bind their chat to that person's bot. Only
  // the browser that consented carries the code, back to its own account; the chat receives nothing.
  expect(page.status).toBe(303)
  const returning = new URL(page.headers.get('location')!)
  expect(returning.origin + returning.pathname).toBe('https://t.me/fixture_bot')
  const code = returning.searchParams.get('start')!
  expect(f.cards).toHaveLength(shown_before)
  expect(f.cards.some((shown) => shown.text.includes(code))).toBe(false)
  await redeliver(f, () => input(31, `/start ${code}`))
  expect((await f.user())?.identity).toEqual(identity)
  expect(await f.attempts()).toEqual([])
  expect(f.cards.some((shown) => shown.text === card(en.failure_changed).text)).toBe(true)
})

test('an unlinked sender leaves no navigation state, and unlinking removes it', async () => {
  const f = await setup()
  for (const text of ['/menu', '/start', 'hello']) await f.say(text)
  expect(f.runtime.sessions.has(42)).toBe(false)
  await f.link()
  await f.say('/menu')
  expect(f.runtime.sessions.get(42)?.revision).toBe(1)
  await f.say('/unlink')
  expect(f.runtime.sessions.has(42)).toBe(false)
})

test('a refusal whose reply cannot be delivered asks Telegram to redeliver', async () => {
  const f = await setup({
    telegram: {
      send: async () => {
        throw new Error('telegram_delivery_failed')
      },
    },
  })
  await f.link()
  expect((await f.runtime.fetch(input(11, 'approve:1', true))).status).toBe(503)
})

test('an expired login offers one Log in again step that replaces the login', async () => {
  const f = await linked()
  f.clock.now = identity.expires_at + 1
  const expired = await f.say('/menu')
  expect(expired.text).toBe(card(en.failure_reconnect).text)
  expect(buttons(expired)).toEqual(['/link'])
  await f.say('/link')
  expect(await f.links.current(42)).toBeNull()
  expect(link_url(f.last())).toStartWith('https://companion.example/link/')
})

test('relinking a linked chat names the unlink step instead of a dead end', async () => {
  const f = await linked()
  expect((await f.say('/link')).text).toBe(card(en.failure_unlink_first).text)
})

test('a login returns the browser to the chat, never to a page that is kept; browser failures are localized pages', async () => {
  const f = await setup()
  const fr = copies('fr')
  await f.runtime.fetch(input(20, '/link', false, 'fr'))
  const opened = await f.runtime.fetch(new Request(link_url(f.last())))
  const cookie = opened.headers.get('set-cookie')!.split(';')[0]!
  const state = new URL(opened.headers.get('location')!).searchParams.get('state')!
  const page = await f.runtime.fetch(
    new Request(`https://companion.example/oauth/callback?iss=https://bot.example&code=code&state=${state}`, {
      headers: { cookie },
    })
  )
  expect(page.status).toBe(303)
  expect(page.headers.get('location')).toStartWith('https://t.me/fixture_bot?start=')
  // The address holds a one-use code: no cache keeps it and the next site never learns it.
  expect(page.headers.get('cache-control')).toBe('no-store')
  expect(page.headers.get('referrer-policy')).toBe('no-referrer')
  // A second open of the same link is refused in the starter's language with a readable page.
  const reopened = await f.runtime.fetch(new Request(link_url(f.last())))
  expect(reopened.status).toBe(410)
  expect(await reopened.text()).toBe(fr.browser_expired)
  const unknown = await f.runtime.fetch(
    new Request('https://companion.example/oauth/callback?iss=https://bot.example&code=code&state=forged', {
      headers: { 'Accept-Language': 'de-DE,de;q=0.9' },
    })
  )
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).toBe(copies('de').browser_expired)
  expect(unknown.headers.get('Cache-Control')).toBe('no-store')
})

// Every link attempt ends at the deadline set when it was created, whatever its phase.
const attempt_phases = {
  new: async (f: Awaited<ReturnType<typeof setup>>) => void (await f.links.begin(42)),
  browser: async (f: Awaited<ReturnType<typeof setup>>) => void (await f.start()),
  exchanging: async (f: Awaited<ReturnType<typeof setup>>) => {
    const { browser, query } = await f.start()
    f.overrides.handler = async () => {
      throw new Error('exchange outcome unknown')
    }
    await f.links.callback(query, browser.cookie).catch(() => undefined)
    f.overrides.handler = undefined
  },
  exchanged: async (f: Awaited<ReturnType<typeof setup>>) => {
    const { browser, query } = await f.start()
    f.overrides.handler = async (url, init) => {
      if (JSON.parse(String(init.body)).params?.name === 'bot_identity') throw new Error('identity unavailable')
      return url.endsWith('/oauth/token')
        ? Response.json({
            access_token: 'a',
            refresh_token: 'r',
            token_type: 'Bearer',
            expires_in: 10,
            scope: 'bot:observe',
          })
        : Response.json({})
    }
    await f.links.callback(query, browser.cookie).catch(() => undefined)
    f.overrides.handler = undefined
  },
  confirm: async (f: Awaited<ReturnType<typeof setup>>) => {
    const { browser, query } = await f.start()
    await f.links.callback(query, browser.cookie)
  },
} as const
for (const [phase, reach] of Object.entries(attempt_phases))
  test(`a ${phase} attempt past its deadline is retired on the next interaction`, async () => {
    const f = await setup()
    await reach(f)
    const [attempt] = await f.attempts()
    const revokes = () => f.sent.filter(({ url }) => url.endsWith('/oauth/revoke')).length
    // Before its deadline the attempt is untouched by an interaction.
    f.clock.now = attempt!.authorization.expires_at - 1
    await f.say('/menu')
    expect(await f.attempts()).toHaveLength(1)
    f.clock.now += 1
    await f.say('/menu')
    expect(await f.attempts()).toEqual([])
    expect(await f.records.ids('attempts:')).toEqual([])
    expect(revokes()).toBe(Number(Boolean(attempt!.tokens)))
    // The ended attempt is refused, and the player is shown the login card again.
    await f.say(`/start ${attempt!.confirmation ?? 'ended'}`)
    expect(await f.user()).toBeNull()
    expect(buttons(f.last())).toContain('/link')
  })

test('an established link is not an attempt and never expires', async () => {
  const f = await linked()
  f.clock.now += limits.link_ttl_ms * 100
  await f.say('/menu')
  expect((await f.user())?.identity).toEqual(identity)
})

test('the webhook refuses a wrong secret and ignores an update it does not act on, touching nothing', async () => {
  const f = await linked()
  const hosted = f.sent.length
  const post = (body: unknown, headers: Record<string, string> = { 'X-Telegram-Bot-Api-Secret-Token': 'fixture' }) =>
    f.runtime.fetch(
      new Request('https://companion.example/telegram', { method: 'POST', headers, body: JSON.stringify(body) })
    )
  const message = { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' } }
  const pause = { update_id: 90, message: { ...message, text: '/pause' } }
  expect((await post(pause, {})).status).toBe(403)
  expect((await post(pause, { 'X-Telegram-Bot-Api-Secret-Token': 'guess' })).status).toBe(403)
  // Telegram redelivers every non-2xx update: a sticker or a membership change must not come back forever.
  expect((await post({ update_id: 90, message: { ...message, sticker: {} } })).status).toBe(200)
  expect((await post({ update_id: 91, my_chat_member: { chat: { id: 42, type: 'private' } } })).status).toBe(200)
  expect(f.cards).toEqual([])
  expect(f.acknowledgments).toEqual([])
  expect(f.sent).toHaveLength(hosted)
  expect(f.runtime.sessions.has(42)).toBe(false)
})

test('a refused callback acknowledgment never blocks the update', async () => {
  const f = await setup({
    telegram: {
      acknowledge: async () => {
        throw new Error('telegram_delivery_failed')
      },
    },
  })
  await f.link()
  await f.say('/menu')
  await f.press('Mira')
  expect(f.runtime.sessions.get(42)?.character).toBe(MIRA)
})

test('a revoked grant offers one Log in again step that replaces the login', async () => {
  const f = await linked()
  // The hosted bot answers a revoked grant with HTTP 401, to its token before any tool runs and to its refresh.
  f.overrides.handler = async (url) => {
    if (['/mcp', '/oauth/token'].some((path) => url.endsWith(path)))
      return Response.json({ error: 'invalid_token' }, { status: 401 })
    return Response.json(url.endsWith('/oauth/register') ? { client_id: 'client' } : {})
  }
  const revoked = await f.say('/menu')
  expect(revoked.text).toBe(card(en.failure_reconnect).text)
  expect(buttons(revoked)).toEqual(['/link'])
  await f.press('/link')
  expect(await f.links.current(42)).toBeNull()
  expect(link_url(f.last())).toStartWith('https://companion.example/link/')
})

test('a refused token refresh asks for a new login at once', async () => {
  const f = await linked()
  await f.expire()
  f.overrides.handler = async (url, init) =>
    url.endsWith('/oauth/token') ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : f.respond(url, init)
  const refused = await f.say('/menu')
  expect(refused.text).toBe(card(en.failure_reconnect).text)
  expect(buttons(refused)).toEqual(['/link'])
  expect(calls(f, (url) => url.endsWith('/oauth/token'))).toBe(3)
})

test('an unreachable hosted bot on a read asks to try again and claims no unknown outcome', async () => {
  const f = await linked()
  f.overrides.handler = async () => {
    throw new Error('connection refused')
  }
  const answer = await f.say('/menu')
  expect(answer.text).toBe(card(en.failure_temporary).text)
  expect(buttons(answer)).toEqual([])
})

test('a new chat is welcomed under a picture and logs in with buttons alone, in every language', async () => {
  const f = await setup()
  const welcome = await f.say('/start')
  expect(welcome.photo).toStartWith('https://')
  expect(plain(welcome)).toBe(en.welcome)
  expect(labels(welcome)).toEqual([en.connect_google])
  const login = await f.press(en.connect_google)
  expect(plain(login)).toBe(en.link)
  expect(labels(login)).toEqual([en.open_login])
  expect(link_url(login)).toStartWith('https://companion.example/link/')
  // No message asks the player to type a command: every step has a button. A photo caption holds 1024 characters.
  for (const locale of ['en', 'fr', 'de', 'es', 'pt', 'ru', 'uk', 'ja', 'ko', 'vi', 'zh']) {
    const { strategies, ...texts } = copies(locale)
    for (const text of [...Object.values(texts), ...Object.values(strategies)]) expect(text).not.toMatch(/\/[a-z]/)
    expect(card(copies(locale).welcome).text.length).toBeLessThanOrEqual(1024)
  }
})
