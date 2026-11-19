// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import {
  BOT_FAILURES,
  create_bot_client,
  grant_of,
  pending_of,
  post_json,
  random_token,
  same_scope,
  unwrap,
  type BotEnv,
  type BotFetch,
  type BotGrant,
  type GrantStore,
} from '../src/hosted_bot_client.ts'

const issuer = 'https://bot.example.test'
const scope = 'bot:observe bot:play bot:pause'
const owner = `0x${'d'.repeat(64)}`
const identity = {
  owner,
  bot_id: 'bot',
  address: '0xagent',
  descriptor: 'descriptor',
  generation: 1,
  grant_id: 'grant',
  expires_at: 99_999_999,
  network: 'mainnet' as const,
}
type Sent = Readonly<{ path: string; body: Record<string, any>; headers: Record<string, string>; init: RequestInit }>
type Override = (sent: Sent) => Response | Promise<Response> | undefined

/** A stand-in bot with the real grant rules: single-use rotation, reuse revokes, 401 for any other token. */
const fake_bot = () => {
  const sent: Sent[] = []
  const state = { generation: 0, revoked: false, override: undefined as Override | undefined }
  const used = new Set<string>()
  const token_reply = () => {
    state.generation += 1
    return Response.json({
      access_token: `access-${state.generation}`,
      refresh_token: `refresh-${state.generation}`,
      token_type: 'Bearer',
      expires_in: 900,
      scope,
    })
  }
  const refresh = (presented: string) => {
    const replayed = used.has(presented) || presented !== `refresh-${state.generation}`
    if (state.revoked || replayed) {
      state.revoked = true
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    used.add(presented)
    return token_reply()
  }
  const mcp = ({ body, headers }: Sent) => {
    if (state.revoked || headers.authorization !== `Bearer access-${state.generation}`)
      return Response.json({ error: 'invalid_token' }, { status: 401 })
    const result =
      body.method === 'tools/list'
        ? { tools: [{ name: 'bot_observe' }, { name: 'bot_start_behavior' }, { nameless: true }] }
        : { structuredContent: body.params.name === 'bot_identity' ? identity : { tool: body.params.name } }
    return Response.json({ jsonrpc: '2.0', id: 1, result })
  }
  const fetch: BotFetch = async (url, init) => {
    const entry: Sent = {
      path: new URL(url).pathname,
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
      init,
    }
    sent.push(entry)
    const overridden = await state.override?.(entry)
    if (overridden) return overridden
    if (entry.path === '/oauth/register') return Response.json({ client_id: 'client-1' }, { status: 201 })
    if (entry.path === '/oauth/revoke') {
      state.revoked = true
      return Response.json({})
    }
    if (entry.path !== '/oauth/token') return mcp(entry)
    return entry.body.grant_type === 'refresh_token' ? refresh(entry.body.refresh_token) : token_reply()
  }
  const paths = (path: string) => sent.filter((entry) => entry.path === path)
  const tools = () => paths('/mcp').map(({ body }) => body.params.name as string)
  return { fetch, sent, state, paths, tools }
}
const client_for = (bot: ReturnType<typeof fake_bot>, env: Partial<BotEnv> = {}) =>
  create_bot_client({ issuer, fetch: bot.fetch, now: () => 1_000, timeout_ms: 1_000, ...env })
/** One stored grant with the compare-and-replace every holder shares. */
const memory = (initial: BotGrant | null = null) => {
  const held = { grant: initial }
  const store: GrantStore = {
    read: () => held.grant,
    replace: (previous, next) => {
      if (held.grant?.refresh_token !== previous.refresh_token) return false
      held.grant = next
      return true
    },
  }
  return { store, held }
}
/** Completes a real authorization against the fake bot and stores its grant. */
const connected = async (bot: ReturnType<typeof fake_bot>, env: Partial<BotEnv> = {}) => {
  const client = client_for(bot, env)
  const pending = unwrap(await client.begin({ client_name: 'Test', redirect_uri: 'https://app/cb', scope, ttl_ms: 60 }))
  const tokens = unwrap(await client.exchange(pending, 'code-1'))
  const grant = unwrap(await client.verify(tokens, owner))
  const { store, held } = memory(grant)
  return { client, store, held, grant, session: client.session(store) }
}
const expired = (grant: BotGrant): BotGrant => ({ ...grant, expires_at: 0 })

test('the issuer is one https origin and the failure set is closed', () => {
  expect(() => client_for(fake_bot(), { issuer: 'http://bot.example.test' })).toThrow('invalid_issuer')
  expect(() => client_for(fake_bot(), { issuer: `${issuer}/path` })).toThrow('invalid_issuer')
  expect(new Set(BOT_FAILURES).size).toBe(BOT_FAILURES.length)
  expect(random_token()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(same_scope('bot:play bot:observe', 'bot:observe bot:play')).toBe(true)
  expect(same_scope('bot:observe', 'bot:observe bot:play')).toBe(false)
})

test('PKCE round trip: registration, S256 challenge, exact resource, then one bound code exchange', async () => {
  const bot = fake_bot()
  const client = client_for(bot)
  const begun = await client.begin({ client_name: 'Test', redirect_uri: 'https://app/cb', scope, ttl_ms: 60 })
  const pending = unwrap(begun)
  expect(bot.sent[0]!.body).toEqual({
    client_name: 'Test',
    redirect_uris: ['https://app/cb'],
    token_endpoint_auth_method: 'none',
  })
  expect(pending).toMatchObject({ client_id: 'client-1', redirect_uri: 'https://app/cb', scope, expires_at: 1_060 })
  const url = new URL(await client.authorization_url(pending))
  expect(`${url.origin}${url.pathname}`).toBe(`${issuer}/authorize`)
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: 'https://app/cb',
    scope,
    state: pending.state,
    code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: `${issuer}/mcp`,
  })
  const callback = new URLSearchParams({ code: 'g.code', state: pending.state, iss: issuer })
  const code = unwrap(client.authorization_code(pending, callback))
  const tokens = unwrap(await client.exchange(pending, code))
  expect(bot.paths('/oauth/token')[0]!.body).toEqual({
    grant_type: 'authorization_code',
    code: 'g.code',
    code_verifier: pending.verifier,
    redirect_uri: 'https://app/cb',
    client_id: 'client-1',
    resource: `${issuer}/mcp`,
  })
  expect(tokens).toEqual({
    issuer,
    client_id: 'client-1',
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    scope,
    expires_at: 901_000,
  })
  expect(bot.sent.every(({ init }) => init.redirect === 'error')).toBe(true)
})

