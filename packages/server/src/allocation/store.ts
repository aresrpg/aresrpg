// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Redis } from 'ioredis'
import { campaign, type Award, type CampaignPhase, type Submission } from '@aresrpg/immutable/allocation'

export const key = (suffix: string): string => `allocation:${campaign.id}:${suffix}`
export const connect_redis = async (url: string | undefined): Promise<Redis> => {
  if (!url) throw new Error('unavailable')
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null,
  })
  redis.on('error', () => console.error('Allocation Redis connection failed'))
  await redis.connect()
  return redis
}
export const read_json = async <T>(redis: Redis, suffix: string): Promise<T | null> => {
  const value = await redis.get(key(suffix))
  return value === null ? null : (JSON.parse(value) as T)
}
export const phase = async (redis: Redis): Promise<CampaignPhase> => {
  const value = await redis.get(key('phase'))
  if (!['registration', 'review', 'final'].includes(value ?? '')) throw new Error('unavailable')
  return value as CampaignPhase
}
export const read_campaign = async (
  redis: Redis
): Promise<Readonly<{ phase: CampaignPhase; awards: readonly Award[] }>> => {
  const [current, reserved, final] = await redis.mget(key('phase'), key('reserved'), key('awards'))
  if (!['registration', 'review', 'final'].includes(current ?? '')) throw new Error('unavailable')
  const rows = current === 'final' ? final : reserved
  return { phase: current as CampaignPhase, awards: rows ? (JSON.parse(rows) as Award[]) : [] }
}
export const read_submissions = async (redis: Redis): Promise<readonly Submission[]> =>
  Object.values(await redis.hgetall(key('submissions'))).map((value) => JSON.parse(value) as Submission)

const SAVE_SUBMISSION = `
if redis.call('GET', KEYS[1]) ~= 'registration' then return 'closed' end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if now >= tonumber(ARGV[4]) then return 'closed' end
local linked = redis.call('HGET', KEYS[4], ARGV[5])
if not linked or cjson.decode(linked).id ~= ARGV[2] then return 'x_changed' end
local owner = redis.call('HGET', KEYS[2], ARGV[1])
if owner and owner ~= ARGV[2] then return 'wallet_taken' end
local old = redis.call('HGET', KEYS[3], ARGV[2])
if old and cjson.decode(old).address ~= ARGV[1] then return 'wallet_locked' end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
return 'ok'
`
export const save_submission = async (
  redis: Redis,
  account: string,
  submission: Submission,
  cutoff_ms = Date.parse(campaign.submissions_close_at)
): Promise<void> => {
  const result = await redis.eval(
    SAVE_SUBMISSION,
    4,
    key('phase'),
    key('wallets'),
    key('submissions'),
    key('linked_x'),
    submission.address,
    submission.user_id,
    JSON.stringify(submission),
    cutoff_ms,
    account
  )
  if (result !== 'ok') throw new Error(String(result))
}
