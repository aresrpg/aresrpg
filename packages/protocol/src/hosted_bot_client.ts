// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * The one client of the hosted bot: a public PKCE OAuth client and an MCP caller. It is transport
 * only: a tool name and its arguments pass through untouched. Fetch, clock, storage and locking are
 * injected, so the same module runs in a Bun service and in the browser bundle.
 */

const PROTOCOL_VERSION = '2025-11-25'
/** An access token is renewed this long before it expires, so a call never starts on a dying one. */
const REFRESH_MARGIN_MS = 60_000
/** Reads that cannot change hosted state: the only calls ever sent twice. Any other tool is a mutation. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'bot_identity',
  'bot_observe',
  'bot_status',
  'bot_behavior_status',
  'bot_validate_behavior',
  'bot_validate_combat_profile',
])

/** What a consent may cover: reading only, or reading, playing and pausing. */
export const OBSERVE_SCOPE = 'bot:observe'
export const PLAY_SCOPE = 'bot:observe bot:play bot:pause'

/**
 * Every failure this client originates; any other code is the bot's own refusal, passed through.
 * `uncertain` means the request may have reached the bot: observe, never send it again.
 * `unavailable` means no usable answer and nothing changed.
 */
export const BOT_FAILURES = [
  'uncertain',
  'unavailable',
  'invalid_token',
  'reauthorization_required',
  'callback_mismatch',
  'owner_mismatch',
  'tool_failed',
] as const
type BotFailure = (typeof BOT_FAILURES)[number]
export type BotResult<T> = Readonly<{ ok: true; value: T } | { ok: false; error: string }>
const ok = <T>(value: T): BotResult<T> => ({ ok: true, value })
const fail = (error: string): BotResult<never> => ({ ok: false, error })
/** For an effectful edge that reports by throwing: the failure code becomes the error message. */
export const unwrap = <T>(result: BotResult<T>): T => {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const code_of = (value: unknown): string | null => (typeof value === 'string' && /^[a-z_]+$/.test(value) ? value : null)
/** The named fields, when every one of them is a non-empty string. */
const strings = <K extends string>(
  row: Record<string, unknown> | null,
  keys: readonly K[]
): Record<K, string> | null =>
  row && keys.every((key) => text(row[key]))
    ? (Object.fromEntries(keys.map((key) => [key, row[key]])) as Record<K, string>)
    : null

/** What a grant acts for: the verified owner and the exact hosted wallet. */
export type BotIdentity = Readonly<{
  owner: string
  bot_id: string
  address: string
  descriptor: string
  generation: number
  grant_id: string
  expires_at: number
  network: 'mainnet'
}>
const identity_of = (value: unknown): BotIdentity | null => {
  const row = record(value)
  const fields = strings(row, ['owner', 'bot_id', 'address', 'descriptor', 'grant_id'])
  if (!fields || row?.network !== 'mainnet') return null
  const { generation, expires_at } = row
  return whole(generation) && whole(expires_at) ? { ...fields, generation, expires_at, network: 'mainnet' } : null
}
export type BotTokens = Readonly<{
  issuer: string
  client_id: string
  access_token: string
  refresh_token: string
  scope: string
  /** When the access token ends, in milliseconds. */
  expires_at: number
}>
/** The one grant record: tokens and the identity they were verified for. */
export type BotGrant = BotTokens & Readonly<{ identity: BotIdentity }>
export const grant_of = (value: unknown): BotGrant | null => {
  const row = record(value)
  const fields = strings(row, ['issuer', 'client_id', 'access_token', 'refresh_token', 'scope'])
  const identity = identity_of(row?.identity)
  const expires_at = row?.expires_at
  return fields && identity && whole(expires_at) ? { ...fields, expires_at, identity } : null
}
export type PendingAuthorization = Readonly<{
  client_id: string
  redirect_uri: string
  scope: string
  state: string
  verifier: string
  expires_at: number
}>
/** A stored request is usable only while complete and before its deadline. */
export const pending_of = (value: unknown, now: number): PendingAuthorization | null => {
  const row = record(value)
  const fields = strings(row, ['client_id', 'redirect_uri', 'scope', 'state', 'verifier'])
  const expires_at = Number(row?.expires_at)
  return fields && expires_at > now ? { ...fields, expires_at } : null
}
/** Scopes compare as sets: their order on the wire carries no meaning. */
export const same_scope = (left: string, right: string): boolean =>
  [...left.split(' ')].sort().join(' ') === [...right.split(' ')].sort().join(' ')

const base64url = (bytes: Readonly<Uint8Array>): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
/** 32 random bytes encode to the 43 characters the bot requires for verifiers and states. */
export const random_token = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)))
const code_challenge = async (verifier: string): Promise<string> =>
  base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

