// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stateless authenticated position/chat ingress — the WRITE half only. Redis is the only shared state:
// short-lived latest positions, shared hard rate gates, and one pub/sub channel. The reader is the RPC read
// layer's /v1/stream/presence/:world route (packages/rpc/indexer/src/stream.rs), which owns the snapshot read
// so that expiry semantics have exactly one home.

import { SuiGrpcClient } from '@mysten/sui/grpc'

import { assert_zklogin_challenge } from './zklogin_auth.mjs'

export const POSITION_RATE_LIMIT = Number(process.env.COURIER_POSITION_RATE_LIMIT || 2)
export const POSITION_RATE_WINDOW_MS = Number(process.env.COURIER_POSITION_RATE_WINDOW_MS || 1000)
export const POSITION_TTL_MS = Number(process.env.COURIER_POSITION_TTL_MS || 10_000)
export const CHAT_RATE_LIMIT = Number(process.env.COURIER_CHAT_RATE_LIMIT || 1)
export const CHAT_RATE_WINDOW_MS = Number(process.env.COURIER_CHAT_RATE_WINDOW_MS || 2000)
export const CHAT_MAX_LENGTH = Number(process.env.COURIER_CHAT_MAX_LENGTH || 280)

const NETWORK = process.env.VITE_NETWORK || 'testnet'
const GRPC_URL =
  process.env.COURIER_GRPC_URL || process.env.SPONSOR_GRPC_URL || `https://fullnode.${NETWORK}.sui.io:443`
const CHALLENGE_TTL_MS = Number(process.env.COURIER_CHALLENGE_TTL_MS || 5 * 60_000)
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const SUI_ID = /^0x[0-9a-f]{64}$/i
const CHAT_CHANNEL = /^CHAT_[A-Z_]+$/
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-max-age': '86400',
  'cache-control': 'no-store',
}

export class CourierApiError extends Error {
  /** @param {string} message @param {number} status @param {string} code */
  constructor(message, status = 400, code = 'invalid_request') {
    super(message)
    this.name = 'CourierApiError'
    this.status = status
    this.code = code
  }
}

export const position_key = (world, character) => `courier:position:${world}:${character}`
export const position_index_key = (world) => `courier:positions:${world}`
export const presence_channel = (world) => `courier:presence:${world}`
const rate_key = (kind, address) => `courier:rate:${kind}:${String(address).toLowerCase()}`

const RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`
const POSITION_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
redis.call('PUBLISH', KEYS[3], ARGV[1])
return 1
`

/** Redis implementation shared by endpoint tests and the production lazy client. */
export function create_redis_courier_registry(redis, now = Date.now) {
  return {
    async take_rate_slot(kind, address, limit, window_ms) {
      const count = Number(await redis.send('EVAL', [RATE_SCRIPT, '1', rate_key(kind, address), String(window_ms)]))
      return count <= limit
    },

    async put_position(row, ttl_ms = POSITION_TTL_MS) {
      const payload = JSON.stringify(row)
      await redis.send('EVAL', [
        POSITION_SCRIPT,
        '3',
        position_key(row.world, row.character),
        position_index_key(row.world),
        presence_channel(row.world),
        payload,
        String(ttl_ms),
        String(now() + ttl_ms),
        row.character,
      ])
    },

    async publish_chat(row) {
      await redis.send('PUBLISH', [presence_channel(row.world), JSON.stringify(row)])
    },
  }
}

let production_redis
let production_registry
async function get_production_registry() {
  if (production_registry) return production_registry
  if (typeof Bun === 'undefined')
    throw new CourierApiError('courier store unavailable — Redis requires the Bun service runtime', 503, 'store_down')
  try {
    const { RedisClient } = await import('bun')
    production_redis = new RedisClient(REDIS_URL, { connectionTimeout: 2000, enableOfflineQueue: false })
    production_registry = create_redis_courier_registry(production_redis)
    return production_registry
  } catch (error) {
    throw new CourierApiError(`courier store unavailable: ${error?.message ?? error}`, 503, 'store_down')
  }
}

const production_registry_proxy = {
  take_rate_slot: async (...args) => (await get_production_registry()).take_rate_slot(...args),
  put_position: async (...args) => (await get_production_registry()).put_position(...args),
  publish_chat: async (...args) => (await get_production_registry()).publish_chat(...args),
}

let grpc_client
async function authenticate_courier(input) {
  if (process.env.COURIER_DEV_BYPASS_ZKLOGIN === '1') {
    console.warn('[courier] ⚠️ DEV zkLogin bypass ON — QA/dev throwaway only, never prod')
    return input.sender
  }
  grpc_client ??= new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL })
  return assert_zklogin_challenge({
    ...input,
    purpose: 'aresrpg-courier',
    client: grpc_client,
    ttl_ms: CHALLENGE_TTL_MS,
  })
}

