// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { RedisClient } from 'bun'

export type ControlTransaction = Readonly<{
  get: <T>(key: string) => Promise<T | null>
  put: (key: string, value: unknown) => Promise<void>
}>
export type ControlStore = Readonly<{
  /** Local post-commit wakeups only; cross-process discovery still uses the durable pending index. */
  subscribe_pending?: (listener: (keys: readonly string[]) => void) => () => void
  read: <T>(key: string) => Promise<T | null>
  scan_keys: (prefix: string, limit: number, after?: string) => Promise<readonly string[]>
  scan_pending: (limit: number, after?: string) => Promise<readonly string[]>
  transaction: <T>(keys: readonly string[], operation: (tx: ControlTransaction) => Promise<T>) => Promise<T>
}>
// Pending membership is disposable scheduling metadata, never execution authority.
const PENDING_STATUSES: Readonly<Record<string, readonly string[]>> = {
  command: ['accepted', 'executing', 'uncertain'],
  profession: ['active', 'waiting'],
  combat: ['active', 'waiting'],
  behavior: ['active', 'waiting'],
  proof: ['pending'],
}
export const has_pending_work = (key: string, value: unknown): boolean => {
  const status = (value as { status?: string } | null)?.status
  const kind = key.split(':')[0]!
  if (kind === 'provision') return status !== 'ready'
  return (PENDING_STATUSES[kind] ?? []).includes(status ?? '')
}
// This fails if expiry can disappear between owner verification and consent commit.
// Compare every declared record in the same script that consumes consent and mints authority.
// MSET publishes all aggregates at once; prevalidated PEXPIREAT only removes temporary records.
const control_expiry = (key: string, value: unknown): number | null => {
  const record = (value ?? {}) as {
    expires_at?: number
    code?: { used: boolean; expires_at: number }
    revoked?: boolean
    family?: unknown
    access?: unknown
  }
  const kind = key.split(':')[0]!
  if (['request', 'challenge', 'client'].includes(kind)) return record.expires_at ?? null
  if (kind !== 'grant' || !record.code) return null
  return [!record.code.used, !record.revoked, !record.family, !record.access].every(Boolean)
    ? record.code.expires_at
    : null
}
const schema_script = `
local schema = redis.call('TYPE', KEYS[1]).ok
if schema ~= 'none' and (schema ~= 'string' or redis.call('GET', KEYS[1]) ~= 'records-v2') then
  return redis.error_reply('UNSUPPORTED_CONTROL_SCHEMA_REBUILD_WHILE_PAUSED')
end
`
const commit_script =
  schema_script +
  `
local count = tonumber(ARGV[1])
for i = 1, count do
  local actual = redis.call('GET', KEYS[i + 2]) or ''
  if actual ~= ARGV[1 + i] then return 0 end
end
redis.call('ZCARD', KEYS[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local writes = {KEYS[1], 'records-v2'}
local removed = {}
local added = {}
local expiry = {}
for i = 2 + count, #ARGV, 4 do
  local position = tonumber(ARGV[i])
  local deadline = tonumber(ARGV[i + 3])
  if not position or position < 1 or position > count or not deadline or deadline < 0 or deadline ~= math.floor(deadline) then
    return redis.error_reply('INVALID_CONTROL_EXPIRY')
  end
  if deadline > 0 and deadline <= now then return 0 end
  local key = KEYS[position + 2]
  writes[#writes + 1] = key
  writes[#writes + 1] = ARGV[i + 1]
  if deadline > 0 then expiry[#expiry + 1] = {key, ARGV[i + 3]} end
  if ARGV[i + 2] == '1' then
    added[#added + 1] = 0
    added[#added + 1] = key
  else removed[#removed + 1] = key end
end
-- Scheduling metadata can leave extra candidates on failure, never lost accepted work.
if #added > 0 then redis.call('ZADD', KEYS[2], unpack(added)) end
redis.call('MSET', unpack(writes))
for _, item in ipairs(expiry) do redis.call('PEXPIREAT', item[1], item[2]) end
if #removed > 0 then redis.call('ZREM', KEYS[2], unpack(removed)) end
return 1
`
const pending_script =
  schema_script +
  `
return redis.call('ZRANGEBYLEX', KEYS[2], ARGV[1], '+', 'LIMIT', '0', ARGV[2])
`
const decode = <T>(raw: string | null): T | null => (raw === null ? null : (JSON.parse(raw) as { value: T }).value)

