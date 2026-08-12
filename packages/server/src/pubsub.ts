// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pub/sub door (legacy redis_events pattern): ONE dedicated ioredis subscriber connection,
// refcounted channel subscriptions (many players watch the same fight — one SUBSCRIBE), and a
// local emitter fan-out. Module-level singleton: importing IS connecting (the harness receives
// it injected, so tests never import it). The server itself publishes nothing yet.

import { EventEmitter } from 'node:events'

import { Redis } from 'ioredis'

import { REDIS_URL } from './env.ts'
import logger from './logger.ts'

const log = logger(import.meta)

export type Pubsub = {
  emitter: EventEmitter
  subscribe: (channel: string) => Promise<void>
  unsubscribe: (channel: string) => Promise<void>
  publish: (channel: string, payload: unknown) => Promise<void>
  /** This pod's cluster-presence key: `server:<id>` = online, 20s TTL refreshed every 5s —
   *  a dead pod expires out of the sum, no membership protocol (legacy law; the ONE sanctioned
   *  ephemeral write, owner 2026-08-12). */
  heartbeat: (server_id: string, online: number) => Promise<void>
  /** Cluster-wide online count — the sum of every live `server:*` key (cached 4s). */
  cluster_online: () => Promise<number>
  close: () => void
}

const subscriber = new Redis(REDIS_URL)
const publisher = new Redis(REDIS_URL)
const emitter = new EventEmitter()
emitter.setMaxListeners(0)
const refs = new Map<string, number>()
/** one SCAN per pod per window, whatever the connection count */
const online_cache = { value: 0, at_ms: 0 }

subscriber.on('message', (channel: string, raw: string) => {
  try {
    emitter.emit(channel, JSON.parse(raw))
  } catch (error) {
    log.error({ channel, error: (error as Error).message }, 'unparseable event payload dropped')
  }
})

export const pubsub: Pubsub = {
  emitter,
  /** Refcounted: the first watcher SUBSCRIBEs, the rest ride the same wire. */
  subscribe: async (channel) => {
    const count = refs.get(channel) ?? 0
    refs.set(channel, count + 1)
    if (count === 0) await subscriber.subscribe(channel)
  },
  unsubscribe: async (channel) => {
    const count = refs.get(channel) ?? 0
    if (count <= 1) {
      refs.delete(channel)
      await subscriber.unsubscribe(channel)
    } else refs.set(channel, count - 1)
  },
  publish: async (channel, payload) => {
    await publisher.publish(channel, JSON.stringify(payload))
  },
  heartbeat: async (server_id, online) => {
    await publisher.setex(`server:${server_id}`, 20, String(online))
  },
  cluster_online: async () => {
    if (Date.now() - online_cache.at_ms < 4_000) return online_cache.value
    const keys: string[] = []
    for (let cursor = '0'; ;) {
      const [next, found] = await publisher.scan(cursor, 'MATCH', 'server:*', 'COUNT', 100)
      keys.push(...found)
      if (next === '0') break
      cursor = next
    }
    const counts = keys.length ? await publisher.mget(keys) : []
    online_cache.value = counts.reduce((sum, count) => sum + (Number(count) || 0), 0)
    online_cache.at_ms = Date.now()
    return online_cache.value
  },
  close: () => {
    subscriber.disconnect()
    publisher.disconnect()
  },
}
