// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The two pub/sub doors, as pure factories (the edge singletons live in pubsub.ts):
//   graph bus — the server's bound indexer set (chain evt:* channels + the checkpoint marker).
//     Its connection IS the pod's reason to live: a lost graph fires on_lost and the process
//     dies with it (k8s replaces the pod, which reconnects to any caught-up set).
//   mesh bus — the ONE cluster redis (player-published ephemera: presence, chat, fight intents,
//     the heartbeat key). Auto-reconnects; a mesh blip never kills a server.
// Both share the same machinery: one dedicated subscriber connection, refcounted channel
// subscriptions (many players watch the same fight — one SUBSCRIBE), a local emitter fan-out.

import { EventEmitter } from 'node:events'

import {
  INDEXED_CHECKPOINT_KEY,
  parse_indexed_checkpoint,
  parse_indexed_state,
  type IndexedState,
} from './indexing_health.ts'
import { is_indexer_channel } from './protocol.ts'
import logger from './logger.ts'

const log = logger(import.meta)

/** The slice of an ioredis connection the buses consume — injected, so tests never connect. */
export type BusRedis = {
  on: (event: 'message' | 'end', listener: (...args: readonly string[]) => void) => void
  subscribe: (channel: string) => Promise<unknown>
  unsubscribe: (channel: string) => Promise<unknown>
  publish: (channel: string, payload: string) => Promise<unknown>
  setex: (key: string, seconds: number, value: string) => Promise<unknown>
  get: (key: string) => Promise<string | null>
  scan: (cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', size: number) => Promise<[string, string[]]>
  mget: (keys: string[]) => Promise<(string | null)[]>
  zrevrange: (key: string, start: number, stop: number) => Promise<string[]>
  zrange: (key: string, start: number, stop: string, with_scores: 'WITHSCORES') => Promise<string[]>
  zrevrangebyscore: (
    key: string,
    max: number,
    min: number,
    limit: 'LIMIT',
    offset: number,
    count: number
  ) => Promise<string[]>
  zadd: (key: string, condition: 'GT', score: number, member: string) => Promise<unknown>
  zcount: (key: string, min: number, max: number) => Promise<number>
  zcard: (key: string) => Promise<number>
  hgetall: (key: string) => Promise<Record<string, string>>
  hvals: (key: string) => Promise<string[]>
  expireat: (key: string, at_seconds: number) => Promise<unknown>
  smembers: (key: string) => Promise<string[]>
  scard: (key: string) => Promise<number>
  disconnect: () => void
}

export type Bus = {
  emitter: EventEmitter
  subscribe: (channel: string) => Promise<void>
  unsubscribe: (channel: string) => Promise<void>
  publish: (channel: string, payload: unknown) => Promise<void>
  close: () => void
}

/** The graph bus carries no `publish`: this server never publishes a chain event — evt:* is
 *  the indexer's voice alone (read-only law, now mechanical). */
export type GraphBus = Omit<Bus, 'publish'> & {
  /** Latest checkpoint the bound indexer committed to both graph and its redis. */
  indexed_checkpoint: () => Promise<number | null>
  indexed_state?: () => Promise<IndexedState | null>
  /** Immutable retained sale rows for one player, newest first. */
  sales_history: (address: string) => Promise<readonly string[]>
  analytics_hashes?: (keys: readonly string[]) => Promise<readonly Readonly<Record<string, string>>[]>
  analytics_sets?: (keys: readonly string[]) => Promise<readonly (readonly string[])[]>
  analytics_counts?: (keys: readonly string[]) => Promise<readonly number[]>
  analytics_sums?: (keys: readonly string[]) => Promise<readonly number[]>
  analytics_cumulative_counts?: (key: string, maxes: readonly number[]) => Promise<readonly number[]>
}

export type MeshBus = Bus & {
  /** This pod's cluster-presence key: `server:<id>` = online, 20s TTL refreshed every 5s —
   *  a dead pod expires out of the sum, no membership protocol (legacy law; the ONE sanctioned
   *  ephemeral write, owner 2026-08-12). */
  heartbeat: (server_id: string, online: number) => Promise<void>
  /** Cluster-wide online count — the sum of every live `server:*` key (cached 4s). */
  cluster_online: () => Promise<number>
  record_online?: (online: number, at_ms: number) => Promise<void>
  online_samples?: (keys: readonly string[]) => Promise<readonly (readonly number[])[]>
}

/** The pair every player context carries — chain truth and player ephemera, never mixed. */
export type Pubsub = { graph: GraphBus; mesh: MeshBus }

type BusWires = Readonly<{ subscriber: BusRedis; publisher: BusRedis; unsubscribe_grace_ms?: number }>

/** Legacy synchronizer law: movement removes demand immediately, but Redis subscriptions cool
 * down later. This breaks the packet-rate → Redis-command coupling at zone boundaries. */
const UNSUBSCRIBE_GRACE_MS = 10_000
const sum_checkpoint_counts = (values: readonly string[]): number =>
  values.reduce((sum, value) => {
    const count = Number(value)
    const next = sum + count
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(next))
      throw new Error('analytics transaction bucket contains an invalid checkpoint count')
    return next
  }, 0)
