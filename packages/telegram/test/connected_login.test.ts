// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { PLAY_SCOPE, type BotGrant } from '@aresrpg/protocol/hosted-bot-client'

import { user_id } from '../src/link.ts'
import { card, type Card } from '../src/transport.ts'

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
  log_in,
  plain,
  redeliver,
  setup,
  start_token,
} from './helpers/runtime_fixture.ts'

type Runtime = Awaited<ReturnType<typeof setup>>
const registered = (f: Runtime) => calls(f, (url) => url.endsWith('/oauth/register'))
const revoked = (f: Runtime) => calls(f, (url) => url.endsWith('/oauth/revoke'))
const link_of = (url: string) => new URL(url).pathname.slice(6)

test('one tap: the welcome button is the login page, its return carries a one-use token, and START links the chat', async () => {
  const f = await setup()
  const welcome = await f.say('/start')
  expect(plain(welcome)).toBe(en.welcome)
  expect(welcome.reply_markup.inline_keyboard).toEqual([
    [{ text: en.connect_google, url: expect.stringMatching(/^https:\/\/companion\.example\/link\/[\w-]+$/) }],
  ])
  const shown = f.cards.length
  const { opened, returned, returning } = await log_in(f)
  expect(opened.status).toBe(302)
  expect(new URL(opened.headers.get('location')!).searchParams.get('scope')).toBe(PLAY_SCOPE)
  // The browser goes back to the chat with a one-use token as Telegram's start parameter, which allows
  // only A-Z a-z 0-9 _ - and at most 64 characters.
  expect(returned.status).toBe(303)
  const location = new URL(returned.headers.get('location')!)
  expect(`${location.origin}${location.pathname}`).toBe('https://t.me/fixture_bot')
  expect([...location.searchParams.keys()]).toEqual(['start'])
  const token = start_token(returned)
  expect(token).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  // Until the chat confirms, the login gives it nothing: no link, no card, no read of the account.
  expect(await f.user()).toBeNull()
  expect(f.cards).toHaveLength(shown)
  expect(f.bot.sent('bot_observe')).toEqual([])
  // The same return mints no second token.
  expect((await returning()).status).toBe(410)
  // The player taps START: Telegram sends the token from the chat that asked, and the chat gets its menu.
  const menu = await f.say(`/start ${token}`)
  expect(await f.user()).toMatchObject({ identity, scope: PLAY_SCOPE })
  expect(await f.attempts()).toEqual([])
  expect(f.cards).toHaveLength(shown + 1)
  expect(buttons(menu)).toContain('/status')
  expect(f.bot.sent('bot_observe')).toHaveLength(1)
  // One use: the link opens nothing more, and the same return is refused without a second exchange.
  expect((await f.runtime.fetch(new Request(link_url(welcome)))).status).toBe(410)
  expect((await returning()).status).toBe(400)
  expect(calls(f, (url) => url.endsWith('/oauth/token'))).toBe(1)
  expect(registered(f)).toBe(1)
  // The token is never shown: no card carries it as text or as a button.
  expect(JSON.stringify(f.cards)).not.toContain(token)
})

