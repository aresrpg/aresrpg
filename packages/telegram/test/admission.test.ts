// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_request_limiter } from '@aresrpg/protocol/request-limiter'

import { admission_command } from '../src/admission.ts'
import { create_connected } from '../src/connected.ts'
import { load_copies } from '../src/copy.ts'
import { configuration, connected_configuration } from '../src/config.ts'

import { fixture, identity, limits } from './helpers/connected_fixture.ts'

const request = (id: number, text: string, sender = 42, chat = sender) =>
  new Request('https://companion.example/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'fixture' },
    body: JSON.stringify({
      update_id: id,
      message: { from: { id: sender, is_bot: false }, chat: { id: chat, type: 'private' }, text },
    }),
  })
const copy = await load_copies()
const en = copy('en')
type Limiters = Pick<Parameters<typeof create_connected>[0], 'visitor_limiter' | 'sender_limiter'>
/** A linked-or-not sender whose owner is not admitted, unless the test admits it. */
const setup = async (limiters: Limiters = {}) => {
  const f = fixture()
  await f.access.remove(identity.owner)
  const cards: string[] = []
  const runtime = create_connected({
    ...limiters,
    access: f.access,
    links: f.links,
    review_ttl_ms: limits.proposal_ttl_ms,
    telegram: {
      send: async (_sender, card) => {
        cards.push(card.text)
      },
      acknowledge: async () => undefined,
    },
    copy,
    secret: 'fixture',
    max_request_bytes: 4096,
  })
  return { ...f, cards, runtime }
}
const OTHER = `0x${'9'.repeat(64)}`
const cleanup_env = {
  TELEGRAM_STORAGE_KEY: 'ab'.repeat(32),
  TELEGRAM_CONNECTED_CONFIG: JSON.stringify({
    issuer: 'https://bot.example',
    callback_url: 'https://companion.example/oauth/callback',
    limits: { request_ms: 1000, link_ttl_ms: 10000 },
  }),
}
test('Google login precedes the waitlist; no text address or Telegram sender ID can grant admission', async () => {
  const f = await setup()
  await f.runtime.fetch(request(1, '/join'))
  expect(await f.access.joined(identity.owner)).toBe(false)
  expect(f.cards.at(-1)).toContain('Google')
  expect(f.sent).toHaveLength(0)
  await f.identify()
  expect((await f.links.current(42))?.scope).toBe('bot:observe')
  expect(await f.access.joined(identity.owner)).toBe(false)
  await f.runtime.fetch(request(2, `/join ${OTHER}`))
  expect(await f.access.waiting()).toEqual([])
  // A chat that is not the sender's own is acknowledged and ignored: it neither joins nor answers.
  const answered = f.cards.length
  expect((await f.runtime.fetch(request(3, '/join', 42, 99))).status).toBe(200)
  expect(f.cards).toHaveLength(answered)
  expect(await f.access.joined(identity.owner)).toBe(false)
  await f.runtime.fetch(request(4, '/join'))
  await f.runtime.fetch(request(4, '/join'))
  await f.runtime.fetch(request(5, '/join'))
  // Only the verified owner of this login is on the waitlist, once; joining admitted nobody.
  expect((await f.access.waiting()).map(({ owner }) => owner)).toEqual([identity.owner])
  expect(await f.access.admitted(identity.owner)).toBe(false)
  for (const [i, text] of [
    '/play',
    '/pause',
    '/resume',
    '/stop',
    '/status',
    '/inventory',
    'approve:1',
    'pause:1',
    'stop:1:all',
    'strategy:1:fight_nearby',
  ].entries())
    expect((await f.runtime.fetch(request(10 + i, text))).status).toBe(200)
  // A waiting owner reaches nothing of the hosted bot but its own identity.
  const reached = () => f.bot.calls.filter(({ name }) => name !== 'bot_identity')
  expect(reached()).toEqual([])
  await f.access.admit(identity.owner)
  // Admitted, but the login is read-only until the owner approves agent permissions.
  for (const [i, text] of ['/play', '/menu', '/pause', 'approve:1'].entries()) {
    await f.runtime.fetch(request(30 + i, text))
    expect(f.cards.at(-1)).toContain('permissions')
  }
  expect(reached()).toEqual([])
  const { browser, query } = await f.start(42, true)
  expect(new URL(browser.location).searchParams.get('scope')).toBe('bot:observe bot:play bot:pause')
  const result = await f.links.callback(query, browser.cookie)
  await f.links.confirm(42, result.code)
  await f.runtime.fetch(request(40, '/menu'))
  expect((await f.links.current(42))?.scope).toBe('bot:observe bot:play bot:pause')
  expect(reached().map(({ name }) => name)).toEqual(['bot_observe'])
})

