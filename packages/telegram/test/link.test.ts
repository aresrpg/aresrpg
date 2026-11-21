// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'
import { PLAY_SCOPE, type BotGrant } from '@aresrpg/protocol/hosted-bot-client'

import { user_id } from '../src/link.ts'

import { deferred, fixture, identity } from './helpers/connected_fixture.ts'

type Fixture = ReturnType<typeof fixture>
const sent_to = (f: Fixture, path: string) => f.sent.filter(({ url }) => url.endsWith(path))
const revoked_tokens = (f: Fixture) => sent_to(f, '/oauth/revoke').map(({ body }) => body.token)
const link_of = (url: string) => new URL(url).pathname.slice(6)
const held = async (f: Fixture) => (await f.attempts()).map(({ sender, phase }) => [sender, phase])

test('browser PKCE, issuer and cookie bind a one-use login; its return links nothing until the chat confirms', async () => {
  const f = fixture()
  const url = await f.links.begin(42)
  const browser = await f.links.browser(link_of(url))
  const asked = new URL(browser.location).searchParams
  expect(asked.get('code_challenge_method')).toBe('S256')
  expect(asked.get('scope')).toBe(PLAY_SCOPE)
  const query = new URLSearchParams({ iss: 'https://bot.example', code: 'code', state: asked.get('state')! })
  await expect(
    f.links.callback(new URLSearchParams({ ...Object.fromEntries(query), iss: 'https://evil.example' }), browser.cookie)
  ).rejects.toThrow('callback_mismatch')
  await expect(f.links.callback(query, 'other-browser')).rejects.toThrow('browser_mismatch')
  // One use: the link opens one browser.
  await expect(f.links.browser(link_of(url))).rejects.toThrow('link_already_started')
  expect(await f.links.current(42)).toBeNull()
  // The browser's return proves an account, not a chat: the grant is held and nothing is linked.
  const token = await f.links.callback(query, browser.cookie)
  expect(await f.links.current(42)).toBeNull()
  expect(await f.links.sender_of(identity.owner)).toBeNull()
  await expect(f.links.authenticate(42)).rejects.toThrow('reauthorization_required')
  // One use: the same return mints no second token and exchanges nothing more.
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('exchange_unavailable')
  // The chat that asked sends the token back: only then is it linked.
  expect(await f.links.confirm(42, token)).toBe(true)
  expect(await f.links.current(42)).toMatchObject({ identity, scope: PLAY_SCOPE })
  // One use: the attempt is gone, so a later return finds nothing and exchanges nothing.
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('unknown_link')
  await expect(f.links.browser(link_of(url))).rejects.toThrow('link_expired')
  expect(sent_to(f, '/oauth/token')).toHaveLength(1)
  expect(f.sent.every((entry) => entry.init.redirect === 'error')).toBe(true)
})
test('a link is bound to the chat that asked: another chat stays unlinked and another browser is refused', async () => {
  const f = fixture()
  const asked = await f.start(43)
  await expect(f.links.callback(asked.query, 'stolen-or-guessed')).rejects.toThrow('browser_mismatch')
  expect(await held(f)).toEqual([[43, 'browser']])
  const token = await f.links.callback(asked.query, asked.browser.cookie)
  expect(await f.links.confirm(43, token)).toBe(true)
  expect((await f.links.current(43))?.identity).toEqual(identity)
  expect(await f.links.current(42)).toBeNull()
  expect(await f.links.sender_of(identity.owner)).toBe(43)
})
// Security review 2026-11-21 (P1): the browser's return used to link the asking chat at once. An attacker
// began a login in their own chat and never opened it; any web page then sent a signed-in player through
// it, and the attacker's chat was linked to that player's account with play scope and no click.
test('drive-by: a browser that finishes another chat’s login links nobody; START from any other chat is refused', async () => {
  const f = fixture()
  const [attacker, victim] = [43, 42]
  // The attacker's chat asked; the victim's browser went through the link and returned.
  const token = await f.signed_in(attacker)
  // The deep link opens in the victim's own Telegram, so START arrives from the victim's chat.
  expect(await f.links.confirm(victim, token)).toBe(false)
  expect([await f.links.current(attacker), await f.links.current(victim)]).toEqual([null, null])
  expect(await f.links.sender_of(identity.owner)).toBeNull()
  // The refused tap touched nothing of the attacker's attempt, and a held grant is not a login.
  expect(await held(f)).toEqual([[attacker, 'confirm']])
  expect(revoked_tokens(f)).toEqual([])
  await expect(f.links.authenticate(attacker)).rejects.toThrow('reauthorization_required')
  // Never confirmed, the attempt ends at its deadline and its grant is revoked.
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at
  await f.links.retire_ended_attempts()
  expect(revoked_tokens(f)).toEqual(['refresh'])
  expect(await held(f)).toEqual([])
  expect([await f.links.current(attacker), await f.links.current(victim)]).toEqual([null, null])
})
test('the confirmation token is 43 URL-safe characters of 256 random bits, kept only as its hash', async () => {
  const f = fixture()
  const token = await f.signed_in()
  // Telegram's start parameter allows A-Z a-z 0-9 _ - and at most 64 characters.
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  const [attempt] = await f.attempts()
  expect(attempt).toMatchObject({
    phase: 'confirm',
    identity,
    confirm: createHash('sha256').update(token).digest('base64url'),
  })
  expect(JSON.stringify(attempt)).not.toContain(token)
  // Every login mints its own.
  expect(await fixture().signed_in()).not.toBe(token)
})
test('a token confirms once, only its own attempt, and only before the deadline', async () => {
  const f = fixture()
  const first = await f.signed_in()
  // The chat asked again: its first login is ended and revoked, and a second one returns.
  f.issued.refresh_token = 'second-refresh'
  const second = await f.signed_in()
  expect(revoked_tokens(f)).toEqual(['refresh'])
  // The token of the chat's other attempt, a guess and an empty one confirm nothing and consume nothing.
  for (const wrong of [first, `${second}x`, second.slice(1), '']) expect(await f.links.confirm(42, wrong)).toBe(false)
  expect(await f.links.current(42)).toBeNull()
  expect(await held(f)).toEqual([[42, 'confirm']])
  expect(await f.links.confirm(42, second)).toBe(true)
  expect((await f.user())?.refresh_token).toBe('second-refresh')
  // Replayed: the attempt went with the link.
  expect(await f.links.confirm(42, second)).toBe(false)
  // Expired: the token of an attempt past its deadline confirms nothing, and its grant is revoked.
  const late = fixture()
  const token = await late.signed_in()
  late.clock.now = (await late.attempts())[0]!.authorization.expires_at
  expect(await late.links.confirm(42, token)).toBe(false)
  expect(await late.links.current(42)).toBeNull()
  await late.links.expire_attempts(42)
  expect(revoked_tokens(late)).toEqual(['refresh'])
  expect(await late.attempts()).toEqual([])
})
test('two chats that hold the same account: the first START links, the second is refused and its grant revoked', async () => {
  const f = fixture()
  const first = await f.signed_in(42)
  f.issued.refresh_token = 'second-refresh'
  const second = await f.signed_in(43)
  expect(await f.links.confirm(42, first)).toBe(true)
  await expect(f.links.confirm(43, second)).rejects.toThrow('owner_already_linked')
  expect(revoked_tokens(f)).toEqual(['second-refresh'])
  expect(await held(f)).toEqual([])
  expect(await f.records.ids('attempts:')).toEqual([])
  expect(await f.links.current(43)).toBeNull()
  expect(await f.links.sender_of(identity.owner)).toBe(42)
})
test('the Google identity that signs in owns the link once its chat confirms; a later change of that identity ends it', async () => {
  const f = fixture()
  const signed_in = { ...identity, owner: `0x${'2'.repeat(64)}` }
  const { browser, query } = await f.start()
  f.overrides.handler = async (url, init) =>
    url.endsWith('/mcp') ? Response.json({ result: { structuredContent: signed_in } }) : f.respond(url, init)
  expect(await f.links.confirm(42, await f.links.callback(query, browser.cookie))).toBe(true)
  // The owner is never typed or passed: it is what the bot reports for the fresh tokens.
  expect((await f.user())?.identity.owner).toBe(signed_in.owner)
  expect(await f.links.sender_of(signed_in.owner)).toBe(42)
  expect(await f.links.sender_of(identity.owner)).toBeNull()
  expect((await f.links.authenticate(42)).identity).toEqual(signed_in)
  f.overrides.handler = undefined
  await expect(f.links.authenticate(42)).rejects.toThrow('identity_changed')
})
test('one Google owner cannot link two chats; the refused login leaves no grant and no attempt', async () => {
  const f = fixture()
  await f.link()
  f.issued.refresh_token = 'second-refresh'
  const { browser, query } = await f.start(43)
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('owner_already_linked')
  expect(await f.links.current(43)).toBeNull()
  // The refused grant is revoked at once, not at the attempt's deadline.
  expect(revoked_tokens(f)).toEqual(['second-refresh'])
  expect(await f.attempts()).toEqual([])
  expect(await f.records.ids('attempts:')).toEqual([])
  expect((await f.user(42))?.refresh_token).toBe('refresh')
})
test('an unopened link is offered again; an opened one that never finished is ended and replaced', async () => {
  const f = fixture()
  const first = await f.links.begin(42)
  expect(await f.links.begin(42)).toBe(first)
  expect(sent_to(f, '/oauth/register')).toHaveLength(1)
  const opened = await f.links.browser(link_of(first))
  const state = new URL(opened.location).searchParams.get('state')!
  // The chat asks again while its login is open in a browser: no dead end, a new link.
  const second = await f.links.begin(42)
  expect(second).not.toBe(first)
  expect((await f.attempts()).map(({ id, phase }) => [id, phase])).toEqual([[link_of(second), 'new']])
  await expect(
    f.links.callback(new URLSearchParams({ iss: 'https://bot.example', code: 'code', state }), opened.cookie)
  ).rejects.toThrow('unknown_link')
  expect(sent_to(f, '/oauth/token')).toEqual([])
  expect(await f.links.current(42)).toBeNull()
})
test('a link past its deadline opens nothing, and the chat is offered a different one', async () => {
  const f = fixture()
  const first = await f.links.begin(42)
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at
  await expect(f.links.browser(link_of(first))).rejects.toThrow('link_expired')
  expect(await f.links.begin(42)).not.toBe(first)
})
test('known exchanged tokens survive failed identity read without a second token exchange', async () => {
  const f = fixture()
  const { browser, query } = await f.exchanged()
  const stored = (await f.attempts()).at(-1)!
  expect(stored.tokens?.refresh_token).toBe('refresh')
  expect(await f.links.confirm(42, await f.links.callback(query, browser.cookie))).toBe(true)
  expect((await f.user())?.refresh_token).toBe('refresh')
  expect(await f.attempts()).toEqual([])
  expect(sent_to(f, '/oauth/token')).toHaveLength(1)
})
test('unknown exchange is never retried', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  f.overrides.handler = async () => {
    throw new Error('connection lost')
  }
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('uncertain')
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('exchange_unavailable')
  expect(sent_to(f, '/oauth/token')).toHaveLength(1)
})
test('revocation wins over a delayed refresh; it cannot resurrect authority', async () => {
  const f = fixture()
  await f.link()
  await f.expire()
  const refresh = deferred<Response>()
  f.overrides.handler = async (url) => (url.endsWith('/oauth/token') ? refresh.promise : Response.json({}))
  const request = f.links.authenticate(42).then(
    () => 'unexpected',
    (error: Error) => error.message
  )
  await f.links.revoke(42)
  refresh.resolve(
    Response.json({
      access_token: 'new',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 10,
      scope: PLAY_SCOPE,
    })
  )
  // The rotation finds its link gone: nothing is stored and the old login cannot act.
  expect(await request).toBe('reauthorization_required')
  expect(await f.links.current(42)).toBeNull()
})
test('late duplicate revoke cannot delete a newer link', async () => {
  const f = fixture()
  await f.link()
  const late = deferred<Response>()
  let revocations = 0
  f.overrides.handler = async () => (++revocations === 1 ? Response.json({}) : late.promise)
  const first = f.links.revoke(42)
  const second = f.links.revoke(42)
  await first
  f.overrides.handler = undefined
  f.issued.refresh_token = 'newer-refresh'
  await f.link()
  late.resolve(Response.json({}))
  // The concurrent duplicate finishes its own revoke; it never deletes the newer link.
  await second
  expect((await f.links.current(42))?.refresh_token).toBe('newer-refresh')
})