/** Dedicated persistent Redis only. Conflicting callbacks fail closed and are never replayed:
 * a callback can perform managed signing, so replay is not a safe generic transaction policy. */
export const create_redis_store = (redis: RedisClient, namespace = 'bot:control'): ControlStore => {
  const record_prefix = `${namespace}:record:`
  const physical = (key: string) => `${record_prefix}${key}`
  const check_schema = () => redis.send('EVAL', [schema_script + 'return 1', '1', namespace])
  const listeners = new Set<(keys: readonly string[]) => void>()
  const pending = new Map<string, Promise<unknown>>()
  const serialize = <T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> => {
    const previous = keys.map((key) => pending.get(key))
    const result = Promise.all(previous).then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined
    )
    for (const key of keys) pending.set(key, settled)
    void settled.then(() => {
      for (const key of keys) if (pending.get(key) === settled) pending.delete(key)
    })
    return result
  }
  return {
    subscribe_pending: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: async <T>(key: string): Promise<T | null> => {
      await check_schema()
      return decode<T>(await redis.send('GET', [physical(key)]))
    },
    scan_pending: async (limit, after = '') => {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_SCAN_LIMIT')
      const found: string[] = await redis.send('EVAL', [
        pending_script,
        '2',
        namespace,
        `${namespace}:pending`,
        after ? `(${physical(after)}` : '-',
        String(limit),
      ])
      return found.map((key) => key.slice(record_prefix.length))
    },
    scan_keys: async (prefix, limit, after = '') => {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_SCAN_LIMIT')
      await check_schema()
      // Administrative pagination only; the runtime uses the pending index.
      let cursor = '0'
      let selected: string[] = []
      do {
        const [next_cursor, fields] = (await redis.send('SCAN', [cursor, 'MATCH', `${record_prefix}*`])) as [
          string,
          string[],
        ]
        cursor = next_cursor
        const matches = fields
          .map((key) => key.slice(record_prefix.length))
          .filter((key) => key.startsWith(prefix) && key > after)
        selected = [...new Set([...selected, ...matches])].sort().slice(0, limit)
      } while (cursor !== '0')
      return selected
    },
    transaction: (keys, operation) =>
      serialize(keys, async () => {
        const ordered = [...new Set(keys)].sort()
        await check_schema()
        const snapshot: (string | null)[] = ordered.length ? await redis.send('MGET', ordered.map(physical)) : []
        const writes = new Map<string, string>()
        const position = (key: string) => {
          const index = ordered.indexOf(key)
          if (index < 0) throw new Error('CONTROL_KEY_NOT_LOCKED')
          return index
        }
        const result = await operation({
          get: async <T>(key: string): Promise<T | null> => decode<T>(writes.get(key) ?? snapshot[position(key)]!),
          put: async (key, value) => {
            position(key)
            if (value === undefined) throw new Error('INVALID_CONTROL_VALUE')
            const expiry = control_expiry(key, value)
            if (expiry !== null && (!Number.isSafeInteger(expiry) || expiry <= 0))
              throw new Error('INVALID_CONTROL_EXPIRY')
            writes.set(key, JSON.stringify({ revision: crypto.randomUUID(), value }))
          },
        })
        const expected = snapshot.map((raw) => raw ?? '')
        const committed = await redis.send('EVAL', [
          commit_script,
          String(ordered.length + 2),
          namespace,
          `${namespace}:pending`,
          ...ordered.map(physical),
          String(ordered.length),
          ...expected,
          ...[...writes].flatMap(([key, encoded]) => [
            String(position(key) + 1),
            encoded,
            has_pending_work(key, decode(encoded)) ? '1' : '0',
            String(control_expiry(key, decode(encoded)) ?? 0),
          ]),
        ])
        if (committed !== 1) throw new Error('control_transaction_conflict')
        const added = [...writes].flatMap(([key, encoded]) =>
          has_pending_work(key, decode(encoded)) && !has_pending_work(key, decode(snapshot[position(key)]!))
            ? [key]
            : []
        )
        if (added.length) for (const listener of listeners) listener(added)
        return result
      }),
  }
}
