// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { PLAY_SCOPE } from '@aresrpg/protocol/hosted-bot-client'

import { deferred, fixture, identity } from './helpers/connected_fixture.ts'

test('browser PKCE, issuer, cookie and original sender all bind one-use confirmation', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  expect(new URL(browser.location).searchParams.get('code_challenge_method')).toBe('S256')
  await expect(
    f.links.callback(new URLSearchParams({ ...Object.fromEntries(query), iss: 'https://evil.example' }), browser.cookie)
  ).rejects.toThrow('callback_mismatch')
  await expect(f.links.callback(query, 'other-browser')).rejects.toThrow('browser_mismatch')
  const result = await f.links.callback(query, browser.cookie)
  expect(await f.links.current(42)).toBeNull()
  await expect(f.links.confirm(43, result.code)).rejects.toThrow('confirmation_mismatch')
  await f.links.confirm(42, result.code)
  expect((await f.links.current(42))?.identity).toEqual(identity)
  await expect(f.links.confirm(42, result.code)).rejects.toThrow()
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow()
  expect(f.sent.filter((entry) => entry.url.endsWith('/oauth/token'))).toHaveLength(1)
  expect(f.sent.every((entry) => entry.init.redirect === 'error')).toBe(true)
})
test('one Google owner cannot activate two Telegram identities', async () => {
  const f = fixture()
  await f.link()
  const { browser, query } = await f.start(43)
  const result = await f.links.callback(query, browser.cookie)
  await expect(f.links.confirm(43, result.code)).rejects.toThrow('owner_already_linked')
  expect(await f.links.current(43)).toBeNull()
})
test('known exchanged tokens survive failed identity read without a second token exchange', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  let failed = 0
  f.overrides.handler = async (url) => {
    if (url.endsWith('/oauth/token'))
      return Response.json({
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_in: 10,
        scope: 'bot:observe',
      })
    // The identity read and its single transparent retry both fail.
    if (failed < 2) {
      failed += 1
      throw new Error('secret URL must not leak')
    }
    return Response.json({ result: { structuredContent: identity } })
  }
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('unavailable')
  const stored = (await f.attempts()).at(-1)!
  expect(stored.tokens?.refresh_token).toBe('refresh')
  const result = await f.links.callback(query, browser.cookie)
  expect(result.code).toBeString()
  expect(f.sent.filter((entry) => entry.url.endsWith('/oauth/token'))).toHaveLength(1)
})
test('unknown exchange is never retried', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  f.overrides.handler = async () => {
    throw new Error('connection lost')
  }
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('uncertain')
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('exchange_unavailable')
  expect(f.sent.filter((entry) => entry.url.endsWith('/oauth/token'))).toHaveLength(1)
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

test('owner admission removal during play upgrade retains issued tokens until pending revocation succeeds', async () => {
  const f = fixture()
  await f.identify()
  const { browser, query } = await f.start(42, true)
  const exchange = deferred<Response>()
  const requested = deferred<undefined>()
  let fail_revoke = true
  f.overrides.handler = async (url) => {
    if (url.endsWith('/oauth/token')) {
      requested.resolve(undefined)
      return exchange.promise
    }
    if (fail_revoke) throw new Error('revocation unavailable')
    return Response.json({})
  }
  const callback = f.links.callback(query, browser.cookie)
  await requested.promise
  await f.access.remove(identity.owner)
  exchange.resolve(
    Response.json({
      access_token: 'pending',
      refresh_token: 'pending-refresh',
      token_type: 'Bearer',
      expires_in: 10,
      scope: PLAY_SCOPE,
    })
  )
  await expect(callback).rejects.toThrow('unavailable')
  expect((await f.attempts()).at(-1)?.tokens?.refresh_token).toBe('pending-refresh')
  fail_revoke = false
  await f.links.revoke(42)
  expect((await f.attempts()).at(-1)?.tokens).toBeUndefined()
  expect(await f.user(42)).toBeNull()
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
      scope: 'bot:observe',
    })
  )
  await expect(callback).rejects.toThrow('link_expired_or_removed')
  expect(revoked).toBe(true)
  expect((await f.attempts()).at(-1)?.tokens).toBeUndefined()
  expect(await f.links.current(42)).toBeNull()
})