test('a callback for another state or issuer, or without a code, yields no code', async () => {
  const client = client_for(fake_bot())
  const pending = unwrap(await client.begin({ client_name: 'Test', redirect_uri: 'https://app/cb', scope, ttl_ms: 60 }))
  const callback = (entries: Record<string, string>) => client.authorization_code(pending, new URLSearchParams(entries))
  const mismatch = { ok: false, error: 'callback_mismatch' } as const
  expect(callback({ code: 'c', state: 'other', iss: issuer })).toEqual(mismatch)
  expect(callback({ code: 'c', state: pending.state, iss: 'https://evil.test' })).toEqual(mismatch)
  expect(callback({ code: 'c', state: pending.state })).toEqual(mismatch)
  expect(callback({ error: 'access_denied', state: pending.state, iss: issuer })).toEqual(mismatch)
  expect(pending_of(pending, 1_059)).toEqual(pending)
  expect(pending_of(pending, 1_060)).toBeNull()
  expect(pending_of({ ...pending, verifier: '' }, 0)).toBeNull()
})

test('a refused registration keeps the bot code; a lost exchange is uncertain and is not asked again', async () => {
  const bot = fake_bot()
  const client = client_for(bot)
  const request = { client_name: 'Test', redirect_uri: 'https://app/cb', scope, ttl_ms: 60 }
  bot.state.override = () => Response.json({ error: 'invalid_client_metadata' }, { status: 400 })
  expect(await client.begin(request)).toEqual({ ok: false, error: 'invalid_client_metadata' })
  bot.state.override = () => {
    throw new TypeError('offline')
  }
  expect(await client.begin(request)).toEqual({ ok: false, error: 'unavailable' })
  bot.state.override = undefined
  const pending = unwrap(await client.begin(request))
  bot.state.override = ({ path }) => (path === '/oauth/token' ? new Response('{}', { status: 502 }) : undefined)
  expect(await client.exchange(pending, 'code')).toEqual({ ok: false, error: 'uncertain' })
  bot.state.override = () => Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 900 })
  // Tokens that cannot be read back may still exist on the bot.
  expect(await client.exchange(pending, 'code')).toEqual({ ok: false, error: 'uncertain' })
  expect(bot.paths('/oauth/token')).toHaveLength(2)
})

