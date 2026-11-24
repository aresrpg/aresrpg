// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one bot test fixture: a disposable store, the service configuration, one provisioned bot with a
// grant, the actor runtime on a fake game socket, the HTTP door with its OAuth flow, and observed
// game contexts for professions, travel and fights.
import { expect, test } from 'bun:test'
import { RedisClient } from 'bun'
import type { HostedAuthorizeResponse, HostedChallengeResponse } from '@aresrpg/protocol'
import { create_managed_agent_signer } from '@aresrpg/sdk/agent-signer'
import type { AgentTransport } from '@aresrpg/sdk/agent-connection'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { fake_client, id } from '../../sdk/test/helpers/transport.ts'
import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_connect_service } from '../src/connect.ts'
import type { Observe } from '../src/control.ts'
import { create_ingress } from '../src/http.ts'
import { create_oauth_service } from '../src/oauth.ts'
import type { ManagedProvider } from '../src/managed_signer.ts'
import { hash_secret, random_secret, type Bot, type BotConfig, type Grant } from '../src/model.ts'
import { request_provisioning, run_provisioning } from '../src/provisioning.ts'
import { create_redis_store, has_pending_work, type ControlStore } from '../src/store.ts'
import { released_records } from '../src/store_projection.ts'

export { id }
/** Disposable store with the production release rule, rollback and serialization; never a fallback. */
export const memory_store = (): ControlStore => {
  const listeners = new Set<(keys: readonly string[]) => void>()
  let records = new Map<string, unknown>()
  let pending: Promise<unknown> = Promise.resolve()
  return {
    subscribe_pending: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: async <T>(key: string) => structuredClone(records.get(key) as T | undefined) ?? null,
    scan_pending: async (limit, after = '') =>
      [...records.entries()]
        .filter(([key, value]) => key > after && has_pending_work(key, value))
        .map(([key]) => key)
        .toSorted()
        .slice(0, limit),
    scan_keys: async (prefix, limit, after = '') =>
      [...records.keys()]
        .filter((key) => key.startsWith(prefix) && key > after)
        .toSorted()
        .slice(0, limit),
    transaction: (keys, operation) => {
      const result = pending.then(async () => {
        const next = structuredClone(records)
        const check = (key: string) => {
          if (!keys.includes(key)) throw new Error('unlocked fixture key')
        }
        const value = await operation({
          get: async <T>(key: string) => {
            check(key)
            return structuredClone(next.get(key) as T | undefined) ?? null
          },
          put: async (key, item) => {
            check(key)
            next.set(key, structuredClone(item))
          },
        })
        for (const key of keys.flatMap((key) => released_records(key, records.get(key), next.get(key))))
          next.delete(key)
        const added = keys.filter(
          (key) => has_pending_work(key, next.get(key)) && !has_pending_work(key, records.get(key))
        )
        records = next
        if (added.length) for (const listener of listeners) listener(added)
        return value
      })
      pending = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
  }
}
export const put = (store: ControlStore, key: string, value: unknown) =>
  store.transaction([key], (tx) => tx.put(key, value))
export const fixture_google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
export const other_google = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
export const fixture_config: BotConfig = {
  issuer: 'https://bot.example.test',
  resource: 'https://bot.example.test/mcp',
  web_origin: 'https://game.example.test',
  network: 'mainnet',
  authority_generation: 'fixture-generation',
  recovery_mode: false,
  observation_freshness_ms: 60000,
  refusal_retry_ms: 30000,
  request_ttl_ms: 300000,
  challenge_ttl_ms: 60000,
  code_ttl_ms: 30000,
  access_ttl_ms: 10000,
  refresh_ttl_ms: 300000,
  max_body_bytes: 8192,
  max_redirect_uris: 3,
  scopes: ['bot:observe', 'bot:play', 'bot:pause'],
}
export const fixture_bot: Bot = {
  id: 'fixture-bot',
  owner: fixture_google.toSuiAddress(),
  zklogin_public_identifier: fixture_google.toBase64(),
  network: 'mainnet',
  address: `0x${'a'.repeat(64)}`,
  multisig_public_key: 'fixture-public-descriptor',
  key_id: 'fixture-never-funded',
  generation: 1,
  status: 'ready',
  policy: { revision: 1, scopes: fixture_config.scopes },
}
export const other_bot: Bot = {
  ...fixture_bot,
  id: 'other-bot',
  owner: other_google.toSuiAddress(),
  zklogin_public_identifier: other_google.toBase64(),
  address: `0x${'b'.repeat(64)}`,
  multisig_public_key: 'other-public-descriptor',
}
/** A live grant of `bot`, exchanged and without a token family. */
export const grant_of = (bot: Bot, patch: Partial<Grant> = {}): Grant => ({
  id: 'grant',
  authority_generation: fixture_config.authority_generation,
  owner: bot.owner,
  client_id: 'client',
  bot_id: bot.id,
  network: 'mainnet',
  address: bot.address,
  descriptor: bot.multisig_public_key,
  generation: bot.generation,
  resource: fixture_config.resource,
  scopes: fixture_config.scopes,
  policy_revision: bot.policy.revision,
  revoked: false,
  code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
  family: null,
  access: null,
  ...patch,
})
/** A stored grant with a bearer token, for callers that skip the consent flow. */
export const bearer_grant = async (store: ControlStore, patch: Partial<Grant> = {}) => {
  const [grant_id, secret] = [random_secret(), random_secret()]
  await put(store, `bot:${fixture_bot.id}`, fixture_bot)
  await put(
    store,
    `grant:${grant_id}`,
    grant_of(fixture_bot, {
      id: grant_id,
      access: { hash: hash_secret(secret), expires_at: Date.now() + 60_000 },
      ...patch,
    })
  )
  return { grant_id, token: `${grant_id}.${secret}` }
}
/** A publicly known SDK fixture seed, never funded: the managed signer without Redis or a key service. */
export const fixture_key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
export const fixture_provider = (): ManagedProvider => {
  const reference = { key_id: 'fixture:signing:known-test-key', public_key: fixture_key.getPublicKey().toBase64() }
  return {
    prepare: async () => ({ key: reference, sealed: 'public-test-fixture' }),
    signer: (requested) => {
      if (requested.key_id !== reference.key_id || requested.public_key !== reference.public_key)
        throw new Error('FIXTURE_SIGNING_KEY_MISMATCH')
      return create_managed_agent_signer({
        public_key: fixture_key.getPublicKey().toRawBytes(),
        sign_digest: (bytes) => fixture_key.sign(bytes),
      })
    },
  }
}
/** A keyring file as the deployment mounts it. */
export const keyring_json = (keys: Readonly<Record<string, number>>, active = Object.keys(keys)[0]!) =>
  JSON.stringify({
    active_key_id: active,
    keys: Object.fromEntries(
      Object.entries(keys).map(([key_id, fill]) => [key_id, Buffer.alloc(32, fill).toString('base64')])
    ),
  })
export const REDIS_URL = process.env.TEST_BOT_REDIS_URL
/** A Redis-backed case: CI provides the disposable loopback database. */
export const integration = REDIS_URL ? test : test.skip
/** One disposable namespace of the loopback database, removed with every record it wrote. */
export const redis_space = async () => {
  const redis = fixture_redis(REDIS_URL!)
  await redis.connect()
  // The client selects the fixture database on connect; the first reply settles that handshake.
  await redis.send('PING', [])
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  const store = create_redis_store(redis, namespace)
  const key = (logical: string) => `${namespace}:record:${logical}`
  const dispose = async () => {
    if (redis.connected) {
      const records: string[] = await redis.send('KEYS', [`${namespace}*`])
      if (records.length) await redis.send('DEL', records)
    }
    redis.close()
  }
  return { redis, namespace, store, key, dispose }
}
export const fixture_redis = (url: string) => {
  const target = new URL(url)
  if (target.protocol !== 'redis:' || target.hostname !== '127.0.0.1' || target.pathname !== '/15')
    throw new Error('disposable loopback Redis database 15 only')
  return new RedisClient(url, { autoReconnect: false, enableOfflineQueue: false })
}

/** A provisioned bot, its live grant and the actor runtime on a fake game socket and SDK client. */
export const runtime_fixture = async (store: ControlStore = memory_store()) => {
  const provider = fixture_provider()
  await request_provisioning(store, {
    id: 'bot',
    owner: fixture_google.toSuiAddress(),
    zklogin_public_identifier: fixture_google.toBase64(),
    policy: { revision: 1, scopes: fixture_config.scopes },
  })
  const bot = await run_provisioning(store, provider, 'bot')
  const grant = grant_of(bot)
  await put(store, 'grant:grant', grant)
  const clock = { now: 1000, monotonic: 100 }
  const sockets: { handlers: Parameters<AgentTransport['open']>[1]; closed: boolean; sent: string[] }[] = []
  const errors: unknown[] = []
  const options = {
    store,
    config: fixture_config,
    provider,
    endpoint: 'ws://127.0.0.1:0/',
    origin: fixture_config.web_origin,
    actor_id: 'actor',
    lease_ms: 10000,
    scan_limit: 100,
    observation_freshness_ms: 60000,
    sdk_options: { client: fake_client({ simulate_ok: true }) },
    now: () => clock.now,
    monotonic_now: () => clock.monotonic,
    report_failure: (error: unknown) => {
      errors[errors.length] = error
    },
    transport: {
      open: (_url: string, handlers: Parameters<AgentTransport['open']>[1]) => {
        const socket = { handlers, closed: false, sent: [] as string[] }
        sockets[sockets.length] = socket
        return {
          send: (raw: string) => {
            socket.sent[socket.sent.length] = raw
          },
          close: () => {
            socket.closed = true
          },
        }
      },
    },
  }
  const runtime = create_actor_runtime(options)
  const observe = (payload: Readonly<Record<string, unknown>> = {}) => runtime.observe(grant, payload)
  const send = async (packet: unknown) => sockets.at(-1)!.handlers.on_message(JSON.stringify(packet))
  /** The server admits the bot's socket: freeze state, identity, clock and its roster. */
  const admit = async (characters: readonly unknown[] = [], chain_ms = 1000) => {
    await send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
    await send({ type: 'packet/game_state', frozen: false })
    await send({ type: 'packet/connection_accepted', address: bot.address })
    await send({
      type: 'packet/server_info',
      online: 1,
      online_characters: characters.length,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: chain_ms,
      chain_sample_age_ms: 0,
    })
    await send({ type: 'packet/characters', characters })
  }
  return { store, bot, grant, clock, options, runtime, observe, send, admit, sockets, errors }
}

type Http = ReturnType<typeof http_fixture>
/** The HTTP door with a synthetic zkLogin verifier; real provider proofs stay a live release gate. */
export const http_fixture = (
  store: ControlStore = memory_store(),
  config: BotConfig = fixture_config,
  observe?: Observe,
  door: Partial<Pick<Parameters<typeof create_ingress>[0], 'visitor_limiter' | 'owner_limiter'>> = {}
) => {
  const ingress = create_ingress({
    store,
    config,
    observe,
    ...door,
    verify_owner: async (challenge, signature) => {
      if (signature !== `fixture:${hash_secret(challenge.message)}`) throw new Error('invalid_owner_signature')
    },
    policy: { revision: 1, scopes: config.scopes },
    observation_freshness_ms: config.observation_freshness_ms,
    provision_enabled: true,
    play_enabled: true,
  })
  const cookies = new Map<string, string>()
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  const request = async (path: string, body?: unknown, bearer?: string) => {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (path.startsWith('/connect/')) {
      headers.set('origin', config.web_origin)
      headers.set('cookie', cookie())
    }
    if (bearer) headers.set('authorization', `Bearer ${bearer}`)
    const response = await ingress(
      new Request(`${config.issuer}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
    const set_cookie = response.headers.get('set-cookie')
    if (set_cookie) {
      const [name, value] = set_cookie.split(';')[0]!.split('=')
      if (set_cookie.includes('Max-Age=0')) cookies.delete(name!)
      else cookies.set(name!, value!)
    }
    return response
  }
  const json = async <T>(path: string, body?: unknown, bearer?: string): Promise<T> => {
    const response = await request(path, body, bearer)
    const value = (await response.json()) as T
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`)
    return value
  }
  /** A browser request with exactly this cookie header. */
  const raw = (path: string, cookie_header: string, body?: unknown) =>
    ingress(
      new Request(config.issuer + path, {
        method: body ? 'POST' : 'GET',
        headers: { origin: config.web_origin, cookie: cookie_header, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    )
  const call = async (token: string, name: string, args: unknown = {}) =>
    (
      await json<{ result: { isError: boolean; structuredContent: Record<string, unknown>; _meta?: unknown } }>(
        '/mcp',
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        token
      )
    ).result
  return {
    store,
    config,
    ingress,
    request,
    json,
    raw,
    call,
    cookie,
    signature: (message: string) => `fixture:${hash_secret(message)}`,
  }
}
/** An MCP client registers and asks authorization; the browser gets the request cookie. */
export const begin_authorization = async (f: Http, scope = f.config.scopes.join(' ')) => {
  const client = await f.json<{ client_id: string }>('/oauth/register', {
    client_name: 'Fixture connector',
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'none',
  })
  const verifier = random_secret()
  const response = await f.request(
    `/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://client.example.test/callback',
      response_type: 'code',
      scope,
      resource: f.config.resource,
      state: 'fixture-state',
      code_challenge_method: 'S256',
      code_challenge: hash_secret(verifier),
    })}`
  )
  const authorization_id = new URL(response.headers.get('location')!).searchParams.get('authorization_id')!
  const header = response.headers.get('set-cookie')!
  return { authorization_id, header, cookie: header.split(';')[0]!, client_id: client.client_id, verifier, response }
}
export const consent_input = (authorization_id: string, bot: Bot) => ({
  authorization_id,
  owner: bot.owner,
  zklogin_public_identifier: bot.zklogin_public_identifier,
  purpose: 'consent',
  bot_id: bot.id,
  generation: bot.generation,
  address: bot.address,
  multisig_public_key: bot.multisig_public_key,
  policy_revision: bot.policy.revision,
})
/** An authorization request whose browser session the owner of `bot` proved. */
export const owner_session = async (f: Http, bot: Bot = fixture_bot) => {
  const begun = await begin_authorization(f)
  const identity = {
    authorization_id: begun.authorization_id,
    owner: bot.owner,
    zklogin_public_identifier: bot.zklogin_public_identifier,
  }
  const session = await f.json<HostedChallengeResponse>('/connect/challenge', { ...identity, purpose: 'session' })
  await f.json('/connect/verify', { challenge_id: session.challenge_id, signature: f.signature(session.message) })
  return { ...begun, identity }
}
/** The owner proves the session, consents to `bot` and the client exchanges the code. */
export const connect_bot = async (f: Http, bot: Bot = fixture_bot, before_authorize = async () => {}) => {
  const { identity, ...begun } = await owner_session(f, bot)
  await put(f.store, `bot:${bot.id}`, bot)
  const tokens = async () => {
    const consent = await f.json<HostedChallengeResponse>(
      '/connect/challenge',
      consent_input(begun.authorization_id, bot)
    )
    await before_authorize()
    const authorized = await f.json<HostedAuthorizeResponse>('/connect/authorize', {
      challenge_id: consent.challenge_id,
      signature: f.signature(consent.message),
    })
    return f.json<{ access_token: string; refresh_token: string }>('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: begun.client_id,
      code: new URL(authorized.redirect_url).searchParams.get('code'),
      redirect_uri: 'https://client.example.test/callback',
      code_verifier: begun.verifier,
      resource: f.config.resource,
    })
  }
  return { ...begun, identity, client: { client_id: begun.client_id }, ...(await tokens()), tokens }
}

/** Consent through the services themselves, as the HTTP door calls them. */
export const consented = async (store: ControlStore = memory_store(), clock = { now: 1000 }) => {
  const verify = async (_challenge: unknown, signature: string) => {
    if (signature !== 'fixture-owner-proof') throw new Error('invalid_owner_signature')
  }
  const oauth = create_oauth_service(store, fixture_config, () => clock.now)
  const connect = create_connect_service(store, fixture_config, verify, () => clock.now)
  const client = await oauth.register({
    client_name: 'Fixture connector',
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'none',
  })
  const verifier = random_secret()
  const started = await oauth.begin(
    new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0]!,
      scope: fixture_config.scopes.join(' '),
      resource: fixture_config.resource,
      state: 'client-csrf',
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: hash_secret(verifier),
    })
  )
  const link = new URL(started.location)
  // The owner consents on the site's AI page; the link carries the request and nothing else.
  expect([link.origin, link.pathname, [...link.searchParams.keys()]]).toEqual([
    new URL(fixture_config.web_origin).origin,
    '/agent',
    ['authorization_id'],
  ])
  const authorization_id = link.searchParams.get('authorization_id')!
  const identity = {
    authorization_id,
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  }
  const session = await connect.challenge({ ...identity, purpose: 'session' }, started.session)
  await connect.verify(session.result.challenge_id, 'fixture-owner-proof', started.session)
  await put(store, `bot:${fixture_bot.id}`, fixture_bot)
  const consent = () => connect.challenge(consent_input(authorization_id, fixture_bot) as never, started.session)
  const first = await consent()
  const authorize = async (challenge_id = first.result.challenge_id) =>
    new URL((await connect.authorize(challenge_id, 'fixture-owner-proof', started.session)).redirect_url)
  const token_input = (code: string) => ({
    grant_type: 'authorization_code',
    code,
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code_verifier: verifier,
    resource: fixture_config.resource,
  })
  return { store, clock, oauth, connect, client, started, identity, first, consent, authorize, token_input }
}