const online_sample_values = (values: readonly string[]): readonly number[] => {
  const samples = values.filter((_, index) => index % 2 === 1).map(Number)
  if (samples.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('online analytics contains an invalid sample')
  return samples
}

const create_bus = ({
  subscriber,
  publisher,
  unsubscribe_grace_ms = UNSUBSCRIBE_GRACE_MS,
}: BusWires): Bus & { closed: () => boolean } => {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  const refs = new Map<string, number>()
  const pending_subscriptions = new Map<string, Promise<unknown>>()
  const pending_unsubscriptions = new Map<string, ReturnType<typeof setTimeout>>()
  let closed = false

  subscriber.on('message', (channel: string, raw: string) => {
    try {
      emitter.emit(channel, JSON.parse(raw))
    } catch (error) {
      log.error({ channel, error: (error as Error).message }, 'unparseable event payload dropped')
    }
  })

  return {
    emitter,
    closed: () => closed,
    /** Refcounted: the first watcher SUBSCRIBEs, the rest ride the same wire. */
    subscribe: async (channel) => {
      const pending_unsubscribe = pending_unsubscriptions.get(channel)
      if (pending_unsubscribe) {
        clearTimeout(pending_unsubscribe)
        pending_unsubscriptions.delete(channel)
        refs.set(channel, 1)
        return
      }
      const count = refs.get(channel) ?? 0
      refs.set(channel, count + 1)
      if (count > 0) {
        await pending_subscriptions.get(channel)
        return
      }
      const pending = subscriber.subscribe(channel)
      pending_subscriptions.set(channel, pending)
      try {
        await pending
      } catch (error) {
        // every caller sharing this pending wire failed together; no phantom reference may
        // convince the next caller that Redis is subscribed
        refs.delete(channel)
        throw error
      } finally {
        pending_subscriptions.delete(channel)
      }
    },
    unsubscribe: async (channel) => {
      await pending_subscriptions.get(channel)
      const count = refs.get(channel) ?? 0
      if (count <= 1) {
        refs.delete(channel)
        if (pending_unsubscriptions.has(channel)) return
        pending_unsubscriptions.set(
          channel,
          setTimeout(() => {
            pending_unsubscriptions.delete(channel)
            if (!refs.has(channel)) void subscriber.unsubscribe(channel)
          }, unsubscribe_grace_ms)
        )
      } else refs.set(channel, count - 1)
    },
    publish: async (channel, payload) => {
      await publisher.publish(channel, JSON.stringify(payload))
    },
    close: () => {
      closed = true
      pending_unsubscriptions.forEach(clearTimeout)
      pending_unsubscriptions.clear()
      subscriber.disconnect()
      publisher.disconnect()
    },
  }
}

export const create_graph_bus = ({
  subscriber,
  publisher,
  unsubscribe_grace_ms,
  on_lost,
}: BusWires & Readonly<{ on_lost: (reason: string) => void }>): GraphBus => {
  const bus = create_bus({ subscriber, publisher, unsubscribe_grace_ms })
  const lost = (reason: string) => (): void => {
    if (!bus.closed()) on_lost(reason)
  }
  subscriber.on('end', lost('graph connection ended'))
  publisher.on('end', lost('graph connection ended'))
  const { closed: _closed, publish: _publish, ...doors } = bus
  return {
    ...doors,
    sales_history: (address) => publisher.zrevrange(`sales:${address}`, 0, 499),
    analytics_hashes: (keys) => Promise.all(keys.map((key) => publisher.hgetall(key))),
    analytics_sets: (keys) => Promise.all(keys.map((key) => publisher.smembers(key))),
    analytics_counts: (keys) => Promise.all(keys.map((key) => publisher.scard(key))),
    analytics_sums: (keys) => Promise.all(keys.map(async (key) => sum_checkpoint_counts(await publisher.hvals(key)))),
    analytics_cumulative_counts: (key, maxes) =>
      Promise.all([...maxes.map((max) => publisher.zcount(key, 0, max)), publisher.zcard(key)]),
    indexed_checkpoint: async () => {
      try {
        return parse_indexed_checkpoint(await publisher.get(INDEXED_CHECKPOINT_KEY))
      } catch (error) {
        log.warn({ error: (error as Error).message }, 'indexer checkpoint marker is malformed')
        return null
      }
    },
    indexed_state: async () => {
      try {
        return parse_indexed_state(await publisher.get(INDEXED_CHECKPOINT_KEY))
      } catch (error) {
        log.warn({ error: (error as Error).message }, 'indexer checkpoint marker is malformed')
        return null
      }
    },
  }
}

export const create_mesh_bus = ({ subscriber, publisher, unsubscribe_grace_ms }: BusWires): MeshBus => {
  const { closed: _closed, ...doors } = create_bus({ subscriber, publisher, unsubscribe_grace_ms })
  /** one SCAN per pod per window, whatever the connection count */
  const online_cache = { value: 0, at_ms: 0 }
  return {
    ...doors,
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
    record_online: async (online, at_ms) => {
      const minute = Math.floor(at_ms / 60_000) * 60_000
      const interval = Math.floor(at_ms / 900_000) * 900_000
      const hour = Math.floor(at_ms / 3_600_000) * 3_600_000
      const day = Math.floor(at_ms / 86_400_000) * 86_400_000
      const week = Math.floor((at_ms - 4 * 86_400_000) / (7 * 86_400_000)) * (7 * 86_400_000) + 4 * 86_400_000
      const date = new Date(at_ms)
      const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
      const buckets = [
        [`analytics:online:15m:${interval}`, minute, interval + 2 * 86_400_000],
        [`analytics:online:hour:${hour}`, minute, hour + 8 * 86_400_000],
        [`analytics:online:day:${day}`, hour, day + 401 * 86_400_000],
        [`analytics:online:week:${week}`, hour, week + 105 * 86_400_000],
        [`analytics:online:month:${month}`, hour, month + 401 * 86_400_000],
      ] as const
      await Promise.all(
        buckets.flatMap(([key, sample_at, expires_ms]) => [
          publisher.zadd(key, 'GT', online, String(sample_at)),
          publisher.expireat(key, Math.floor(expires_ms / 1_000)),
        ])
      )
    },
    online_samples: (keys) =>
      Promise.all(keys.map(async (key) => online_sample_values(await publisher.zrange(key, 0, '-1', 'WITHSCORES')))),
  }
}

export type Watcher = {
  /** resolves when the subscription is REGISTERED — publish-after-watch needs the await
   *  (the who-probe answer must not race the joiner's own subscribe) */
  watch: (channel: string, forward: (payload: never) => void) => Promise<void>
  unwatch: (channel: string) => void
  has: (channel: string) => boolean
  watched: () => readonly string[]
}

/** The one routed subscription helper every player module uses: the channel NAME picks the bus
 *  (protocol.ts law), the map keeps one forward per channel, teardown walks `watched()`. */
export const create_watcher = ({ graph, mesh }: Pubsub): Watcher => {
  const forwards = new Map<string, (payload: never) => void>()
  const readiness = new Map<string, Promise<void>>()
  const bus_of = (channel: string): Omit<Bus, 'publish'> => (is_indexer_channel(channel) ? graph : mesh)
  return {
    watch: async (channel, forward) => {
      const existing = readiness.get(channel)
      if (existing) return existing
      forwards.set(channel, forward)
      bus_of(channel).emitter.on(channel, forward as (payload: unknown) => void)
      const ready = bus_of(channel)
        .subscribe(channel)
        .catch((error) => {
          readiness.delete(channel)
          forwards.delete(channel)
          bus_of(channel).emitter.off(channel, forward as (payload: unknown) => void)
          throw error
        })
      readiness.set(channel, ready)
      return ready
    },
    unwatch: (channel) => {
      const forward = forwards.get(channel)
      if (!forward) return
      readiness.delete(channel)
      forwards.delete(channel)
      bus_of(channel).emitter.off(channel, forward as (payload: unknown) => void)
      void bus_of(channel)
        .unsubscribe(channel)
        .catch((error: Error) => log.error({ channel, error: error.message }, 'unsubscribe failed'))
    },
    has: (channel) => forwards.has(channel),
    watched: () => [...forwards.keys()],
  }
}