export type BotFetch = (url: string, init: RequestInit) => Promise<Response>
type Reply = Readonly<{ status: number; body: Record<string, unknown> }>
const NO_ANSWER = 'no_answer'
/** One JSON POST that never follows a redirect: the reply with its status, or a failure when none arrived in time. */
export const post_json = async (
  fetcher: BotFetch,
  url: string,
  body: unknown,
  options: Readonly<{ timeout_ms: number; headers?: Readonly<Record<string, string>>; signal?: AbortSignal }>
): Promise<BotResult<Reply>> => {
  const deadline = AbortSignal.timeout(options.timeout_ms)
  try {
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
    })
    // A body that is not JSON travels as its parse failure, so only the status classifies that reply.
    const content: unknown = await response.json().catch((error: unknown) => ({ error }))
    return ok({ status: response.status, body: record(content) ?? {} })
  } catch {
    return fail(NO_ANSWER)
  }
}
/** The body of an accepted reply. A refusal keeps the bot's code; `lost` names what silence means for this request. */
const accepted = (reply: BotResult<Reply>, lost: BotFailure): BotResult<Record<string, unknown>> => {
  if (!reply.ok) return fail(lost)
  const { status, body } = reply.value
  if (status === 401) return fail('invalid_token')
  return status < 400 ? ok(body) : fail(code_of(body.error) ?? 'unavailable')
}
/** What an unanswered or unreadable call means: a read changed nothing, a mutation may have run. */
const silence = (read_only: boolean): BotFailure => (read_only ? 'unavailable' : 'uncertain')
/** Only the bot's explicit refusal ends a grant; silence keeps it for the next attempt. */
const refresh_refused = (reply: BotResult<Reply>): boolean =>
  reply.ok && [reply.value.status === 401, reply.value.body.error === 'invalid_grant'].some(Boolean)

type Awaitable<T> = T | Promise<T>
/** Where a holder keeps one grant. `replace` writes only while `previous` is still the stored grant. */
export type GrantStore = Readonly<{
  read: () => Awaitable<BotGrant | null>
  replace: (previous: BotGrant, next: BotGrant | null) => Awaitable<boolean>
}>
type Lock = <T>(key: string, task: () => Promise<T>) => Promise<T>
/** One task at a time per key inside this process. */
const serial = (): Lock => {
  const tails = new Map<string, Promise<unknown>>()
  return (key, task) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(task)
    // The queue only needs to know the task ended; its failure still reaches the caller through `run`.
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    tails.set(key, tail)
    void tail.then(() => tails.get(key) === tail && tails.delete(key))
    return run
  }
}