test('a tool call is one bearer JSON-RPC request; refusals keep their code and non-results are never data', async () => {
  const bot = fake_bot()
  const { session } = await connected(bot)
  expect(await session.call('bot_observe', { view: 'full' })).toEqual({ ok: true, value: { tool: 'bot_observe' } })
  const request = bot.paths('/mcp').at(-1)!
  expect(request.headers).toMatchObject({ authorization: 'Bearer access-1', 'mcp-protocol-version': '2025-11-25' })
  expect(request.body).toEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'bot_observe', arguments: { view: 'full' } },
  })
  expect(await session.tools()).toEqual({ ok: true, value: ['bot_observe', 'bot_start_behavior'] })
  expect(await session.identity()).toEqual({ ok: true, value: identity })
  const answer = async (reply: () => Response) => {
    bot.state.override = ({ path }) => (path === '/mcp' ? reply() : undefined)
    return session.call('bot_start_behavior')
  }
  const refusal = (error: unknown) =>
    Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { error }, isError: true } })
  expect(await answer(() => refusal('bot_busy_or_paused'))).toEqual({ ok: false, error: 'bot_busy_or_paused' })
  expect(await answer(() => refusal('Something Bad'))).toEqual({ ok: false, error: 'tool_failed' })
  // An answer that cannot be read says nothing about a mutation: it may have run.
  const unreadable = [
    () => new Response('not json'),
    () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32601 } }),
    () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
  ]
  for (const reply of unreadable) expect(await answer(reply)).toEqual({ ok: false, error: 'uncertain' })
  bot.state.override = ({ path }) => (path === '/mcp' ? new Response('not json') : undefined)
  expect(await session.call('bot_observe')).toEqual({ ok: false, error: 'unavailable' })
  expect(await answer(() => Response.json({ error: 'insufficient_scope' }, { status: 403 }))).toEqual({
    ok: false,
    error: 'insufficient_scope',
  })
})

test('a lost read is asked once more; a lost or timed-out mutation is uncertain and never resent', async () => {
  const bot = fake_bot()
  const { session } = await connected(bot, { timeout_ms: 5 })
  const lose = (count: number, how: (init: RequestInit) => Promise<Response>) => {
    const before = bot.paths('/mcp').length
    bot.state.override = ({ path, init }) =>
      path === '/mcp' && bot.paths('/mcp').length - before <= count ? how(init) : undefined
    return () => bot.paths('/mcp').length - before
  }
  const dropped = async () => {
    throw new TypeError('reply lost')
  }
  const crashed = async () => new Response('{}', { status: 502 })
  const silent = (init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason as Error))
    })
  let requests = lose(1, dropped)
  expect(await session.call('bot_observe')).toEqual({ ok: true, value: { tool: 'bot_observe' } })
  expect(requests()).toBe(2)
  requests = lose(2, crashed)
  // A read changed nothing, so two lost replies mean unavailable, never an unknown outcome.
  expect(await session.call('bot_observe')).toEqual({ ok: false, error: 'unavailable' })
  expect(requests()).toBe(2)
  for (const how of [dropped, crashed, silent]) {
    requests = lose(1, how)
    expect(await session.call('bot_start_behavior', { idempotency_key: 'k' })).toEqual({
      ok: false,
      error: 'uncertain',
    })
    expect(requests()).toBe(1)
  }
})

test('an expiring access token is renewed ahead of the call, and the rotation is stored', async () => {
  const bot = fake_bot()
  const { client, grant } = await connected(bot)
  // 60 s before its end the token is already renewed.
  const { store, held } = memory({ ...grant, expires_at: 61_000 })
  expect(await client.session(store).call('bot_observe')).toEqual({ ok: true, value: { tool: 'bot_observe' } })
  expect(bot.paths('/oauth/token').at(-1)!.body).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'refresh-1',
    client_id: 'client-1',
    resource: `${issuer}/mcp`,
  })
  expect(held.grant).toEqual({ ...grant, access_token: 'access-2', refresh_token: 'refresh-2', expires_at: 901_000 })
  expect(bot.paths('/mcp').at(-1)!.headers.authorization).toBe('Bearer access-2')
  await client.session(store).call('bot_observe')
  expect(bot.paths('/oauth/token')).toHaveLength(2)
})

