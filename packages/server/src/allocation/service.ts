// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Redis } from 'ioredis'
import type { AllocationRequest, AllocationResult } from '@aresrpg/protocol'
import { normalize_address, public_award, type AllocationStatus } from '@aresrpg/immutable/allocation'

import { verify_wallet_message } from '../auth.ts'

import { verified_wallets, wallet_challenge, verify_wallet, remove_wallet, share_wallet } from './wallets.ts'
import { read_awards, read_proofs } from './store.ts'

export type AllocationOptions = Readonly<{
  origin: string
  redis_url?: string
  verify?: typeof verify_wallet_message
}>
export const allocation_status = async (redis: Redis, owner: string): Promise<AllocationStatus> => {
  const wallets = await verified_wallets(redis, owner)
  const requested = new Set(wallets.map(({ address }) => address))
  const awards = (await read_awards(redis)).filter(({ address }) => requested.has(address))
  // Stored proofs are returned only for this account's verified, awarded wallets.
  const stored = awards.length ? await read_proofs(redis) : {}
  const proofs = awards.flatMap(({ address }) => {
    const proof = stored[normalize_address(address)]
    return proof ? [{ address, proof }] : []
  })
  return { wallets, awards: awards.map(public_award), ...(proofs.length ? { proofs } : {}) }
}

/** owner comes exclusively from the admitted game connection, never request JSON. */
export const allocation_request = async (
  redis: Redis,
  owner: string,
  request: AllocationRequest,
  options: AllocationOptions
): Promise<AllocationResult> => {
  switch (request.action) {
    case 'status':
      return { action: 'status', status: await allocation_status(redis, owner) }
    case 'wallet_challenge':
      return wallet_challenge(redis, owner, request.address, request.label, options.origin)
    case 'wallet_verify':
      await verify_wallet(redis, owner, request.nonce, request.signature, options.verify)
      return { action: 'wallet_verify' }
    case 'wallet_remove':
      await remove_wallet(redis, owner, normalize_address(request.address))
      return { action: 'wallet_remove' }
    case 'share':
      return {
        action: 'share',
        url: await share_wallet(redis, owner, normalize_address(request.address), options.origin),
      }
  }
}
const PUBLIC_ERRORS = new Set([
  'invalid_request',
  'invalid_address',
  'unauthorized',
  'wallet_limit',
  'wallet_taken',
  'rate_limited',
])
export const allocation_error = (error: unknown): string =>
  error instanceof Error && PUBLIC_ERRORS.has(error.message) ? error.message : 'unavailable'