export type BotEnv = Readonly<{
  issuer: string
  fetch: BotFetch
  now: () => number
  timeout_ms: number
  /** Ends the requests of a holder that went away, such as a closed page. */
  signal?: AbortSignal
  /** Serializes a task per owner across every holder of one grant store; inside this process when absent. */
  lock?: Lock
}>
export const create_bot_client = (env: BotEnv) => {
  const { issuer } = env
  const origin = new URL(issuer)
  if (origin.protocol !== 'https:' || origin.origin !== issuer) throw new Error('invalid_issuer')
  const resource = `${issuer}/mcp`
  const lock = env.lock ?? serial()
  /** A 5xx reply proves nothing about what the bot did, exactly like no reply. */
  const post = async (path: string, body: unknown, headers?: Readonly<Record<string, string>>) => {
    const reply = await post_json(env.fetch, `${issuer}${path}`, body, {
      timeout_ms: env.timeout_ms,
      headers,
      signal: env.signal,
    })
    return reply.ok && reply.value.status >= 500 ? fail(NO_ANSWER) : reply
  }
  const tokens_of = (body: Record<string, unknown>, client_id: string): BotTokens | null => {
    const fields = strings(body, ['access_token', 'refresh_token', 'scope'])
    const { expires_in, token_type } = body
    if (!fields || token_type !== 'Bearer' || !whole(expires_in) || expires_in === 0) return null
    return { issuer, client_id, ...fields, expires_at: env.now() + expires_in * 1000 }
  }

  /** Registers this public client and prepares one authorization request. Nothing is stored here. */
  const begin = async (
    request: Readonly<{ client_name: string; redirect_uri: string; scope: string; ttl_ms: number }>
  ): Promise<BotResult<PendingAuthorization>> => {
    const { client_name, redirect_uri, scope, ttl_ms } = request
    const registered = accepted(
      await post('/oauth/register', {
        client_name,
        redirect_uris: [redirect_uri],
        token_endpoint_auth_method: 'none',
      }),
      'unavailable'
    )
    if (!registered.ok) return registered
    const client_id = text(registered.value.client_id)
    if (!client_id) return fail('unavailable')
    const [state, verifier] = [random_token(), random_token()]
    return ok({ client_id, redirect_uri, scope, state, verifier, expires_at: env.now() + ttl_ms })
  }
  const authorization_url = async (pending: PendingAuthorization): Promise<string> =>
    `${issuer}/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      scope: pending.scope,
      state: pending.state,
      code_challenge: await code_challenge(pending.verifier),
      code_challenge_method: 'S256',
      resource,
    })}`
  /** The code of a callback that answers exactly this request: its state, from this issuer (RFC 9207). */
  const authorization_code = (pending: PendingAuthorization, params: Readonly<URLSearchParams>): BotResult<string> => {
    const code = params.get('code')
    const matches = [params.get('state') === pending.state, params.get('iss') === issuer].every(Boolean)
    return code && matches ? ok(code) : fail('callback_mismatch')
  }
  /** A code is single use: a lost reply may have issued the grant, so it is uncertain and never asked again. */
  const exchange = async (pending: PendingAuthorization, code: string): Promise<BotResult<BotTokens>> => {
    const body = accepted(
      await post('/oauth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirect_uri,
        client_id: pending.client_id,
        resource,
      }),
      'uncertain'
    )
    if (!body.ok) return body
    const tokens = tokens_of(body.value, pending.client_id)
    return tokens ? ok(tokens) : fail('uncertain')
  }
  /** Revoking is idempotent on the bot, and either token of a grant ends the whole grant. */
  const revoke = async (tokens: BotTokens): Promise<BotResult<null>> => {
    const body = accepted(
      await post('/oauth/revoke', { token: tokens.refresh_token, client_id: tokens.client_id }),
      'unavailable'
    )
    return body.ok ? ok(null) : body
  }

  const rpc = async (token: string, method: string, params: Readonly<Record<string, unknown>>, read_only: boolean) => {
    const send = () =>
      post(
        '/mcp',
        { jsonrpc: '2.0', id: 1, method, params },
        { authorization: `Bearer ${token}`, 'mcp-protocol-version': PROTOCOL_VERSION }
      )
    const first = await send()
    // A lost read changed nothing, so it is asked once more. A lost mutation is never sent twice.
    const reply = !first.ok && read_only ? await send() : first
    const body = accepted(reply, silence(read_only))
    if (!body.ok) return body
    const result = record(body.value.result)
    return result ? ok(result) : fail(silence(read_only))
  }
  /** A tool refusal keeps its code; anything that is not a structured result is a failure, never data. */
  const tool = async (
    token: string,
    name: string,
    args: Readonly<Record<string, unknown>>
  ): Promise<BotResult<Record<string, unknown>>> => {
    const read_only = READ_ONLY_TOOLS.has(name)
    const result = await rpc(token, 'tools/call', { name, arguments: args }, read_only)
    if (!result.ok) return result
    const content = record(result.value.structuredContent)
    const refused = [result.value.isError === true, 'error' in (content ?? {})].some(Boolean)
    if (refused) return fail(code_of(content?.error) ?? 'tool_failed')
    return content ? ok(content) : fail(silence(read_only))
  }
  const tool_names = async (token: string): Promise<BotResult<readonly string[]>> => {
    const listed = await rpc(token, 'tools/list', {}, true)
    if (!listed.ok) return listed
    const { tools } = listed.value
    return ok(Array.isArray(tools) ? tools.flatMap((entry: unknown) => text(record(entry)?.name) ?? []) : [])
  }
  const identity = async (token: string): Promise<BotResult<BotIdentity>> => {
    const content = await tool(token, 'bot_identity', {})
    if (!content.ok) return content
    const parsed = identity_of(content.value)
    return parsed ? ok(parsed) : fail('unavailable')
  }
  /**
   * Reads who fresh tokens act for. A grant for another owner than expected is revoked at once, and
   * `owner_mismatch` reports that revoke confirmed: nothing is left for the holder to revoke. A revoke
   * that failed reports its own failure instead, and the holder still holds a live grant.
   */
  const verify = async (tokens: BotTokens, expected_owner: string | null): Promise<BotResult<BotGrant>> => {
    const read = await identity(tokens.access_token)
    if (!read.ok) return read
    if (expected_owner !== null && read.value.owner !== expected_owner) {
      const revoked = await revoke(tokens)
      return revoked.ok ? fail('owner_mismatch') : revoked
    }
    return ok({ ...tokens, identity: read.value })
  }

  const stored_grant = async (store: GrantStore): Promise<BotGrant | null> => {
    const grant = await store.read()
    return grant?.issuer === issuer ? grant : null
  }
  /** A rotation is adopted only as the same consent; any other answer leaves the stored grant untouched. */
  const rotated = (reply: BotResult<Reply>, stored: BotGrant): BotGrant | null => {
    const body = accepted(reply, 'unavailable')
    const tokens = body.ok ? tokens_of(body.value, stored.client_id) : null
    return tokens && same_scope(tokens.scope, stored.scope) ? { ...tokens, identity: stored.identity } : null
  }
  /**
   * One refresh at a time per owner. Another holder of the same store may already have rotated this
   * grant, and presenting its used refresh token would make the bot revoke the whole grant, so the
   * stored grant is read again first and adopted when it differs.
   */
  const renew = (store: GrantStore, presented: BotGrant): Promise<BotResult<BotGrant>> =>
    lock(presented.identity.owner, async () => {
      const stored = await stored_grant(store)
      if (!stored) return fail('reauthorization_required')
      if (stored.refresh_token !== presented.refresh_token) return ok(stored)
      const reply = await post('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: stored.refresh_token,
        client_id: stored.client_id,
        resource,
      })
      if (refresh_refused(reply)) {
        await store.replace(stored, null)
        return fail('reauthorization_required')
      }
      const next = rotated(reply, stored)
      if (!next) return fail('unavailable')
      // A grant removed or replaced meanwhile wins: a late rotation never restores authority.
      return (await store.replace(stored, next)) ? ok(next) : fail('reauthorization_required')
    })
  /** The stored grant with a usable access token, renewed ahead of its expiry. */
  const fresh = async (store: GrantStore): Promise<BotResult<BotGrant>> => {
    const stored = await stored_grant(store)
    if (!stored) return fail('reauthorization_required')
    return stored.expires_at - REFRESH_MARGIN_MS > env.now() ? ok(stored) : renew(store, stored)
  }
  /**
   * One request under the stored grant. A 401 never reached execution; only a read is asked again,
   * once, after a refresh. A mutation is never sent twice.
   */
  const authorized = async <T>(
    store: GrantStore,
    read_only: boolean,
    request: (token: string) => Promise<BotResult<T>>
  ): Promise<BotResult<T>> => {
    const granted = await fresh(store)
    if (!granted.ok) return granted
    const first = await request(granted.value.access_token)
    const rejected = !first.ok && first.error === 'invalid_token'
    if (!rejected || !read_only) return first
    const renewed = await renew(store, granted.value)
    return renewed.ok ? request(renewed.value.access_token) : renewed
  }
  /** Every call re-reads the store, so holders of one stored grant always use its current tokens. */
  const session = (store: GrantStore) => ({
    call: (name: string, args: Readonly<Record<string, unknown>> = {}) =>
      authorized(store, READ_ONLY_TOOLS.has(name), (token) => tool(token, name, args)),
    tools: () => authorized(store, true, tool_names),
    identity: () => authorized(store, true, identity),
  })
  return { begin, authorization_url, authorization_code, exchange, verify, revoke, session }
}
export type BotClient = Readonly<ReturnType<typeof create_bot_client>>