test('two holders of one stored grant refresh once: neither presents a used refresh token', async () => {
  const bot = fake_bot()
  const { grant } = await connected(bot)
  const { store, held } = memory(expired(grant))
  // What the browser gives its tabs: one lock shared by every holder of the store.
  const queue = { tail: Promise.resolve() as Promise<unknown> }
  const lock: NonNullable<BotEnv['lock']> = (_key, task) => {
    const run = queue.tail.then(task)
    queue.tail = run.catch(() => undefined)
    return run
  }
  const [first, second] = [client_for(bot, { lock }), client_for(bot, { lock })]
  const results = await Promise.all([
    first.session(store).call('bot_observe'),
    second.session(store).call('bot_start_behavior'),
    first.session(store).call('bot_behavior_status'),
  ])
  expect(results.map((result) => result.ok)).toEqual([true, true, true])
  expect(bot.paths('/oauth/token').filter(({ body }) => body.grant_type === 'refresh_token')).toHaveLength(1)
  expect(held.grant?.refresh_token).toBe('refresh-2')
  expect(bot.state.revoked).toBe(false)
})

test('one process serializes its own refreshes, and a restarted holder presents only the stored rotation', async () => {
  const bot = fake_bot()
  const { client, grant } = await connected(bot)
  const { store, held } = memory(expired(grant))
  const session = client.session(store)
  expect((await Promise.all([session.call('bot_observe'), session.call('bot_observe')])).map(({ ok }) => ok)).toEqual([
    true,
    true,
  ])
  expect(bot.paths('/oauth/token')).toHaveLength(2)
  // A new holder knows only the store, so it can never present a token an earlier holder used.
  held.grant = expired(held.grant!)
  const rotated = unwrap(await client_for(bot).session(store).identity())
  expect(rotated).toEqual(identity)
  expect(bot.paths('/oauth/token').map(({ body }) => body.refresh_token)).toEqual([undefined, 'refresh-1', 'refresh-2'])
  expect(bot.state.revoked).toBe(false)
})

test('a refused refresh requires re-authorization and clears the grant; silence keeps it', async () => {
  const bot = fake_bot()
  const { client, grant } = await connected(bot)
  const lost = memory(expired(grant))
  bot.state.override = ({ path }) => (path === '/oauth/token' ? new Response('{}', { status: 503 }) : undefined)
  expect(await client.session(lost.store).call('bot_observe')).toEqual({ ok: false, error: 'unavailable' })
  expect(lost.held.grant).toEqual(expired(grant))
  // A rotation is the same consent or it is not adopted.
  bot.state.override = ({ path }) =>
    path === '/oauth/token'
      ? Response.json({
          access_token: 'a',
          refresh_token: 'r',
          token_type: 'Bearer',
          expires_in: 900,
          scope: 'bot:observe',
        })
      : undefined
  expect(await client.session(lost.store).call('bot_observe')).toEqual({ ok: false, error: 'unavailable' })
  expect(lost.held.grant).toEqual(expired(grant))
  for (const refusal of [
    Response.json({ error: 'invalid_grant' }, { status: 400 }),
    Response.json({ error: 'invalid_token' }, { status: 401 }),
  ]) {
    const refused = memory(expired(grant))
    bot.state.override = ({ path }) => (path === '/oauth/token' ? refusal : undefined)
    expect(await client.session(refused.store).call('bot_observe')).toEqual({
      ok: false,
      error: 'reauthorization_required',
    })
    expect(refused.held.grant).toBeNull()
  }
  expect(await client.session(memory().store).call('bot_observe')).toEqual({
    ok: false,
    error: 'reauthorization_required',
  })
  const foreign = memory({ ...grant, issuer: 'https://other.example.test' })
  expect(await client.session(foreign.store).call('bot_observe')).toEqual({
    ok: false,
    error: 'reauthorization_required',
  })
})

test('a 401 is followed by one refresh and one retry for a read only; a mutation is never resent', async () => {
  const bot = fake_bot()
  const { session, held, grant } = await connected(bot)
  // The bot no longer accepts this access token although the client still believes it valid.
  held.grant = { ...grant, access_token: 'stale' }
  expect(await session.call('bot_start_behavior')).toEqual({ ok: false, error: 'invalid_token' })
  expect(bot.tools().filter((name) => name === 'bot_start_behavior')).toHaveLength(1)
  expect(bot.paths('/oauth/token')).toHaveLength(1)
  expect(await session.call('bot_observe')).toEqual({ ok: true, value: { tool: 'bot_observe' } })
  expect(bot.tools().filter((name) => name === 'bot_observe')).toHaveLength(2)
  expect(bot.paths('/oauth/token')).toHaveLength(2)
  expect(held.grant?.access_token).toBe('access-2')
  // A grant the bot ended answers 401, then refuses the refresh: the read ends there.
  bot.state.revoked = true
  expect(await session.call('bot_observe')).toEqual({ ok: false, error: 'reauthorization_required' })
  expect(held.grant).toBeNull()
})