// The cards a sender sees on the way in, in order. The running service reads the allowlist on each update.
test('one card per stage: log in, join the waitlist, on the waitlist, admitted; removal refuses the next update', async () => {
  const f = await setup()
  const last = async (id: number, text: string) => {
    await f.runtime.fetch(request(id, text))
    return f.cards.at(-1)!
  }
  const said = (card: string, text: string) => expect(card.replaceAll('\\', '')).toContain(text)
  said(await last(1, '/start'), en.link)
  await f.identify()
  said(await last(2, '/start'), en.waiting)
  said(await last(3, '/join'), en.on_waitlist)
  said(await last(4, '/start'), en.on_waitlist)
  await f.access.admit(identity.owner)
  said(await last(5, '/start'), en.play_consent)
  await f.access.remove(identity.owner)
  said(await last(6, '/start'), en.on_waitlist)
  expect([en.waiting, en.on_waitlist, en.join_waitlist].every((text) => /waitlist/i.test(text))).toBe(true)
})

test('the operator command lists, admits and removes exact owner addresses and refuses anything else', async () => {
  const f = fixture()
  await f.access.remove(identity.owner)
  await f.access.join(identity.owner)
  const run = (...args: string[]) =>
    admission_command(args, cleanup_env, f.access, f.backend, async () => Response.json({}))
  const listed = { waiting: [{ owner: identity.owner, joined_at: new Date(f.clock.now).toISOString() }], admitted: [] }
  expect(await run()).toEqual(listed)
  expect(await run('list')).toEqual(listed)
  expect(await run('admit', identity.owner)).toEqual({ waiting: [], admitted: [identity.owner] })
  expect(await f.access.admitted(identity.owner)).toBe(true)
  for (const invalid of [
    ['admit'],
    ['admit', '42'],
    ['admit', identity.owner.toUpperCase()],
    ['admit', identity.owner, OTHER],
    ['remove'],
    ['list', identity.owner],
    ['grant', identity.owner],
    ['--owner', identity.owner],
  ])
    await expect(run(...invalid)).rejects.toThrow('admission_command_invalid')
  expect(await f.access.admitted_owners()).toEqual([identity.owner])
  expect(await run('remove', identity.owner)).toEqual(listed)
})

test('removing an owner refuses it at once and revokes its Telegram login; a failed revoke can be run again', async () => {
  const f = fixture()
  await f.link()
  const revoked: string[] = []
  const offline = async () => {
    throw new Error('offline')
  }
  await expect(
    admission_command(['remove', identity.owner], cleanup_env, f.access, f.backend, offline)
  ).rejects.toThrow('unavailable')
  expect(await f.access.admitted(identity.owner)).toBe(false)
  expect((await f.user())?.refresh_token).toBe('refresh')
  await admission_command(['remove', identity.owner], cleanup_env, f.access, f.backend, async (_url, init) => {
    revoked.push(JSON.parse(String(init.body)).token)
    return Response.json({})
  })
  expect(revoked).toEqual(['refresh'])
  expect(await f.user()).toBeNull()
  // An owner that never logged in from Telegram is simply removed.
  await f.access.admit(OTHER)
  await admission_command(['remove', OTHER], cleanup_env, f.access, f.backend, offline)
  expect(await f.access.admitted_owners()).toEqual([])
})

test('an owner removed while the listener runs meets the login card and leaves no navigation behind', async () => {
  const f = await setup()
  await f.access.admit(identity.owner)
  await f.link()
  await f.runtime.fetch(request(1, '/menu'))
  expect(f.runtime.sessions.get(42)?.revision).toBe(1)
  await admission_command(['remove', identity.owner], cleanup_env, f.access, f.backend, async () => Response.json({}))
  await f.runtime.fetch(request(2, '/menu'))
  expect(f.cards.at(-1)!.replaceAll('\\', '')).toContain(en.link)
  expect(f.runtime.sessions.has(42)).toBe(false)
  expect(await f.links.current(42)).toBeNull()
})

