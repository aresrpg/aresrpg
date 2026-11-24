// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { RedisClient } from 'bun'

import {
  execution_record,
  live_value,
  persistent_value,
  released_records,
  volatile_record,
} from './store_projection.ts'

export type ControlTransaction = Readonly<{
  get: <T>(key: string) => Promise<T | null>
  put: (key: string, value: unknown) => Promise<void>
}>
export type ControlStore = Readonly<{
  /** Local post-commit wakeups. Only durable definitions participate in cross-process discovery. */
  subscribe_pending?: (listener: (keys: readonly string[]) => void) => () => void
  read: <T>(key: string) => Promise<T | null>
  scan_keys: (prefix: string, limit: number, after?: string) => Promise<readonly string[]>
  scan_pending: (limit: number, after?: string) => Promise<readonly string[]>
  transaction: <T>(keys: readonly string[], operation: (tx: ControlTransaction) => Promise<T>) => Promise<T>
}>
// Pending membership is disposable scheduling metadata, never execution authority.
const PENDING_STATUSES: Readonly<Record<string, readonly string[]>> = {
  command: ['accepted', 'executing', 'uncertain'],
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
/** A pairing proof (`proof:<authorization_id>:<nonce>`) lives exactly as long as its authorization request. */
const owning_request = (key: string) => (key.split(':')[0] === 'proof' ? [`request:${key.split(':')[1]}`] : [])
const write_deadline = (key: string, value: unknown, snapshot: (key: string) => unknown): number => {
  const own = control_expiry(key, value)
  if (own !== null) return own
  const [request] = owning_request(key)
  if (!request) return 0
  const expires_at = (snapshot(request) as { expires_at?: number } | null)?.expires_at
  if (!expires_at) throw new Error('INVALID_CONTROL_EXPIRY')
  return expires_at
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
/** Commands a committed lane stops naming. */
const released_keys = (writes: ReadonlyMap<string, unknown>, local: ReadonlyMap<string, unknown>) =>
  [...writes].flatMap(([key, value]) => released_records(key, local.get(key), value))
const decode = <T>(raw: string | null): T | null => (raw === null ? null : (JSON.parse(raw) as { value: T }).value)

/** The Redis keys of one namespace: the bare namespace holds the layout marker, `pending` the record
 * ids that still hold unfinished work, and `record:<id>` one control aggregate. Production uses
 * `bot:control`; a test passes a disposable namespace. */
const keys = (namespace: string) => {
  const record_prefix = `${namespace}:record:`
  return {
    schema: namespace,
    pending: `${namespace}:pending`,
    record: (id: string) => `${record_prefix}${id}`,
    id_of: (key: string) => key.slice(record_prefix.length),
  }
}

/** Dedicated persistent Redis only. Conflicting callbacks fail closed and are never replayed:
 * a callback can perform managed signing, so replay is not a safe generic transaction policy. */
export const create_redis_store = (redis: RedisClient, namespace = 'bot:control'): ControlStore => {
  const { schema: schema_key, pending: pending_key, record: physical, id_of: logical } = keys(namespace)
  const check_schema = () => redis.send('EVAL', [schema_script + 'return 1', '1', schema_key])
  const local = new Map<string, unknown>()
  const hydrate = <T>(key: string, raw: string | null): T | null =>
    structuredClone(
      volatile_record(key) ? (local.get(key) ?? null) : live_value(key, decode(raw), local.get(key))
    ) as T | null
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
      return hydrate<T>(key, volatile_record(key) ? null : await redis.send('GET', [physical(key)]))
    },
    scan_pending: async (limit, after = '') => {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_SCAN_LIMIT')
      let cursor = after
      let durable: string[] = []
      let found: string[]
      do {
        found = await redis.send('EVAL', [
          pending_script,
          '2',
          schema_key,
          pending_key,
          cursor ? `(${physical(cursor)}` : '-',
          String(limit),
        ])
        const records = found.map(logical)
        durable = [...durable, ...records.filter((key) => !volatile_record(key))]
        cursor = records.at(-1) ?? cursor
      } while (found.length === limit && durable.length < limit)
      const ephemeral = [...local]
        .filter(([key, value]) => volatile_record(key) && key > after && has_pending_work(key, value))
        .map(([key]) => key)
      return [...new Set([...durable, ...ephemeral])].sort().slice(0, limit)
    },
    scan_keys: async (prefix, limit, after = '') => {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_SCAN_LIMIT')
      await check_schema()
      // Administrative pagination only; the runtime uses the pending index.
      let cursor = '0'
      let selected: string[] = []
      do {
        const [next_cursor, fields] = (await redis.send('SCAN', [cursor, 'MATCH', physical('*')])) as [string, string[]]
        cursor = next_cursor
        const matches = fields
          .map(logical)
          .filter((key) => !volatile_record(key) && key.startsWith(prefix) && key > after)
        selected = [...new Set([...selected, ...matches])].sort().slice(0, limit)
      } while (cursor !== '0')
      return [...new Set([...selected, ...[...local.keys()].filter((key) => key.startsWith(prefix) && key > after)])]
        .sort()
        .slice(0, limit)
    },
    transaction: (keys, operation) =>
      serialize(keys, async () => {
        const declared = [...new Set(keys)].sort()
        // A proof's request joins the compared snapshot: its deadline is read and checked in one commit.
        const ordered = [
          ...new Set([...declared.filter((key) => !volatile_record(key)), ...declared.flatMap(owning_request)]),
        ].sort()
        await check_schema()
        const snapshot: (string | null)[] = ordered.length ? await redis.send('MGET', ordered.map(physical)) : []
        const writes = new Map<string, unknown>()
        const position = (key: string) => {
          const index = declared.indexOf(key)
          if (index < 0) throw new Error('CONTROL_KEY_NOT_LOCKED')
          return index
        }
        const result = await operation({
          get: async <T>(key: string): Promise<T | null> => {
            position(key)
            return writes.has(key)
              ? (structuredClone(writes.get(key)) as T)
              : hydrate<T>(key, snapshot[ordered.indexOf(key)] ?? null)
          },
          put: async (key, value) => {
            position(key)
            if (value === undefined) throw new Error('INVALID_CONTROL_VALUE')
            const expiry = control_expiry(key, value)
            if (expiry !== null && (!Number.isSafeInteger(expiry) || expiry <= 0))
              throw new Error('INVALID_CONTROL_EXPIRY')
            writes.set(key, structuredClone(value))
          },
        })
        const durable_writes = [...writes]
          .filter(([key]) => !volatile_record(key))
          .map(
            ([key, value]) =>
              [
                key,
                JSON.stringify({ revision: crypto.randomUUID(), value: persistent_value(key, value, local.get(key)) }),
              ] as const
          )
        const expected = snapshot.map((raw) => raw ?? '')
        const committed = await redis.send('EVAL', [
          commit_script,
          String(ordered.length + 2),
          schema_key,
          pending_key,
          ...ordered.map(physical),
          String(ordered.length),
          ...expected,
          ...durable_writes.flatMap(([key, encoded]) => [
            String(ordered.indexOf(key) + 1),
            encoded,
            has_pending_work(key, decode(encoded)) ? '1' : '0',
            String(write_deadline(key, decode(encoded), (name) => decode(snapshot[ordered.indexOf(name)] ?? null))),
          ]),
        ])
        if (committed !== 1) throw new Error('control_transaction_conflict')
        const added = [...writes].flatMap(([key, value]) =>
          has_pending_work(key, value) && !has_pending_work(key, hydrate(key, snapshot[ordered.indexOf(key)] ?? null))
            ? [key]
            : []
        )
        const released = released_keys(writes, local)
        for (const [key, value] of [...writes].filter(([key]) => execution_record(key))) {
          const projected = durable_writes.find(([name]) => name === key)?.[1]
          local.set(key, projected ? live_value(key, decode(projected), value) : value)
        }
        released.forEach((key) => local.delete(key))
        if (added.length) for (const listener of listeners) listener(added)
        return result
      }),
  }
}