test('a grant for another owner is revoked and never returned, so nothing can be stored', async () => {
  const bot = fake_bot()
  const client = client_for(bot)
  const pending = unwrap(await client.begin({ client_name: 'Test', redirect_uri: 'https://app/cb', scope, ttl_ms: 60 }))
  const tokens = unwrap(await client.exchange(pending, 'code'))
  expect(await client.verify(tokens, `0x${'e'.repeat(64)}`)).toEqual({ ok: false, error: 'owner_mismatch' })
  expect(bot.paths('/oauth/revoke').map(({ body }) => body)).toEqual([{ token: 'refresh-1', client_id: 'client-1' }])
  const open = fake_bot()
  const any_owner = client_for(open)
  const granted = unwrap(await any_owner.exchange(pending, 'code'))
  expect(unwrap(await any_owner.verify(granted, null)).identity).toEqual(identity)
  expect(open.paths('/oauth/revoke')).toHaveLength(0)
  open.state.override = ({ path }) =>
    path === '/mcp' ? Response.json({ result: { structuredContent: {} } }) : undefined
  expect(await any_owner.verify(granted, owner)).toEqual({ ok: false, error: 'unavailable' })
})

test('owner_mismatch reports a confirmed revoke; a revoke that failed reports its own failure', async () => {
  const bot = fake_bot()
  const client = client_for(bot)
  const pending = unwrap(await client.begin({ client_name: 'Test', redirect_uri: 'https://app/cb', scope, ttl_ms: 60 }))
  const tokens = unwrap(await client.exchange(pending, 'code'))
  const stranger = `0x${'e'.repeat(64)}`
  // The bot never answers the revoke: the grant is still live, and the holder is not told it is gone.
  bot.state.override = ({ path }) => (path === '/oauth/revoke' ? Response.json({}, { status: 503 }) : undefined)
  expect(await client.verify(tokens, stranger)).toEqual({ ok: false, error: 'unavailable' })
  expect(bot.state.revoked).toBe(false)
  bot.state.override = undefined
  expect(await client.verify(tokens, stranger)).toEqual({ ok: false, error: 'owner_mismatch' })
  expect(bot.state.revoked).toBe(true)
  // One revoke per verification: the confirmed one is never repeated by this client.
  expect(bot.paths('/oauth/revoke')).toHaveLength(2)
})

test('a rotation that returns after the grant was removed never restores it', async () => {
  const bot = fake_bot()
  const { client, grant } = await connected(bot)
  const { store, held } = memory(expired(grant))
  bot.state.override = ({ path }) => {
    if (path === '/oauth/token') held.grant = null
    return undefined
  }
  expect(await client.session(store).call('bot_observe')).toEqual({ ok: false, error: 'reauthorization_required' })
  expect(held.grant).toBeNull()
  expect(unwrap(await client.revoke(grant))).toBeNull()
})

test('a stored grant is one complete record or nothing', async () => {
  const { grant } = await connected(fake_bot())
  expect(grant_of(JSON.parse(JSON.stringify(grant)))).toEqual(grant)
  expect(grant_of({ ...grant, refresh_token: '' })).toBeNull()
  expect(grant_of({ ...grant, identity: { ...identity, network: 'testnet' } })).toBeNull()
  expect(grant_of({ ...grant, expires_at: '900' })).toBeNull()
  expect(grant_of(null)).toBeNull()
})

test('a JSON post reports the status it got and fails when nothing answered in time', async () => {
  const options = { timeout_ms: 5 }
  expect(await post_json(async () => new Response('nope', { status: 404 }), issuer, {}, options)).toMatchObject({
    ok: true,
    value: { status: 404 },
  })
  expect(await post_json(async () => Response.json({ ok: true }), issuer, {}, options)).toEqual({
    ok: true,
    value: { status: 200, body: { ok: true } },
  })
  const never: BotFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal!
      if (signal.aborted) reject(signal.reason as Error)
      signal.addEventListener('abort', () => reject(signal.reason as Error))
    })
  expect((await post_json(never, issuer, {}, options)).ok).toBe(false)
  // A holder that went away ends its request at once, whatever the timeout.
  expect((await post_json(never, issuer, {}, { timeout_ms: 60_000, signal: AbortSignal.abort() })).ok).toBe(false)
})