test('unlink during unknown exchange retains tombstone then revokes late issued credentials', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  const exchange = deferred<Response>()
  const requested = deferred<undefined>()
  let revoked = false
  f.overrides.handler = async (url) => {
    if (url.endsWith('/oauth/token')) {
      requested.resolve(undefined)
      return exchange.promise
    }
    revoked = true
    return Response.json({})
  }
  const callback = f.links.callback(query, browser.cookie)
  await requested.promise
  await f.links.revoke(42)
  expect((await f.attempts()).at(-1)?.cancelled).toBe(true)
  exchange.resolve(
    Response.json({
      access_token: 'pending',
      refresh_token: 'pending-refresh',
      token_type: 'Bearer',
      expires_in: 10,
      scope: PLAY_SCOPE,
    })
  )
  await expect(callback).rejects.toThrow('link_expired_or_removed')
  expect(revoked).toBe(true)
  expect((await f.attempts()).at(-1)?.tokens).toBeUndefined()
  expect(await f.links.current(42)).toBeNull()
})

// Admission is not the link service's job: the runtime reads the allowlist on every update.
test('every login carries the play scope and authenticates whether or not its owner is admitted', async () => {
  const f = fixture()
  await f.access.remove(identity.owner)
  const { browser, query } = await f.start()
  expect(new URL(browser.location).searchParams.get('scope')).toBe(PLAY_SCOPE)
  expect(await f.links.confirm(42, await f.links.callback(query, browser.cookie))).toBe(true)
  expect((await f.user())?.scope).toBe(PLAY_SCOPE)
  expect(await f.links.authenticate(42)).toMatchObject({ identity: { owner: identity.owner } })
  await f.access.admit(identity.owner)
  expect(await f.links.authenticate(42)).toMatchObject({ identity: { owner: identity.owner } })
  expect(sent_to(f, '/oauth/register')).toHaveLength(1)
})