// Security review 2026-11-21 (P1): an attacker began a login in their own chat and never opened it. Any
// web page sent a signed-in player through that link; the page signed in and approved by itself, and the
// browser's return linked the ATTACKER's chat to the PLAYER's account with play scope and no click.
test('drive-by: a victim sent through an attacker’s login link lands in their own chat, and the attacker’s chat gets nothing', async () => {
  const [attacker, victim] = [43, 42]
  const delivered: { sender: number; card: Card }[] = []
  const logged = spyOn(console, 'error')
  const f = await setup({
    telegram: {
      send: async (sender, shown) => {
        delivered.push({ sender, card: shown })
      },
    },
  })
  const received = (sender: number) => delivered.filter((entry) => entry.sender === sender).map((entry) => entry.card)
  await f.runtime.fetch(input(1, '/start', false, 'en', attacker))
  const [bait] = received(attacker)
  // The victim's browser opens the attacker's link: it gets the cookie, signs in silently and returns.
  const { returned } = await log_in(f, bait)
  expect(returned.status).toBe(303)
  const token = start_token(returned)
  // The deep link opens the victim's own Telegram: START arrives from the victim's chat and is refused.
  await f.runtime.fetch(input(2, `/start ${token}`, false, 'en', victim))
  expect([await f.user(attacker), await f.user(victim)]).toEqual([null, null])
  expect(await f.links.sender_of(identity.owner)).toBeNull()
  // The victim's chat gets its ordinary card: the welcome with its own login page. Nothing is revealed.
  const [answer] = received(victim)
  expect(received(victim)).toHaveLength(1)
  expect(plain(answer!)).toBe(en.welcome)
  expect(link_url(answer!)).not.toBe(link_url(bait!))
  // The attacker's chat received nothing, its attempt was not touched, and the bot was asked only who signed in.
  expect(received(attacker)).toHaveLength(1)
  const phases = Object.fromEntries((await f.attempts()).map(({ sender, phase }) => [sender, phase]))
  expect(phases).toEqual({ [attacker]: 'confirm', [victim]: 'new' })
  expect(f.bot.calls.map(({ name }) => name)).toEqual(['bot_identity'])
  expect(revoked(f)).toBe(0)
  // The attacker never learns the token: it reached no chat and no log.
  expect(JSON.stringify(delivered)).not.toContain(token)
  expect(JSON.stringify(logged.mock.calls)).not.toContain(token)
  logged.mockRestore()
  // Past its deadline the unconfirmed attempt is retired and the victim's grant is revoked: the
  // attacker's next message shows the welcome, never the victim's account.
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at
  await f.runtime.fetch(input(3, '/menu', false, 'en', attacker))
  expect(revoked(f)).toBe(1)
  expect(plain(received(attacker).at(-1)!)).toBe(en.welcome)
  expect([await f.user(attacker), await f.user(victim)]).toEqual([null, null])
  expect(f.bot.calls.map(({ name }) => name)).toEqual(['bot_identity'])
})

test('two chats that hold the same account: the second START is told to disconnect first and is not linked', async () => {
  const f = await setup()
  const first = await f.signed_in(42)
  f.issued.refresh_token = 'second-refresh'
  const second = await f.signed_in(43)
  expect(buttons(await f.say(`/start ${first}`))).toContain('/status')
  await f.runtime.fetch(input(50, `/start ${second}`, false, 'en', 43))
  expect(f.last().text).toBe(card(en.failure_unlink_first).text)
  expect(buttons(f.last())).toEqual(['/unlink'])
  expect(await f.user(43)).toBeNull()
  expect(await f.links.sender_of(identity.owner)).toBe(42)
  // The refused login leaves no grant and no attempt behind.
  expect(f.sent.filter(({ url }) => url.endsWith('/oauth/revoke')).map(({ body }) => body.token)).toEqual([
    'second-refresh',
  ])
  expect(await f.attempts()).toEqual([])
})

test('returning to the chat without tapping START ends the unconfirmed login and offers a new one', async () => {
  const f = await setup()
  const welcome = await f.say('/start')
  const { returned } = await log_in(f)
  // START with no token is the ordinary update: the welcome, with a new login page.
  const again = await f.say('/start')
  expect(plain(again)).toBe(en.welcome)
  expect(link_url(again)).not.toBe(link_url(welcome))
  expect(revoked(f)).toBe(1)
  expect(await f.user()).toBeNull()
  // The ended login's token confirms nothing, and the chat keeps the login page it was just offered.
  const late = await f.say(`/start ${start_token(returned)}`)
  expect(plain(late)).toBe(en.welcome)
  expect(link_url(late)).toBe(link_url(again))
  expect(await f.user()).toBeNull()
  expect(f.bot.sent('bot_observe')).toEqual([])
})

