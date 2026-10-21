// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import {
  campaign,
  blast_csv,
  normalize_address,
  rank_social,
  select_awards,
  validate_reserved,
  type Award,
  type Board,
  type Metrics,
  type Submission,
} from '../packages/immutable/src/allocation.ts'
import { LEADERBOARD_METRICS } from '../packages/protocol/src/leaderboards.ts'
import { connect_redis, key, read_json, read_submissions } from '../packages/server/src/allocation/store.ts'
import { fetch_posts } from '../packages/server/src/allocation/x.ts'

type Snapshot = Readonly<{
  campaign: typeof campaign
  captured_at: string
  checkpoint: number
  checkpoint_timestamp_ms: number
  boards: readonly Board[]
  reserved: readonly Award[]
  submissions: readonly Submission[]
  metrics: readonly Metrics[]
}>
type Result = Readonly<{ snapshot_hash: string; awards: readonly Award[]; excluded_users: readonly string[] }>
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T
const save = async (path: string, data: unknown): Promise<void> =>
  writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
const hash = (data: unknown): string => createHash('sha256').update(JSON.stringify(data)).digest('hex')

const snapshot_boards = async () => {
  const redis = await connect_redis(process.env.ALLOCATION_LEADERBOARD_REDIS_URL)
  try {
    const before = await redis.mget('leaderboards:meta', 'leaderboards:pending')
    if (!before[0] || before[1])
      throw new Error('Leaderboard projection is unavailable or updating; retry snapshot before collecting X metrics.')
    const boards: Board[] = []
    for (const metric of LEADERBOARD_METRICS) {
      const members = await redis.zrange(`leaderboards:${metric}:rank`, 0, 99)
      const addresses = members.map((member) => {
        if (!/^\d{39}:0x[0-9a-f]{64}$/.test(member)) throw new Error('Invalid leaderboard member')
        return normalize_address(member.slice(40))
      })
      boards.push({ metric, addresses })
    }
    const after = await redis.mget('leaderboards:meta', 'leaderboards:pending')
    if (before[0] !== after[0] || after[1]) throw new Error('Leaderboard changed during capture; retry snapshot.')
    const meta = JSON.parse(before[0]) as { checkpoint: number; timestamp_ms: number }
    if (![meta.checkpoint, meta.timestamp_ms].every(Number.isSafeInteger) || Date.now() - meta.timestamp_ms > 300000)
      throw new Error('Leaderboard checkpoint is invalid or more than five minutes old.')
    return { boards, checkpoint: meta.checkpoint, checkpoint_timestamp_ms: meta.timestamp_ms }
  } finally {
    redis.disconnect()
  }
}

const capture = async (output: string): Promise<void> => {
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    // Closing is atomic with submission admission. A failed capture remains closed for an explicit retry.
    const closed = await redis.eval(
      "local phase = redis.call('GET', KEYS[1]) if phase ~= 'registration' and phase ~= 'review' then return 0 end redis.call('SET', KEYS[1], 'review') return 1",
      1,
      key('phase')
    )
    if (closed !== 1) throw new Error('Campaign finalized during capture')
    const leaderboard = await snapshot_boards()
    const submissions = await read_submissions(redis)
    const ids = [...new Set(submissions.flatMap(({ posts }) => posts))]
    const metrics: Metrics[] = []
    for (let offset = 0; offset < ids.length; offset += 100) {
      const posts = await fetch_posts(ids.slice(offset, offset + 100), process.env.ALLOCATION_X_BEARER, true)
      const observed_at = new Date().toISOString()
      metrics.push(
        ...posts.map(({ id, author_id, public_metrics }) => ({
          id,
          author_id,
          likes: public_metrics.like_count,
          reposts: public_metrics.retweet_count,
          quotes: public_metrics.quote_count,
          observed_at,
        }))
      )
    }
    const snapshot: Snapshot = {
      campaign,
      captured_at: new Date().toISOString(),
      ...leaderboard,
      submissions,
      metrics,
      reserved: (await read_json<readonly Award[]>(redis, 'reserved')) ?? [],
    }
    await save(output, snapshot)
    console.log(`Saved ${submissions.length} submissions and nine boards. Snapshot SHA-256: ${hash(snapshot)}`)
  } finally {
    redis.disconnect()
  }
}

