// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

import type { Redis } from 'ioredis'
import type { AgentSetupRequest, AgentSetupResult } from '@aresrpg/protocol'
import {
  parse_agent_pairing_request,
  verify_agent_pairing,
  type AgentPairingRequest,
  type AgentPairingResponse,
} from '@aresrpg/sdk/agent-pairing'

type PairingResult = Awaited<ReturnType<typeof verify_agent_pairing>>
type RecordValue = Readonly<{
  request: AgentPairingRequest
  token_hash: string
  result: PairingResult | null
}>
const key = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('PAIRING_UNAVAILABLE')
  return `agent-pairing:${id}`
}
const owner_key = (owner: string) => `agent-pairing-owner:${owner}`
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const begin_pending = `
local fresh = cjson.decode(ARGV[1])
local id = redis.call('GET', KEYS[1])
if id then
  local pending_key = 'agent-pairing:' .. id
  local raw = redis.call('GET', pending_key)
  if raw then
    local value = cjson.decode(raw)
    if value.request.owner ~= fresh.request.owner or
       value.request.zklogin_public_identifier ~= fresh.request.zklogin_public_identifier then
      return redis.error_reply('PAIRING_UNAVAILABLE')
    end
    if value.token_hash ~= fresh.token_hash then
      value.token_hash = fresh.token_hash
      redis.call('SET', pending_key, cjson.encode(value), 'KEEPTTL')
    end
    return id
  end
end
if not redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2], 'NX') then
  return redis.error_reply('PAIRING_UNAVAILABLE')
end
redis.call('SET', KEYS[1], fresh.request.nonce, 'PX', ARGV[2])
return fresh.request.nonce
`
const cancel_pending = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local value = cjson.decode(raw)
if value.request.owner ~= ARGV[1] or value.token_hash ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[2]) == value.request.nonce then redis.call('DEL', KEYS[2]) end
return 1
`
const replace_pending = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1
`

/** owner must come from the existing authenticated game session,
 * never an HTTP body/address query. The caller supplies its explicit preview lifetime.
 * Only public metadata and a setup-token hash reach Redis. No signer or bot runs here. */
export const create_pairing_exchange = (redis: Redis) => {
  const read = async (id: string) => {
    const raw = await redis.get(key(id))
    if (!raw) throw new Error('PAIRING_UNAVAILABLE')
    return { raw, value: JSON.parse(raw) as RecordValue }
  }
  const authorized_setup = async (id: string, token: string) => {
    const entry = await read(id)
    if (!timingSafeEqual(Buffer.from(entry.value.token_hash, 'hex'), Buffer.from(hash(token), 'hex')))
      throw new Error('PAIRING_UNAVAILABLE')
    return entry
  }
  const exchange = Object.freeze({
    begin: async (owner: string, public_identifier: string, lifetime_ms: number, token: string) => {
      if (!Number.isSafeInteger(lifetime_ms) || lifetime_ms <= 0) throw new Error('INVALID_PAIRING_LIFETIME')
      const request = parse_agent_pairing_request({
        version: 1,
        nonce: randomUUID(),
        network: 'mainnet',
        owner,
        zklogin_public_identifier: public_identifier,
      })
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('PAIRING_UNAVAILABLE')
      const value: RecordValue = { request, token_hash: hash(token), result: null }
      const id = await redis.eval(
        begin_pending,
        2,
        owner_key(owner),
        key(request.nonce),
        JSON.stringify(value),
        lifetime_ms
      )
      if (typeof id !== 'string') throw new Error('PAIRING_UNAVAILABLE')
      return Object.freeze({ id, token })
    },
    setup: async (id: string, token: string) => (await authorized_setup(id, token)).value.request,
    complete: async (id: string, token: string, response: AgentPairingResponse) => {
      const { raw, value } = await authorized_setup(id, token)
      if (value.result) throw new Error('PAIRING_ALREADY_COMPLETED')
      const result = await verify_agent_pairing(value.request, response)
      const replaced = await redis.eval(replace_pending, 1, key(id), raw, JSON.stringify({ ...value, result }))
      if (replaced !== 1) throw new Error('PAIRING_UNAVAILABLE')
      return result
    },
    cancel: async (owner: string, id: string, token: string) => {
      const deleted = await redis.eval(cancel_pending, 2, key(id), owner_key(owner), owner, hash(token))
      if (deleted !== 1) throw new Error('PAIRING_UNAVAILABLE')
    },
    status: async (owner: string, id: string, token: string) => {
      const { value } = await authorized_setup(id, token)
      if (value.request.owner !== owner) throw new Error('PAIRING_UNAVAILABLE')
      return value.result
    },
  })
  return Object.freeze({
    ...exchange,
    request: async (owner: string, input: AgentSetupRequest): Promise<AgentSetupResult> => {
      switch (input.action) {
        case 'begin': {
          const link = await exchange.begin(owner, input.public_identifier, 300_000, input.token)
          return { action: 'begin', pairing_id: link.id, token: link.token }
        }
        case 'status':
          return { action: 'status', identity: await exchange.status(owner, input.pairing_id, input.token) }
        case 'cancel': {
          await exchange.cancel(owner, input.pairing_id, input.token)
          return { action: 'cancel' }
        }
      }
    },
  })
}