test('a redelivered /start, /link, /join or /unlink acts once and is answered again', async () => {
  const f = await setup()
  await redeliver(f, () => input(20, '/start'))
  await redeliver(f, () => input(21, '/link'))
  expect(registered(f)).toBe(1)
  expect(new Set(f.cards.map(link_url)).size).toBe(1)
  const waiting = await setup()
  await waiting.link()
  await waiting.access.remove(identity.owner)
  await redeliver(waiting, () => input(22, '/join'))
  expect((await waiting.access.waiting()).map(({ owner }) => owner)).toEqual([identity.owner])
  const unlinking = await linked()
  const revokes = revoked(unlinking)
  await redeliver(unlinking, () => input(23, '/unlink'))
  expect(revoked(unlinking)).toBe(revokes + 1)
  // START is redelivered with the same token: it links once, and the second delivery shows the menu.
  const confirming = await setup()
  await confirming.say('/start')
  const token = start_token((await log_in(confirming)).returned)
  await redeliver(confirming, () => input(24, `/start ${token}`))
  expect((await confirming.user())?.refresh_token).toBe('refresh')
  expect(calls(confirming, (url) => url.endsWith('/oauth/token'))).toBe(1)
  expect(buttons(confirming.last())).toContain('/status')
})

// The two-step flow had `/enable` (a second consent): it does not exist. `/start <token>` confirms only
// the chat's own held login; any other token is ordinary text that confirms and enables nothing.
test('/enable and a /start with a token that is not the chat’s are ordinary updates in every state of a chat', async () => {
  const removed = ['/enable', '/start one-use-code']
  const unlinked = await setup()
  const welcome = await unlinked.say('/start')
  for (const text of removed) {
    const shown = await unlinked.say(text)
    expect(plain(shown)).toBe(en.welcome)
    expect(link_url(shown)).toBe(link_url(welcome))
  }
  expect(await unlinked.user()).toBeNull()
  expect(registered(unlinked)).toBe(1)
  const waiting = await linked()
  await waiting.access.remove(identity.owner)
  for (const text of removed) expect(plain(await waiting.say(text))).toBe(en.waiting)
  const playing = await linked()
  const menu = plain(await playing.say('/menu'))
  for (const text of removed) expect(plain(await playing.say(text))).toBe(menu)
  for (const f of [waiting, playing]) {
    expect([registered(f), revoked(f)]).toEqual([1, 0])
    expect((await f.user())?.refresh_token).toBe('refresh')
  }
})

test('a link is bound to the chat that asked: a return in another browser links nothing', async () => {
  const f = await setup()
  const welcome = await f.say('/start')
  const shown = f.cards.length
  const { returned } = await log_in(f, welcome, '__Host-ares-telegram=another-browser')
  expect(returned.status).toBe(400)
  expect(await returned.text()).toBe(en.browser_expired)
  expect(await f.user()).toBeNull()
  expect(f.cards).toHaveLength(shown)
  expect(calls(f, (url) => url.endsWith('/oauth/token'))).toBe(0)
})

