// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { RedisClient } from 'bun'
import { hosted_keys, type HostedCollection } from '@aresrpg/protocol/hosted-keys'
import { create_telegram_access } from '@aresrpg/protocol/telegram-access'

import type { RecordBackend } from './secure_records.ts'

// KEYS are the compared records; each write names its KEYS index, ciphertext ('' deletes) and PXAT (0 = none).
const commit_script = `
local count = tonumber(ARGV[1])
for i = 1, count do
  if (redis.call('GET', KEYS[i]) or '') ~= ARGV[1 + i] then return 0 end
end
for i = 2 + count, #ARGV, 3 do
  local key = KEYS[tonumber(ARGV[i])]
  if ARGV[i + 1] == '' then redis.call('DEL', key)
  elseif ARGV[i + 2] == '0' then redis.call('SET', key, ARGV[i + 1])
  else redis.call('SET', key, ARGV[i + 1], 'PXAT', ARGV[i + 2]) end
end
return 1
`

/** Telegram's encrypted records in the permanent Redis it shares with the hosted bot service. */
export const redis_backend = (redis: RedisClient, namespace?: string): RecordBackend => {
  const keys = hosted_keys('telegram', namespace)
  // A record id is `<collection>:<entity>`: the two parts of its key after the namespace.
  const physical = (id: string) => {
    const cut = id.indexOf(':')
    return keys.key(id.slice(0, cut) as HostedCollection<'telegram'>, id.slice(cut + 1))
  }
  const record_id = (key: string) => {
    const { collection, id } = keys.parse(key)!
    return `${collection}:${id}`
  }
  return {
    get: async (ids) => (ids.length ? ((await redis.send('MGET', ids.map(physical))) as (string | null)[]) : []),
    commit: async (expected, writes) => {
      const index = new Map(expected.map(({ id }, position) => [id, position + 1]))
      const result = await redis.send('EVAL', [
        commit_script,
        String(expected.length),
        ...expected.map(({ id }) => physical(id)),
        String(expected.length),
        ...expected.map(({ raw }) => raw ?? ''),
        ...writes.flatMap(({ id, raw, expires_at }) => [String(index.get(id)), raw ?? '', String(expires_at ?? 0)]),
      ])
      return result === 1
    },
    ids: async (prefix) => {
      const found = new Set<string>()
      let cursor = '0'
      do {
        const [next, scanned] = (await redis.send('SCAN', [cursor, 'MATCH', `${physical(prefix)}*`])) as [
          string,
          string[],
        ]
        cursor = next
        for (const key of scanned) found.add(record_id(key))
      } while (cursor !== '0')
      return [...found].sort()
    },
  }
}

/** No offline queue: a command issued while disconnected fails instead of replaying later.
 * The client reconnects through a short outage. Past its retry budget it closes for good and never
 * recovers, which `lost` reports so the process owner can end instead of answering failures forever. */
export const open_redis = async (url: string) => {
  const redis = new RedisClient(url, { enableOfflineQueue: false })
  const lost = new Promise<void>((resolve) => {
    redis.onclose = () => resolve()
  })
  await redis.connect()
  return {
    backend: redis_backend(redis),
    access: create_telegram_access((command, args) => redis.send(command, args)),
    close: () => redis.close(),
    lost,
  }
}
