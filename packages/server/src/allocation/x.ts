// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash, randomBytes } from 'node:crypto'

import type { Redis } from 'ioredis'
import { campaign } from '@aresrpg/immutable/allocation'

import { key } from './store.ts'

export type XUser = Readonly<{ id: string; username: string }>
export type XOptions = Readonly<{ origin: string; client_id?: string; client_secret?: string; bearer?: string }>
export const random_id = (): string => randomBytes(32).toString('hex')
const cookie_value = (request: Request, name: string): string | null =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null
const cookie = (name: string, value: string, origin: string, lifetime: number): string =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${origin.startsWith('https:') ? '; Secure' : ''}`
const callback_url = (origin: string): string => `${origin}/api/allocation?action=callback`
export const redirect = (location: string, set_cookie?: string): Response =>
  new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      ...(set_cookie ? { 'set-cookie': set_cookie } : {}),
    },
  })
export const start_x = async (request: Request, redis: Redis, options: XOptions): Promise<Response> => {
  if (!options.client_id || !options.client_secret) throw new Error('x_unavailable')
  const ticket = new URL(request.url).searchParams.get('ticket') ?? ''
  if (!/^[a-f0-9]{64}$/.test(ticket)) throw new Error('unauthorized')
  const owner = await redis.getdel(key(`link_ticket:${ticket}`))
  if (!owner) throw new Error('unauthorized')
  const state = random_id()
  const verifier = random_id()
  await redis.set(key(`oauth:${state}`), JSON.stringify({ verifier, owner }), 'EX', 600)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.client_id,
    redirect_uri: callback_url(options.origin),
    scope: 'tweet.read users.read',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  })
  return redirect(`https://x.com/i/oauth2/authorize?${params}`, cookie('allocation_oauth', state, options.origin, 600))
}
const x_json = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`x_unavailable`)
  return (await response.json()) as T
}
const consume_oauth = async (request: Request, redis: Redis) => {
  const params = new URL(request.url).searchParams
  const state = params.get('state') ?? ''
  if (!/^[a-f0-9]{64}$/.test(state) || cookie_value(request, 'allocation_oauth') !== state)
    throw new Error('unauthorized')
  const verifier = await redis.getdel(key(`oauth:${state}`))
  const code = params.get('code')
  if (!verifier || !code) throw new Error('unauthorized')
  return { ...(JSON.parse(verifier) as { verifier: string; owner: string }), code }
}
export const finish_x = async (request: Request, redis: Redis, options: XOptions): Promise<Response> => {
  if (!options.client_id || !options.client_secret) throw new Error('x_unavailable')
  const { verifier, code, owner } = await consume_oauth(request, redis)
  const access = await x_json<{ access_token: string }>('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${options.client_id}:${options.client_secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: callback_url(options.origin),
      code_verifier: verifier,
    }),
  })
  const { data } = await x_json<{ data: XUser }>('https://api.x.com/2/users/me', {
    headers: { authorization: `Bearer ${access.access_token}` },
  })
  if (!/^\d+$/.test(data?.id) || !/^[A-Za-z0-9_]+$/.test(data.username)) throw new Error('x_unavailable')
  const token = random_id()
  await redis.set(key(`link_result:${token}`), JSON.stringify({ owner, user: data }), 'EX', 300)
  return redirect(`${options.origin}/allocation?linked=${token}`, cookie('allocation_oauth', '', options.origin, 0))
}

const LINK_X = `
if redis.call('GET', KEYS[3]) ~= 'registration' then return 'closed' end
local clock = redis.call('TIME')
if tonumber(clock[1])*1000 + math.floor(tonumber(clock[2])/1000) >= tonumber(ARGV[4]) then return 'closed' end
local owner = redis.call('HGET', KEYS[1], ARGV[1])
if owner and owner ~= ARGV[2] then return 'wallet_taken' end
local linked = redis.call('HGET', KEYS[2], ARGV[2])
if linked then
  local old = cjson.decode(linked).id
  if old ~= ARGV[1] then
    local entry = redis.call('HGET', KEYS[4], old)
    if entry then
      local address = cjson.decode(entry).address
      if redis.call('HGET', KEYS[5], address) == old then redis.call('HDEL', KEYS[5], address) end
      redis.call('HDEL', KEYS[4], old)
    end
    redis.call('HDEL', KEYS[1], old)
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
return 'ok'
`
export const link_x = async (
  redis: Redis,
  owner: string,
  user: XUser,
  cutoff_ms = Date.parse(campaign.submissions_close_at)
): Promise<void> => {
  const result = await redis.eval(
    LINK_X,
    5,
    key('x_owners'),
    key('linked_x'),
    key('phase'),
    key('submissions'),
    key('wallets'),
    user.id,
    owner,
    JSON.stringify(user),
    cutoff_ms
  )
  if (result !== 'ok') throw new Error(String(result))
}
export const linked_user = async (redis: Redis, owner: string): Promise<XUser | null> => {
  const user = await redis.hget(key('linked_x'), owner)
  return user ? (JSON.parse(user) as XUser) : null
}
export const link_ticket = async (redis: Redis, owner: string, origin: string): Promise<string> => {
  const ticket = random_id()
  await redis.set(key(`link_ticket:${ticket}`), owner, 'EX', 300)
  return `${origin}/api/allocation?action=oauth&ticket=${ticket}`
}
export type XPost = Readonly<{
  id: string
  author_id: string
  created_at: string
  public_metrics: Readonly<{ like_count: number; retweet_count: number; quote_count: number }>
}>
export const fetch_posts = async (
  ids: readonly string[],
  bearer: string | undefined,
  allow_missing = false
): Promise<readonly XPost[]> => {
  if (!bearer || !ids.length || ids.length > 100) throw new Error('x_unavailable')
  const params = new URLSearchParams({ ids: ids.join(','), 'tweet.fields': 'author_id,created_at,public_metrics' })
  const result = await x_json<{ data?: XPost[]; errors?: unknown[] }>(`https://api.x.com/2/tweets?${params}`, {
    headers: { authorization: `Bearer ${bearer}` },
  })
  const posts = result.data ?? []
  if (!allow_missing && posts.length !== ids.length) throw new Error('missing_post')
  return posts
}

/** An X callback alone cannot link accounts: the original game identity must confirm it. */
export const complete_x = async (
  redis: Redis,
  owner: string,
  token: string,
  cutoff_ms = Date.parse(campaign.submissions_close_at)
): Promise<void> => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('unauthorized')
  const value = await redis.getdel(key(`link_result:${token}`))
  if (!value) throw new Error('unauthorized')
  const result = JSON.parse(value) as { owner: string; user: XUser }
  if (result.owner !== owner) throw new Error('unauthorized')
  await link_x(redis, owner, result.user, cutoff_ms)
}