test('a confirmed login whose card cannot be delivered is linked; the redelivered START shows the card', async () => {
  const f = await setup()
  await f.say('/start')
  const shown = f.cards.length
  const token = start_token((await log_in(f)).returned)
  f.outage.delivery = true
  // Telegram redelivers an update that is not answered 2xx.
  expect((await f.runtime.fetch(input(30, `/start ${token}`))).status).toBe(503)
  expect(f.cards).toHaveLength(shown)
  expect((await f.user())?.identity).toEqual(identity)
  f.outage.delivery = false
  expect((await f.runtime.fetch(input(30, `/start ${token}`))).status).toBe(200)
  expect(buttons(f.last())).toContain('/status')
  expect(registered(f)).toBe(1)
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

// Regression (owner report 2026-11-22): an expired login answered a bare "Your login expired. Log in
// again:" line. It is the welcome again: its picture, what the bot is, and the one login button.
test('an expired login shows the welcome at once, with a new login button', async () => {
  const f = await linked()
  f.clock.now = identity.expires_at + 1
  const welcome = await f.say('/menu')
  expect(welcome.text).not.toBe(card(en.failure_reconnect).text)
  expect(welcome.photo).toBeDefined()
  expect(await f.links.current(42)).toBeNull()
  expect(plain(welcome)).toBe(en.welcome)
  expect(link_url(welcome)).toStartWith('https://companion.example/link/')
})

// A login made by the two-step flow asked for view-only scope first. It is not migrated: it gets the
// welcome as any login that ended, and the new login holds play scope.
test('a view-only login stored by the two-step flow gets the welcome, then plays', async () => {
  const f = await linked()
  await f.records.change([user_id(42)], (get) => ({
    [user_id(42)]: { value: { ...get<BotGrant>(user_id(42))!, scope: 'bot:observe' } },
  }))
  const reached = f.bot.calls.length
  f.issued.refresh_token = 'play-refresh'
  const welcome = await f.say('/menu')
  expect(f.bot.calls).toHaveLength(reached)
  // The old grant is ended at the bot, never left behind.
  expect(f.sent.filter(({ url }) => url.endsWith('/oauth/revoke')).map(({ body }) => body.token)).toEqual(['refresh'])
  expect(plain(welcome)).toBe(en.welcome)
  const { returned } = await log_in(f)
  expect(returned.status).toBe(303)
  await f.say(`/start ${start_token(returned)}`)
  expect(await f.user()).toMatchObject({ scope: PLAY_SCOPE, refresh_token: 'play-refresh' })
  expect(buttons(f.last())).toContain('/status')
})

test('Log in again in a working chat keeps its login and shows the menu', async () => {
  const f = await linked()
  expect(buttons(await f.say('/link'))).toContain('/status')
  expect((await f.user())?.refresh_token).toBe('refresh')
  expect([registered(f), revoked(f)]).toEqual([1, 0])
})

test('a login returns the browser to the chat, never to a page that is kept; browser failures are localized pages', async () => {
  const f = await setup()
  const fr = copies('fr')
  await f.runtime.fetch(input(20, '/start', false, 'fr'))
  const welcome = f.last()
  expect(plain(welcome)).toBe(fr.welcome)
  const page = (await log_in(f)).returned
  expect(page.status).toBe(303)
  expect(page.headers.get('location')).toStartWith('https://t.me/fixture_bot?start=')
  // A login answer is never stored, and the next site never learns where the browser came from.
  expect(page.headers.get('cache-control')).toBe('no-store')
  expect(page.headers.get('referrer-policy')).toBe('no-referrer')
  // START comes from the chat: its card is in the chat's language.
  await f.runtime.fetch(input(21, `/start ${start_token(page)}`, false, 'fr'))
  expect(plain(f.last())).toContain(fr.menu)
  // The finished link is gone with its record: a later open is refused in the browser's own language.
  const reopened = await f.runtime.fetch(new Request(link_url(welcome), { headers: { 'Accept-Language': 'de' } }))
  expect(reopened.status).toBe(410)
  expect(await reopened.text()).toBe(copies('de').browser_expired)
  const unknown = await f.runtime.fetch(
    new Request('https://companion.example/oauth/callback?iss=https://bot.example&code=code&state=forged', {
      headers: { 'Accept-Language': 'de-DE,de;q=0.9' },
    })
  )
  expect(unknown.status).toBe(400)
  expect(await unknown.text()).toBe(copies('de').browser_expired)
  expect(unknown.headers.get('Cache-Control')).toBe('no-store')
})

test('an open link is refused a second browser in the language of the chat that asked', async () => {
  const f = await setup()
  await f.runtime.fetch(input(20, '/start', false, 'fr'))
  const first = await f.runtime.fetch(new Request(link_url(f.last())))
  expect(first.status).toBe(302)
  const second = await f.runtime.fetch(new Request(link_url(f.last())))
  expect([second.status, await second.text()]).toEqual([410, copies('fr').browser_expired])
})

// Every link attempt ends at the deadline set when it was created, whatever its phase. `kept` says
// whether an update of its still unlinked chat before that deadline leaves the attempt in place.
const attempt_phases = {
  new: { kept: true, reach: async (f: Runtime) => void (await f.links.begin(42)) },
  browser: { kept: false, reach: async (f: Runtime) => void (await f.start()) },
  // The exchange has no known outcome, so nothing can be revoked yet: the attempt is cancelled and waits.
  exchanging: {
    kept: true,
    reach: async (f: Runtime) => {
      const { browser, query } = await f.start()
      f.overrides.handler = async () => {
        throw new Error('exchange outcome unknown')
      }
      await f.links.callback(query, browser.cookie).catch(() => undefined)
      f.overrides.handler = undefined
    },
  },
  exchanged: { kept: false, reach: async (f: Runtime) => void (await f.exchanged()) },
  // The browser returned and the chat never tapped START: the held grant is revoked with the attempt.
  confirm: { kept: false, reach: async (f: Runtime) => void (await f.signed_in()) },
} as const
for (const [phase, { kept, reach }] of Object.entries(attempt_phases)) {
  test(`a ${phase} attempt past its deadline is retired on the next interaction, which offers a new link`, async () => {
    const f = await setup()
    await reach(f)
    const [attempt] = await f.attempts()
    f.clock.now = attempt!.authorization.expires_at
    const welcome = await f.say('/menu')
    expect(plain(welcome)).toBe(en.welcome)
    expect(link_of(link_url(welcome))).not.toBe(attempt!.id)
    expect((await f.attempts()).map(({ id }) => id)).toEqual([link_of(link_url(welcome))])
    expect(await f.records.ids('attempts:')).toEqual(['attempts:42'])
    expect(revoked(f)).toBe(Number(Boolean(attempt!.tokens)))
    expect(await f.user()).toBeNull()
  })
  test(`before its deadline, an update of the chat ${kept ? 'keeps' : 'ends and replaces'} a ${phase} attempt`, async () => {
    const f = await setup()
    await reach(f)
    const [attempt] = await f.attempts()
    f.clock.now = attempt!.authorization.expires_at - 1
    const welcome = await f.say('/menu')
    const offered = link_of(link_url(welcome))
    const ids = (await f.attempts()).map(({ id }) => id)
    expect(ids.includes(attempt!.id)).toBe(kept)
    expect(ids).toContain(offered)
    // Only an unopened link is offered again; an opened one never is, whatever became of it.
    expect(offered === attempt!.id).toBe(phase === 'new')
    expect(revoked(f)).toBe(Number(Boolean(attempt!.tokens)))
    expect(await f.user()).toBeNull()
  })
}

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

test('a revoked grant shows the welcome at once, with a new login button', async () => {
  const f = await linked()
  // The hosted bot answers a revoked grant with HTTP 401, to its token before any tool runs and to its refresh.
  f.overrides.handler = async (url) => {
    if (['/mcp', '/oauth/token'].some((path) => url.endsWith(path)))
      return Response.json({ error: 'invalid_token' }, { status: 401 })
    return Response.json(url.endsWith('/oauth/register') ? { client_id: 'client' } : {})
  }
  const welcome = await f.say('/menu')
  expect(await f.links.current(42)).toBeNull()
  expect(plain(welcome)).toBe(en.welcome)
  expect(link_url(welcome)).toStartWith('https://companion.example/link/')
})

test('a refused token refresh shows the welcome at once', async () => {
  const f = await linked()
  await f.expire()
  f.overrides.handler = async (url, init) =>
    url.endsWith('/oauth/token') ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : f.respond(url, init)
  const refused = await f.say('/menu')
  expect(plain(refused)).toBe(en.welcome)
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

test('a new chat is welcomed under a picture and logs in with one button, in every language', async () => {
  const f = await setup()
  const welcome = await f.say('/start')
  expect(welcome.photo).toStartWith('https://')
  expect(plain(welcome)).toBe(en.welcome)
  expect(labels(welcome)).toEqual([en.connect_google])
  // No message asks the player to type a command: every step has a button. A photo caption holds 1024 characters.
  for (const locale of ['en', 'fr', 'de', 'es', 'pt', 'ru', 'uk', 'ja', 'ko', 'vi', 'zh']) {
    const { strategies, ...texts } = copies(locale)
    for (const text of [...Object.values(texts), ...Object.values(strategies)]) expect(text).not.toMatch(/\/[a-z]/)
    expect(card(copies(locale).welcome).text.length).toBeLessThanOrEqual(1024)
  }
})