test('removed owner admission before or during play confirmation retires pending grant', async () => {
  for (const during of [false, true]) {
    const f = fixture()
    await f.identify()
    const { browser, query } = await f.start(42, true)
    const result = await f.links.callback(query, browser.cookie)
    const identity_read = deferred<Response>()
    const identity_requested = deferred<undefined>()
    let revoked = false
    f.overrides.handler = async (url) => {
      if (url.endsWith('/oauth/revoke')) {
        revoked = true
        return Response.json({})
      }
      identity_requested.resolve(undefined)
      return identity_read.promise
    }
    if (!during) await f.access.remove(identity.owner)
    const confirmation = f.links.confirm(42, result.code)
    if (during) {
      await identity_requested.promise
      await f.access.remove(identity.owner)
    }
    identity_read.resolve(Response.json({ result: { structuredContent: identity } }))
    await expect(confirmation).rejects.toThrow('link_expired_or_removed')
    expect(revoked).toBe(true)
    expect((await f.attempts()).at(-1)?.tokens).toBeUndefined()
    expect(await f.user(42)).toBeNull()
  }
})

// The allowlist is read on every use: no restart, no boot check, and the link itself is left to the operator command.
test('a removed owner is refused at its next request and admitted again at the one after re-admission', async () => {
  const f = fixture()
  await f.link()
  const revocations = f.sent.filter((request) => request.url.endsWith('/oauth/revoke')).length
  expect((await f.links.authenticate(42)).play).toBe(true)
  await f.access.remove(identity.owner)
  await expect(f.links.authenticate(42)).rejects.toThrow('owner_not_admitted')
  expect((await f.user(42))?.refresh_token).toBe('refresh')
  expect(f.sent.filter((request) => request.url.endsWith('/oauth/revoke'))).toHaveLength(revocations)
  await f.access.admit(identity.owner)
  expect((await f.links.authenticate(42)).play).toBe(true)
})

test('Google-first enrollment authentication works without admission and never carries the play scope', async () => {
  const f = fixture()
  await f.access.remove(identity.owner)
  const { browser, query } = await f.start()
  expect(new URL(browser.location).searchParams.get('scope')).toBe('bot:observe')
  const result = await f.links.callback(query, browser.cookie)
  await f.links.confirm(42, result.code)
  expect(await f.links.authenticate(42)).toMatchObject({ identity: { owner: identity.owner }, play: false })
  await expect(f.links.upgrade(42)).rejects.toThrow('owner_not_admitted')
  expect(f.sent.filter((entry) => entry.url.endsWith('/oauth/register'))).toHaveLength(1)
})

test('play upgrade cannot switch Google owner; the mismatched grant is revoked once and the attempt ends', async () => {
  const f = fixture()
  await f.identify()
  const { browser, query } = await f.start(42, true)
  const revoked: string[] = []
  f.overrides.handler = async (url, init) => {
    if (url.endsWith('/oauth/token'))
      return Response.json({
        access_token: 'new',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 10,
        scope: PLAY_SCOPE,
      })
    if (url.endsWith('/oauth/revoke')) {
      revoked.push(JSON.parse(String(init.body)).token)
      return Response.json({})
    }
    return Response.json({ result: { structuredContent: { ...identity, owner: `0x${'2'.repeat(64)}` } } })
  }
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('owner_mismatch')
  expect(await f.links.current(42)).toBeNull()
  // The hosted client revokes the foreign grant and reports it confirmed: the attempt only has to end.
  expect(revoked).toEqual(['new-refresh'])
  expect(await f.attempts()).toEqual([])
})