test('a view-only login stored by the two-step flow asks for one new login and reads nothing from the bot', async () => {
  const f = fixture()
  await f.link()
  await f.records.change([user_id(42)], (get) => ({
    [user_id(42)]: { value: { ...get<BotGrant>(user_id(42))!, scope: 'bot:observe' } },
  }))
  const before = f.sent.length
  await expect(f.links.authenticate(42)).rejects.toThrow('reauthorization_required')
  expect(f.sent).toHaveLength(before)
  // It is still a login the bot knows: replacing it revokes it there.
  await f.links.revoke(42)
  expect(revoked_tokens(f)).toEqual(['refresh'])
  expect(await f.user()).toBeNull()
})

test('a token of another scope than the login asked for is refused; its tokens are kept until a revoke succeeds', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  f.overrides.handler = async (url) => {
    if (url.endsWith('/oauth/token'))
      return Response.json({
        access_token: 'new',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 10,
        scope: 'bot:observe',
      })
    throw new Error('revoke unavailable')
  }
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('unavailable')
  expect((await f.attempts()).at(-1)?.tokens?.refresh_token).toBe('new-refresh')
  expect(await f.links.current(42)).toBeNull()
  f.overrides.handler = undefined
  await f.links.revoke(42)
  expect(revoked_tokens(f)).toEqual(['new-refresh', 'new-refresh'])
  await f.links.assert_revoked(42)
})