const rank = async (input: string, output: string, exclusions?: string): Promise<void> => {
  const snapshot = await read<Snapshot>(input)
  if (JSON.stringify(snapshot.campaign) !== JSON.stringify(campaign))
    throw new Error('Snapshot uses different campaign rules')
  if (snapshot.boards.map(({ metric }) => metric).join() !== LEADERBOARD_METRICS.join())
    throw new Error('Invalid board order')
  const excluded_users = exclusions ? await read<readonly string[]>(exclusions) : []
  if (!Array.isArray(excluded_users) || excluded_users.some((id) => typeof id !== 'string'))
    throw new Error('Exclusions must be X user ID strings')
  const submissions = snapshot.submissions.filter(({ user_id }) => !excluded_users.includes(user_id))
  const ranked = rank_social(submissions, snapshot.metrics)
  const awards = select_awards(snapshot.reserved, snapshot.boards, ranked)
  await save(output, { snapshot_hash: hash(snapshot), awards, excluded_users } satisfies Result)
  await save(`${output}.scores.json`, ranked)
  console.log(`Prepared ${awards.length} awards. Review ${output} and ${output}.scores.json before export.`)
}

const import_reserved = async (input: string): Promise<void> => {
  const awards = validate_reserved(await read<readonly Award[]>(input))
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    const accepted = await redis.eval(
      "if redis.call('GET', KEYS[1]) ~= 'registration' then return 0 end redis.call('SET', KEYS[2], ARGV[1]) return 1",
      2,
      key('phase'),
      key('reserved'),
      JSON.stringify(awards)
    )
    if (accepted !== 1) throw new Error('Reserved addresses can only change during registration')
    console.log(`Imported ${awards.length} reserved addresses.`)
  } finally {
    redis.disconnect()
  }
}
const write_csv = async (path: string, csv: string): Promise<void> => {
  try {
    await writeFile(path, csv, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    if ((await readFile(path, 'utf8')) !== csv)
      throw new Error('Existing CSV differs; refusing to overwrite it', { cause: error })
  }
}
const finalize = async (input: string, snapshot_path: string, output: string): Promise<void> => {
  const result = await read<Result>(input)
  const snapshot = await read<Snapshot>(snapshot_path)
  if (JSON.stringify(snapshot.campaign) !== JSON.stringify(campaign))
    throw new Error('Snapshot uses different campaign rules')
  if (hash(snapshot) !== result.snapshot_hash) throw new Error('Snapshot hash mismatch')
  const expected = select_awards(
    snapshot.reserved,
    snapshot.boards,
    rank_social(
      snapshot.submissions.filter(({ user_id }) => !result.excluded_users.includes(user_id)),
      snapshot.metrics
    )
  )
  if (JSON.stringify(result.awards) !== JSON.stringify(expected))
    throw new Error('Results do not match selection rules')
  const csv = blast_csv(result.awards)
  await write_csv(output, csv)
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    const accepted = await redis.eval(
      "local phase = redis.call('GET', KEYS[1]) if phase == 'final' and redis.call('GET', KEYS[2]) == ARGV[1] and redis.call('GET', KEYS[3]) == ARGV[2] then return 1 end if phase ~= 'review' then return 0 end redis.call('SET', KEYS[2], ARGV[1]) redis.call('SET', KEYS[3], ARGV[2]) redis.call('SET', KEYS[1], 'final') return 1",
      3,
      key('phase'),
      key('awards'),
      key('snapshot_hash'),
      JSON.stringify(result.awards),
      result.snapshot_hash
    )
    if (accepted !== 1) throw new Error('CSV saved, but campaign was not in review; results were not published')
    console.log(
      `Published ${result.awards.length} awards; hand ${output} to Blast. No chain transaction was submitted.`
    )
  } finally {
    redis.disconnect()
  }
}

const initialize = async (): Promise<void> => {
  const redis = await connect_redis(process.env.ALLOCATION_REDIS_URL)
  try {
    const created = await redis.set(key('phase'), 'registration', 'NX')
    if (!created) throw new Error('Campaign already exists; initialization never resets data')
    console.log('Campaign initialized. Import reserved addresses before opening submissions.')
  } finally {
    redis.disconnect()
  }
}
const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2)
  const commands = new Map<string, Readonly<{ min: number; max: number; run: () => Promise<void> }>>([
    ['init', { min: 0, max: 0, run: initialize }],
    ['import', { min: 1, max: 1, run: () => import_reserved(args[0]) }],
    ['snapshot', { min: 1, max: 1, run: () => capture(args[0]) }],
    ['rank', { min: 2, max: 3, run: () => rank(args[0], args[1], args[2]) }],
    ['finalize', { min: 3, max: 3, run: () => finalize(args[0], args[1], args[2]) }],
  ])
  const selected = commands.get(command)
  if (!selected || args.length < selected.min || args.length > selected.max)
    throw new Error(
      'Usage: bun scripts/allocation_campaign.ts init | import reserved.json | snapshot snapshot.json | rank snapshot.json results.json [excluded-user-ids.json] | finalize results.json snapshot.json blast.csv'
    )
  await selected.run()
}
await main()
