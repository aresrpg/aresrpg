// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_leaderboard, ranked_entry, rank_member } from '../../src/reads/get_leaderboard.ts'

const address = (id: number): string => `0x${id.toString(16).padStart(64, '0')}`
const observation = { metric: 'xp' as const, id: 7 }

const projection = (count: number) => {
  const rows = Array.from({ length: count }, (_, index) => ({
    address: address(index),
    score: String(10_000n + BigInt(count - index)),
  }))
  const members = rows.map((row) => rank_member(row.score, row.address))
  const state = {
    meta: JSON.stringify({ reset_at_ms: Date.UTC(2026, 9, 1), timestamp_ms: Date.UTC(2026, 8, 9), checkpoint: 50 }),
    pending: null as string | null,
    mgets: 0,
  }
  const call = async (command: string, ...args: readonly (string | number)[]): Promise<unknown> => {
    if (command === 'MGET') {
      state.mgets++
      return [state.meta, state.pending]
    }
    if (command === 'ZRANGE') {
      expect(args[0]).toBe('leaderboards:xp:rank')
      return members.slice(Number(args[1]), Number(args[2]) + 1)
    }
    if (command === 'HGET') return rows.find((row) => row.address === args[1])?.score ?? null
    if (command === 'ZRANK') {
      const rank = members.indexOf(String(args[1]))
      return rank < 0 ? null : rank
    }
    throw new Error(`unexpected ${command}`)
  }
  return { rows, state, call }
}

test('returns 100 addresses and an exact personal rank outside that window', async () => {
  const redis = projection(500)
  const snapshot = await get_leaderboard(redis, observation, address(499))
  expect(snapshot.entries).toHaveLength(100)
  expect(snapshot.self?.rank).toBe(500)
  expect(snapshot.self?.score).toBe(redis.rows[499]!.score)
  expect(snapshot).toMatchObject({ reset_at_ms: Date.UTC(2026, 9, 1), timestamp_ms: Date.UTC(2026, 8, 9) })
})

test('exact money ordering survives values larger than Number can represent', () => {
  const first = rank_member('9007199254740993', address(2))
  const second = rank_member('9007199254740992', address(1))
  expect(first < second).toBeTrue()
  expect(ranked_entry(first, 1).score).toBe('9007199254740993')
  expect(() => ranked_entry('broken', 1)).toThrow()
})

test('retries a read that crossed an indexed checkpoint', async () => {
  const redis = projection(1)
  let changed = false
  const call = async (command: string, ...args: readonly (string | number)[]): Promise<unknown> => {
    if (command === 'ZRANGE' && !changed) {
      changed = true
      redis.state.meta = JSON.stringify({
        reset_at_ms: Date.UTC(2026, 9, 1),
        timestamp_ms: Date.UTC(2026, 8, 9),
        checkpoint: 51,
      })
    }
    return redis.call(command, ...args)
  }
  const snapshot = await get_leaderboard({ call }, observation, address(0))
  expect(snapshot.checkpoint).toBe(51)
  expect(redis.state.mgets).toBe(4)
})

test('pending writes are unavailable rather than partial standings', async () => {
  const redis = projection(0)
  redis.state.pending = 'unacknowledged write'
  await expect(get_leaderboard(redis, observation, address(1))).rejects.toThrow('updating')
  redis.state.pending = null
  const snapshot = await get_leaderboard(redis, observation, address(1))
  expect(snapshot.entries).toEqual([])
  expect(snapshot.self).toBeNull()
})

test('a rank member replaced between HGET and ZRANK retries rather than failing the read', async () => {
  const redis = projection(1)
  let replaced = false
  const call = async (command: string, ...args: readonly (string | number)[]): Promise<unknown> => {
    if (command === 'ZRANK' && !replaced) {
      replaced = true
      redis.state.meta = JSON.stringify({
        reset_at_ms: Date.UTC(2026, 9, 1),
        timestamp_ms: Date.UTC(2026, 8, 9),
        checkpoint: 51,
      })
      return null
    }
    return redis.call(command, ...args)
  }
  expect((await get_leaderboard({ call }, observation, address(0))).self?.rank).toBe(1)
  expect(redis.state.mgets).toBe(4)
})