test('a mismatched grant whose revoke was not confirmed keeps its tokens until a revoke succeeds', async () => {
  const f = fixture()
  await f.identify()
  const { browser, query } = await f.start(42, true)
  const bot = { revokes: 0, reachable: false }
  f.overrides.handler = async (url) => {
    if (url.endsWith('/oauth/token'))
      return Response.json({
        access_token: 'new',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 10,
        scope: PLAY_SCOPE,
      })
    if (url.endsWith('/oauth/revoke')) {
      bot.revokes += 1
      if (!bot.reachable) throw new Error('revoke lost')
      return Response.json({})
    }
    return Response.json({ result: { structuredContent: { ...identity, owner: `0x${'2'.repeat(64)}` } } })
  }
  // The client could not confirm its revoke, so it does not report a finished mismatch.
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('unavailable')
  expect((await f.attempts()).at(-1)?.tokens?.refresh_token).toBe('new-refresh')
  bot.reachable = true
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('owner_mismatch')
  expect(bot.revokes).toBe(2)
  expect(await f.attempts()).toEqual([])
})

test('unexpected play scope during waiting login retains known tokens if revocation fails', async () => {
  const f = fixture()
  const { browser, query } = await f.start()
  f.overrides.handler = async (url) => {
    if (url.endsWith('/oauth/token'))
      return Response.json({
        access_token: 'new',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 10,
        scope: PLAY_SCOPE,
      })
    throw new Error('revoke unavailable')
  }
  await expect(f.links.callback(query, browser.cookie)).rejects.toThrow('unavailable')
  expect((await f.attempts()).at(-1)?.tokens?.refresh_token).toBe('new-refresh')
  expect(await f.links.current(42)).toBeNull()
  f.overrides.handler = undefined
  await f.links.revoke(42)
  f.links.assert_revoked(42)
})

test('refresh cannot silently upgrade read consent: the stored login stays as it was, ready for cleanup', async () => {
  const f = fixture()
  await f.identify()
  await f.expire()
  const before = await f.links.current(42)
  f.overrides.handler = async () =>
    Response.json({
      access_token: 'new',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 10,
      scope: PLAY_SCOPE,
    })
  await expect(f.links.authenticate(42)).rejects.toThrow('unavailable')
  expect(await f.links.current(42)).toEqual(before)
  expect(before?.scope).toBe('bot:observe')
})

test('revocation during a fresh owner read prevents stale authenticated enrollment', async () => {
  const f = fixture()
  await f.identify()
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
  const { browser, query } = await f.start()
  await f.links.callback(query, browser.cookie)
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at + 1
  // The confirm-phase record holds tokens: it stays until its revoke completes, then it is deleted.
  expect((await f.attempts())[0]?.phase).toBe('confirm')
  await f.links.begin(42)
  expect(f.sent.filter(({ url }) => url.endsWith('/oauth/revoke'))).toHaveLength(1)
  expect((await f.attempts()).map(({ phase }) => phase)).toEqual(['new'])
})

test('confirmation consumes the attempt by deleting it with its attempt list in the same commit', async () => {
  const f = fixture()
  await f.identify()
  expect(await f.attempts()).toEqual([])
  expect(await f.records.ids('attempts:')).toEqual([])
  expect((await f.user())?.identity).toEqual(identity)
})

test('the startup pass retires an ended token-holding attempt of a sender who never came back', async () => {
  const f = fixture()
  const { browser, query } = await f.start(77)
  await f.links.callback(query, browser.cookie)
  f.clock.now = (await f.attempts())[0]!.authorization.expires_at
  await f.links.retire_ended_attempts()
  expect(await f.attempts()).toEqual([])
  expect(f.sent.filter(({ url }) => url.endsWith('/oauth/revoke'))).toHaveLength(1)
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
      scope: 'bot:observe',
    })
  )
  await expect(callback).rejects.toThrow()
  const revoked = f.sent.filter(({ url }) => url.endsWith('/oauth/revoke')).map(({ body }) => body.token)
  expect(revoked).toEqual(['late-refresh'])
})