test('a refresh cannot change the scope of a consent: the stored login stays as it was, ready for cleanup', async () => {
  const f = fixture()
  await f.link()
  await f.expire()
  const before = await f.links.current(42)
  f.overrides.handler = async () =>
    Response.json({
      access_token: 'new',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 10,
      scope: 'bot:observe',
    })
  await expect(f.links.authenticate(42)).rejects.toThrow('unavailable')
  expect(await f.links.current(42)).toEqual(before)
  expect(before?.scope).toBe(PLAY_SCOPE)
})

test('revocation during a fresh owner read prevents stale authenticated enrollment', async () => {
  const f = fixture()
  await f.link()
  const identity_read = deferred<Response>()
  f.overrides.handler = async (url) => (url.endsWith('/oauth/revoke') ? Response.json({}) : identity_read.promise)
  const read = f.links.authenticate(42)
  await f.links.revoke(42)
  identity_read.resolve(Response.json({ result: { structuredContent: identity } }))
  await expect(read).rejects.toThrow('link_changed')
  expect(await f.access.joined(identity.owner)).toBe(false)
})

test('an unopened link expires at its own deadline; one holding tokens outlives it until retired', async () => {
  const f = fixture()
  await f.start()
  const [opened] = await f.attempts()
  f.clock.now = opened!.authorization.expires_at
  expect(await f.attempts()).toEqual([])
  await f.exchanged()
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at + 1
  // The record holds tokens: it stays until its revoke completes, then it is deleted.
  expect((await f.attempts())[0]).toMatchObject({ phase: 'exchanging', tokens: { refresh_token: 'refresh' } })
  await f.links.begin(42)
  expect(sent_to(f, '/oauth/revoke')).toHaveLength(1)
  expect((await f.attempts()).map(({ phase }) => phase)).toEqual(['new'])
})

test('the confirmation consumes the attempt and its list entry in the same commit as the link', async () => {
  const f = fixture()
  await f.link()
  expect(await f.attempts()).toEqual([])
  expect(await f.records.ids('attempts:')).toEqual([])
  expect((await f.user())?.identity).toEqual(identity)
})

test('the startup pass retires an ended token-holding attempt of a sender who never came back', async () => {
  const f = fixture()
  await f.exchanged(77)
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at
  await f.links.retire_ended_attempts()
  expect(await f.attempts()).toEqual([])
  expect(sent_to(f, '/oauth/revoke')).toHaveLength(1)
})

test('tokens that arrive after their attempt ended are revoked, never orphaned', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  const exchange = deferred<Response>()
  const requested = deferred<undefined>()
  f.overrides.handler = async (url) => {
    if (!url.endsWith('/oauth/token')) return Response.json({})
    requested.resolve(undefined)
    return exchange.promise
  }
  const callback = f.links.callback(query, browser.cookie)
  await requested.promise
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at
  await f.links.begin(42).catch(() => undefined)
  exchange.resolve(
    Response.json({
      access_token: 'late',
      refresh_token: 'late-refresh',
      token_type: 'Bearer',
      expires_in: 10,
      scope: PLAY_SCOPE,
    })
  )
  await expect(callback).rejects.toThrow()
  expect(revoked_tokens(f)).toEqual(['late-refresh'])
})
