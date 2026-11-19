// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Redis } from 'ioredis'
import type { AllocationRequest, AllocationResult } from '@aresrpg/protocol'
import {
  blast_rows,
  normalize_address,
  public_award,
  type AllocationStatus,
  type Award,
} from '@aresrpg/immutable/allocation'

import { verify_wallet_message } from '../auth.ts'

import { blast_allowlist } from './blast_allowlist.ts'
import { verified_wallets, wallet_challenge, verify_wallet, remove_wallet, share_wallet } from './wallets.ts'
import { read_awards } from './store.ts'

export type AllocationOptions = Readonly<{
  origin: string
  redis_url?: string
  verify?: typeof verify_wallet_message
}>
export const allocation_status = async (redis: Redis, owner: string): Promise<AllocationStatus> => {
  const wallets = await verified_wallets(redis, owner)
  const requested = new Set(wallets.map(({ address }) => address))
  const all = await read_awards(redis)
  const awards = all.filter(({ address }) => requested.has(address))
  return {
    wallets,
    awards: awards.map(public_award),
    ...(awards.length ? { proofs: spot_proofs(all, awards) } : {}),
  }
}
/** Proofs come from the complete list, in the exact order handed to Blast. */
const spot_proofs = (all: readonly Award[], own: readonly Award[]) => {
  const allowlist = blast_allowlist(blast_rows(all))
  return own.flatMap(({ address }) => {
    const proof = allowlist.proof(normalize_address(address))
    return proof ? [{ address, proof }] : []
  })
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