const require_id = (value, name) => {
  const id = String(value ?? '').toLowerCase()
  if (!SUI_ID.test(id)) throw new CourierApiError(`${name} must be a full 0x + 64-hex Sui id`)
  return id
}
const require_number = (value, name) => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new CourierApiError(`${name} must be finite`)
  return number
}
const require_auth = (body) => ({
  sender: require_id(body?.sender, 'sender'),
  challenge: String(body?.challenge ?? ''),
  signature: String(body?.signature ?? ''),
})
const authenticate = async (authenticate_fn, body) => {
  try {
    return await authenticate_fn(require_auth(body))
  } catch (error) {
    if (error instanceof CourierApiError) throw error
    throw new CourierApiError(String(error?.message ?? error), 401, 'authentication_failed')
  }
}
const hard_rate_gate = async (registry, kind, address, limit, window_ms) => {
  let accepted
  try {
    accepted = await registry.take_rate_slot(kind, address, limit, window_ms)
  } catch (error) {
    throw new CourierApiError(`courier store unavailable: ${error?.message ?? error}`, 503, 'store_down')
  }
  if (!accepted) throw new CourierApiError(`${kind} rate limited — retry shortly`, 429, 'rate_limited')
}
const store_effect = async (effect) => {
  try {
    await effect()
  } catch (error) {
    if (error instanceof CourierApiError) throw error
    throw new CourierApiError(`courier store unavailable: ${error?.message ?? error}`, 503, 'store_down')
  }
}

/**
 * Dependency-injected service seam: production uses Redis + real zkLogin; API tests use the same Redis registry
 * with a deterministic auth verifier so they exercise rate/TTL behavior without a fullnode.
 */
export function create_courier_service({
  registry = production_registry_proxy,
  authenticate: authenticate_fn = authenticate_courier,
  now = Date.now,
} = {}) {
  return {
    async post_position(body) {
      const world = require_id(body?.world, 'world')
      const character = require_id(body?.character, 'character')
      const x = require_number(body?.x, 'x')
      const z = require_number(body?.z, 'z')
      const heading = require_number(body?.heading, 'heading')
      const address = String(await authenticate(authenticate_fn, body)).toLowerCase()
      await hard_rate_gate(registry, 'position', address, POSITION_RATE_LIMIT, POSITION_RATE_WINDOW_MS)
      const row = { type: 'position', world, character, address, x, z, heading, observed_at: now() }
      await store_effect(() => registry.put_position(row, POSITION_TTL_MS))
      return row
    },

    async post_chat(body) {
      const world = require_id(body?.world, 'world')
      const character = require_id(body?.character, 'character')
      const text = String(body?.text ?? '').trim()
      if (!text) throw new CourierApiError('text must not be empty')
      if ([...text].length > CHAT_MAX_LENGTH)
        throw new CourierApiError(`text must be at most ${CHAT_MAX_LENGTH} characters`)
      const address = String(await authenticate(authenticate_fn, body)).toLowerCase()
      await hard_rate_gate(registry, 'chat', address, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS)
      const channel = body?.channel && CHAT_CHANNEL.test(String(body.channel)) ? String(body.channel) : 'CHAT_GENERAL'
      const target = String(body?.target ?? '').slice(0, 128)
      const party = body?.party ? require_id(body.party, 'party') : null
      const row = {
        type: 'chat',
        world,
        character,
        address,
        text,
        channel,
        target,
        party,
        sent_at: now(),
      }
      await store_effect(() => registry.publish_chat(row))
      return row
    },
  }
}

const production_service = create_courier_service()

export async function route_courier_post(pathname, body, service = production_service) {
  try {
    if (pathname === '/v1/courier/position') {
      await service.post_position(body)
      return { status: 202, json: { ok: true } }
    }
    if (pathname === '/v1/courier/chat') {
      await service.post_chat(body)
      return { status: 202, json: { ok: true } }
    }
    return { status: 404, json: { error: 'courier route not found', code: 'not_found' } }
  } catch (error) {
    return {
      status: Number(error?.status) || 500,
      json: { error: String(error?.message ?? error), code: error?.code ?? 'internal_error' },
    }
  }
}

export async function courier_fetch(request, service = production_service) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST')
    return Response.json({ error: 'POST only', code: 'method_not_allowed' }, { status: 405, headers: CORS })
  const url = new URL(request.url)
  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid JSON body', code: 'invalid_request' }, { status: 400, headers: CORS })
  }
  const result = await route_courier_post(url.pathname, body, service)
  return Response.json(result.json, { status: result.status, headers: CORS })
}

// Node/Vercel-style adapter, kept beside the Bun fetch handler so the endpoint contract has one route home.
export default async function handler(request, response) {
  Object.entries(CORS).forEach(([key, value]) => response.setHeader(key, value))
  if (request.method === 'OPTIONS') return response.status(204).end()
  if (request.method !== 'POST') return response.status(405).json({ error: 'POST only', code: 'method_not_allowed' })
  const [pathname] = String(request.url || '').split('?')
  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  const result = await route_courier_post(pathname, body)
  return response.status(result.status).json(result.json)
}

if (typeof Bun !== 'undefined' && import.meta.main) {
  const port = Number(process.env.COURIER_PORT || 9529)
  console.log(`[courier] zkLogin-only position/chat ingress net=${NETWORK} :${port}`)
  Bun.serve({ port, fetch: courier_fetch })
}
