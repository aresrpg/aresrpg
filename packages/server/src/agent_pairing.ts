// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import type { Redis } from 'ioredis'
import type { AgentSetupRequest, AgentSetupResult } from '@aresrpg/protocol'

import {
  parse_agent_pairing_request,
  verify_agent_pairing,
  type AgentPairingRequest,
  type AgentPairingResponse,
} from '../../sdk/src/agent_pairing.ts'

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
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
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
    begin: async (owner: string, public_identifier: string, lifetime_ms: number) => {
      if (!Number.isSafeInteger(lifetime_ms) || lifetime_ms <= 0) throw new Error('INVALID_PAIRING_LIFETIME')
      const request = parse_agent_pairing_request({
        version: 1,
        nonce: randomUUID(),
        network: 'mainnet',
        owner,
        zklogin_public_identifier: public_identifier,
      })
      const token = randomBytes(32).toString('base64url')
      const value: RecordValue = { request, token_hash: hash(token), result: null }
      if ((await redis.set(key(request.nonce), JSON.stringify(value), 'PX', lifetime_ms, 'NX')) !== 'OK')
        throw new Error('PAIRING_UNAVAILABLE')
      return Object.freeze({ id: request.nonce, token })
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
    cancel: async (owner: string, id: string) => {
      const deleted = await redis.eval(
        `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if cjson.decode(raw).request.owner ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`,
        1,
        key(id),
        owner
      )
      if (deleted !== 1) throw new Error('PAIRING_UNAVAILABLE')
    },
    status: async (owner: string, id: string) => {
      const { value } = await read(id)
      if (value.request.owner !== owner) throw new Error('PAIRING_UNAVAILABLE')
      return value.result
    },
  })
  return Object.freeze({
    ...exchange,
    request: async (owner: string, input: AgentSetupRequest): Promise<AgentSetupResult> => {
      switch (input.action) {
        case 'begin': {
          const link = await exchange.begin(owner, input.public_identifier, 300_000)
          return { action: 'begin', pairing_id: link.id, token: link.token }
        }
        case 'status':
          return { action: 'status', identity: await exchange.status(owner, input.pairing_id) }
        case 'cancel': {
          await exchange.cancel(owner, input.pairing_id)
          return { action: 'cancel' }
        }
      }
    },
  })
}