test('a sender past its allowance is acknowledged and dropped; a browser past its own gets a plain page', async () => {
  const f = await setup({
    sender_limiter: create_request_limiter({ capacity: 2, now: () => 0 }),
    visitor_limiter: create_request_limiter({ capacity: 1, now: () => 0 }),
  })
  for (const id of [1, 2]) expect((await f.runtime.fetch(request(id, '/start'))).status).toBe(200)
  expect(f.cards).toHaveLength(2)
  // Telegram redelivers anything not answered 2xx, so the dropped update is still a 200.
  expect((await f.runtime.fetch(request(3, '/start'))).status).toBe(200)
  expect(f.cards).toHaveLength(2)
  expect((await f.runtime.fetch(request(4, '/start', 43))).status).toBe(200)
  expect(f.cards).toHaveLength(3)
  // A request without the webhook secret never reaches a sender's allowance.
  const forged = new Request('https://companion.example/telegram', { method: 'POST', body: '{}' })
  expect((await f.runtime.fetch(forged)).status).toBe(403)
  const page = (address: string) =>
    f.runtime.fetch(
      new Request('https://companion.example/link/unknown', {
        headers: { 'accept-language': 'fr', 'cf-connecting-ip': address },
      })
    )
  expect((await page('10.0.0.1')).status).not.toBe(429)
  const refused = await page('10.0.0.1')
  expect([refused.status, await refused.text()]).toEqual([429, copy('fr').failure_temporary])
  expect((await page('10.0.0.2')).status).not.toBe(429)
})

test('configuration reads no allowlist: admission lives in Redis and a refused start names the setting to fix', () => {
  const env = {
    TELEGRAM_LOCAL_PORT: '7777',
    TELEGRAM_MAX_REQUEST_BYTES: '4096',
    TELEGRAM_LOCAL_SECRET: 'fixture',
    TELEGRAM_REDIS_URL: 'redis://127.0.0.1:6379',
  }
  expect(Object.keys(configuration(env)).toSorted()).toEqual(['hostname', 'maximum', 'port', 'redis_url', 'secret'])
  expect(configuration(env).port).toBe(7777)
  expect(() => configuration({ ...env, TELEGRAM_LOCAL_SECRET: undefined })).toThrow('TELEGRAM_LOCAL_SECRET_required')
  expect(() => configuration({ ...env, TELEGRAM_REDIS_URL: '' })).toThrow('TELEGRAM_REDIS_URL_required')
  for (const port of [undefined, 'http', '0', '65536'])
    expect(() => configuration({ ...env, TELEGRAM_LOCAL_PORT: port })).toThrow('local_limits_required')
  expect(() => connected_configuration(env)).toThrow('TELEGRAM_CONNECTED_CONFIG_required')
  const connected = {
    ...env,
    TELEGRAM_CONNECTED_CONFIG: JSON.stringify({
      issuer: 'https://bot.example',
      callback_url: 'https://companion.example/oauth/callback',
      limits,
    }),
  }
  expect(() => connected_configuration(connected)).toThrow('TELEGRAM_BOT_TOKEN_required')
  expect(() => connected_configuration({ ...connected, TELEGRAM_BOT_TOKEN: '1:token' })).toThrow(
    'TELEGRAM_STORAGE_KEY_required'
  )
})

test('a revoked read-only login cannot join and a changed Google identity cannot reuse a waiting link', async () => {
  const f = await setup()
  await f.identify()
  f.overrides.handler = async () =>
    Response.json({ result: { structuredContent: { ...identity, owner: `0x${'3'.repeat(64)}` } } })
  // A refusal the player was told about is answered, not redelivered.
  expect((await f.runtime.fetch(request(1, '/join'))).status).toBe(200)
  const answered = f.cards.length
  expect(answered).toBeGreaterThan(0)
  expect(await f.access.waiting()).toEqual([])
  // The bot answers 401 to a revoked token and to its refresh: that ends the login.
  f.overrides.handler = async () => Response.json({}, { status: 401 })
  expect((await f.runtime.fetch(request(2, '/join'))).status).toBe(200)
  expect(f.cards.length).toBeGreaterThan(answered)
  expect(await f.access.waiting()).toEqual([])
  expect(await f.links.current(42)).toBeNull()
})
