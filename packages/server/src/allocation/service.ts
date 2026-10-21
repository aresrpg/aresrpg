// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Redis } from 'ioredis'
import type { AllocationRequest, AllocationResult } from '@aresrpg/protocol'
import {
  campaign,
  normalize_address,
  public_award,
  submitted_posts,
  type AllocationStatus,
  type Submission,
} from '@aresrpg/immutable/allocation'

import { verify_wallet_message } from '../auth.ts'

import {
  verified_wallets,
  wallet_challenge,
  verify_wallet,
  remove_wallet,
  share_wallet,
  require_wallet,
} from './wallets.ts'
import { key, phase, read_campaign, save_submission } from './store.ts'
import { fetch_posts, linked_user, link_ticket, complete_x, type XOptions } from './x.ts'

export type AllocationOptions = XOptions &
  Readonly<{ redis_url?: string; verify?: typeof verify_wallet_message; cutoff_ms?: number }>
const deadline = (options: AllocationOptions): number => options.cutoff_ms ?? Date.parse(campaign.submissions_close_at)
export const allocation_status = async (
  redis: Redis,
  options: AllocationOptions,
  owner: string
): Promise<AllocationStatus> => {
  const wallets = await verified_wallets(redis, owner)
  const requested = new Set(wallets.map(({ address }) => address))
  const user = await linked_user(redis, owner)
  const submission = user ? await redis.hget(key('submissions'), user.id) : null
  const current = await read_campaign(redis)
  return {
    wallets,
    phase: current.phase,
    submissions_open: current.phase === 'registration' && Date.now() < deadline(options),
    awards: current.awards.filter(({ address }) => requested.has(address)).map(public_award),
    user,
    submission: submission ? (JSON.parse(submission) as Submission) : null,
  }
}
const submit = async (
  redis: Redis,
  owner: string,
  request: Extract<AllocationRequest, { action: 'submit' }>,
  options: AllocationOptions
): Promise<AllocationResult> => {
  const user = await linked_user(redis, owner)
  if (!user) throw new Error('unauthorized')
  if ((await phase(redis)) !== 'registration' || Date.now() >= deadline(options)) throw new Error('closed')
  const address = normalize_address(request.address)
  await require_wallet(redis, owner, address)
  const posts = submitted_posts(request.urls)
  const found = await fetch_posts(posts, options.bearer)
  if (found.some((post) => post.author_id !== user.id)) throw new Error('foreign_post')
  const submission: Submission = {
    user_id: user.id,
    username: user.username,
    address,
    posts,
    submitted_at: new Date().toISOString(),
  }
  await save_submission(redis, submission, deadline(options))
  return { action: 'submit', submission }
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
      return { action: 'status', status: await allocation_status(redis, options, owner) }
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
    case 'link_x':
      return { action: 'link_x', url: await link_ticket(redis, owner, options.origin) }
    case 'complete_x':
      await complete_x(redis, owner, request.token)
      return { action: 'complete_x' }
    case 'submit':
      return submit(redis, owner, request, options)
  }
}
const PUBLIC_ERRORS = new Set([
  'invalid_request',
  'invalid_address',
  'invalid_post',
  'unauthorized',
  'closed',
  'wallet_limit',
  'wallet_taken',
  'wallet_locked',
  'missing_post',
  'foreign_post',
  'rate_limited',
  'x_unavailable',
])
export const allocation_error = (error: unknown): string =>
  error instanceof Error && PUBLIC_ERRORS.has(error.message) ? error.message : 'unavailable'
