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

import type { Redis } from 'ioredis'
import type {
  AdminBucket,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardObservation,
  LeaderboardSnapshot,
  MarketVolume,
  MarketPriceSnapshot,
} from '@aresrpg/protocol'

import { get_analytics_totals, type AnalyticsTotals } from './reads/get_analytics_totals.ts'
import { get_leaderboard, get_leaderboard_rank } from './reads/get_leaderboard.ts'
import { create_item_supply_reader } from './reads/get_item_supply.ts'
import { get_market_changes, get_market_prices } from './reads/get_market_prices.ts'
import { get_market_volume } from './reads/get_market_volume.ts'
import {
  INDEXED_CHECKPOINT_KEY,
  parse_indexed_checkpoint,
  parse_indexed_state,
  type IndexedState,
} from './indexing_health.ts'
import { channels, is_indexer_channel, mesh_event_channel, type EventEnvelope } from './protocol.ts'
import type { Graph } from './graph.ts'
import { market_updates } from './market_updates.ts'
import { is_market_change } from './public_market.ts'
import { sampled_read } from './sampled_read.ts'
import { item_updates } from './item_updates.ts'
import logger from './logger.ts'

const log = logger(import.meta)

/** The slice of an ioredis connection the buses and their reads consume; injected, so tests never connect. */
export type BusRedis = Pick<
  Redis,
  | 'call'
  | 'pipeline'
  | 'on'
  | 'subscribe'
  | 'unsubscribe'
  | 'publish'
  | 'setex'
  | 'get'
  | 'scan'
  | 'mget'
  | 'zrevrange'
  | 'zrange'
  | 'zadd'
  | 'zcount'
  | 'zcard'
  | 'hgetall'
  | 'hvals'
  | 'expireat'
  | 'smembers'
  | 'scard'
  | 'disconnect'
>

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
  leaderboard: (observation: LeaderboardObservation) => Promise<LeaderboardSnapshot>
  leaderboard_rank: (metric: LeaderboardMetric, address: string) => Promise<LeaderboardEntry | null>
  /** Latest checkpoint the bound indexer committed to both graph and its redis. */
  indexed_checkpoint: () => Promise<number | null>
  indexed_state: () => Promise<IndexedState | null>
  /** Immutable retained sale rows for one player, newest first. */
  sales_history: (address: string) => Promise<readonly string[]>
  market_prices: (item_type: string, now_ms: number) => Promise<MarketPriceSnapshot>
  market_volume: (now_ms: number) => Promise<MarketVolume | null>
  /** Stored daily average-price change per item type that sold on both of the last two full days. */
  market_changes: (now_ms: number) => Promise<Readonly<Record<string, number>>>
  analytics_hashes: (keys: readonly string[]) => Promise<readonly Readonly<Record<string, string>>[]>
  analytics_sets: (keys: readonly string[]) => Promise<readonly (readonly string[])[]>
  analytics_counts: (keys: readonly string[]) => Promise<readonly number[]>
  analytics_totals: (keys: readonly string[]) => Promise<readonly AnalyticsTotals[]>
  analytics_cumulative_counts: (key: string, maxes: readonly number[]) => Promise<readonly number[]>
}

export type OnlinePopulation = Readonly<{
  online: number
  online_characters: number | null
  /** Every live socket across the cluster, signed in or not; null while a pod of an older build is counted. */
  online_sockets?: number | null
  /** Of `online`, the addresses whose socket shares a hosted bot status. Self-declared: a count, never authority. */
  online_agents?: number | null
}>
type OnlineSnapshot = Readonly<{
  addresses: readonly string[]
  characters: readonly string[]
  agents: readonly string[]
  /** How many sockets this pod holds, visitors included. */
  sockets?: number
}>

const DAY_MS = 86_400_000
const TIER_MS: Readonly<Record<Exclude<AdminBucket, 'week' | 'month'>, number>> = {
  '15m': 900_000,
  hour: 3_600_000,
  day: DAY_MS,
}
/** Where an analytics bucket of `tier` holding `at_ms` starts: weeks start on Monday 00:00 UTC, months on the 1st. */
export const tier_start = (tier: AdminBucket, at_ms: number): number => {
  if (tier === 'week') return Math.floor((at_ms - 4 * DAY_MS) / (7 * DAY_MS)) * (7 * DAY_MS) + 4 * DAY_MS
  if (tier === 'month') return Date.UTC(new Date(at_ms).getUTCFullYear(), new Date(at_ms).getUTCMonth(), 1)
  return Math.floor(at_ms / TIER_MS[tier]) * TIER_MS[tier]
}

/** One heartbeat key per pod: its whole online snapshot, with a 20-second TTL. */
const POD_KEY = 'pod:'

export type MeshBus = Bus & {
  /** This pod's authenticated addresses, tracked character IDs and hosted-bot addresses, with a 20-second TTL. */
  heartbeat: (server_id: string, snapshot: OnlineSnapshot) => Promise<void>
  /** Cluster-wide identity unions across live pod snapshots (cached 4s). */
  cluster_online: () => Promise<OnlinePopulation>
  /** Samples the population: every address online, and its split into players and hosted bots when the bots are counted. */
  record_online: (population: Pick<OnlinePopulation, 'online' | 'online_agents'>, at_ms: number) => Promise<void>
  online_samples: (keys: readonly string[]) => Promise<readonly (readonly number[])[]>
}

/** The pair every player context carries — chain truth and player ephemera, never mixed. */
export type Pubsub = { graph: GraphBus; mesh: MeshBus }

type BusWires = Readonly<{ subscriber: BusRedis; publisher: BusRedis; unsubscribe_grace_ms?: number }>

/** Movement removes demand immediately, but Redis subscriptions cool down later: the packet rate
 *  never drives the Redis command rate at zone boundaries. */
const UNSUBSCRIBE_GRACE_MS = 10_000
const online_sample_values = (values: readonly string[]): readonly number[] => {
  const samples = values.filter((_, index) => index % 2 === 1).map(Number)
  if (samples.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('online analytics contains an invalid sample')
  return samples
}

const string_ids = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string')

const online_snapshot = (raw: string): OnlineSnapshot => {
  const { addresses, characters, agents, sockets } = (JSON.parse(raw) ?? {}) as Record<string, unknown>
  if (!string_ids(addresses) || !string_ids(characters) || !string_ids(agents))
    throw new Error('online heartbeat has an invalid shape')
  return { addresses, characters, agents, ...(Number.isSafeInteger(sockets) ? { sockets: sockets as number } : {}) }
}

/** The cluster's population: unique identities across the snapshots of the live pods (an expired one is null). */
export const cluster_online_count = (values: readonly (string | null)[]): OnlinePopulation => {
  const snapshots = values.flatMap((raw) => (raw === null ? [] : [online_snapshot(raw)]))
  const union = (pick: (snapshot: OnlineSnapshot) => readonly string[]): number => new Set(snapshots.flatMap(pick)).size
  return {
    online: union(({ addresses }) => addresses),
    online_characters: union(({ characters }) => characters),
    online_agents: union(({ agents }) => agents),
    online_sockets: snapshots.every(({ sockets }) => sockets !== undefined)
      ? snapshots.reduce((total, { sockets }) => total + sockets!, 0)
      : null,
  }
}

const create_bus = ({
  subscriber,
  publisher,
  unsubscribe_grace_ms = UNSUBSCRIBE_GRACE_MS,
  item_graph,
  local_channel = (channel: string, _payload: unknown) => channel,
}: BusWires & { item_graph?: Graph; local_channel?: (channel: string, payload: unknown) => string }): Bus & {
  closed: () => boolean
} => {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  const refs = new Map<string, number>()
  const pending_subscriptions = new Map<string, Promise<unknown>>()
  const pending_unsubscriptions = new Map<string, ReturnType<typeof setTimeout>>()
  let closed = false

  subscriber.on('message', (channel: string, raw: string) => {
    try {
      const payload = JSON.parse(raw) as EventEnvelope
      if (item_graph && channel === channels.economy && ['ItemWritten', 'ItemRemoved'].includes(payload.type)) {
        void item_updates(item_graph, payload)
          .then((updates) => {
            if (closed) return
            for (const { address, packet } of updates)
              emitter.emit(channels.social(address), { ...payload, type: 'ItemProjected', data: { packet } })
          })
          .catch((error: Error) => log.error({ error: error.message }, 'item custody routing failed'))
        return
      }
      if (item_graph && channel === channels.economy && is_market_change(payload)) {
        void market_updates(item_graph, payload)
          .then((event) => {
            if (!closed) emitter.emit(channel, event)
          })
          .catch((error: unknown) => {
            log.warn({ err: error }, 'market invalidation enrichment failed')
            if (!closed) emitter.emit(channel, payload)
          })
        return
      }
      emitter.emit(local_channel(channel, payload), payload)
    } catch (error) {
      log.error({ channel, error: (error as Error).message }, 'unparseable event payload dropped')
    }
  })

  return {
    emitter,
    closed: () => closed,
    /** Refcounted: the first watcher SUBSCRIBEs, the rest ride the same wire. */
    subscribe: async (channel) => {
      if (closed) throw new Error('pubsub bus is closed')
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
            if (!refs.has(channel) && !closed)
              void subscriber
                .unsubscribe(channel)
                .catch((error: Error) => log.error({ channel, error: error.message }, 'deferred unsubscribe failed'))
          }, unsubscribe_grace_ms)
        )
      } else refs.set(channel, count - 1)
    },
    // A publication is one ephemeral fact and no caller acts on its failure: the bus logs a failed
    // one here, because most callers discard it and an unobserved rejection exits the process.
    publish: async (channel, payload) => {
      try {
        await publisher.publish(channel, JSON.stringify(payload))
      } catch (error) {
        log.warn({ channel, error: (error as Error).message }, 'publish failed')
      }
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
  item_graph,
}: BusWires & Readonly<{ item_graph?: Graph; on_lost: (reason: string) => void }>): GraphBus => {
  const bus = create_bus({ subscriber, publisher, unsubscribe_grace_ms, item_graph })
  const lost = (reason: string) => (): void => {
    if (!bus.closed()) on_lost(reason)
  }
  subscriber.on('end', lost('graph connection ended'))
  publisher.on('end', lost('graph connection ended'))
  const { closed: _closed, publish: _publish, ...doors } = bus
  const item_supply = item_graph ? create_item_supply_reader(item_graph) : null
  // Every market viewer's heartbeat asks for the volume: one sample per interval serves them all.
  const market_volume = sampled_read((_key, now_ms) => get_market_volume(publisher, now_ms), 5_000)
  return {
    ...doors,
    sales_history: (address) => publisher.zrevrange(`sales:${address}`, 0, 499),
    market_prices: sampled_read(async (item_type, now_ms) => {
      const [history, total_units] = await Promise.all([
        get_market_prices(publisher, item_type, now_ms).catch((error: unknown) => {
          log.warn({ err: error, item_type }, 'marketplace price history unavailable')
          return null
        }),
        item_supply?.(item_type) ?? Promise.resolve(null),
      ])
      return { history, total_units }
    }, 5_000),
    market_volume: (now_ms) => market_volume('volume', now_ms),
    // A corrupt day bucket leaves every change unknown; it never blocks the listed-type catalogue.
    market_changes: (now_ms) =>
      get_market_changes(publisher, now_ms).catch((error: unknown) => {
        log.warn({ err: error }, 'marketplace daily change unavailable')
        return {}
      }),
    analytics_hashes: (keys) => Promise.all(keys.map((key) => publisher.hgetall(key))),
    analytics_sets: (keys) => Promise.all(keys.map((key) => publisher.smembers(key))),
    analytics_counts: (keys) => Promise.all(keys.map((key) => publisher.scard(key))),
    analytics_totals: (keys) => get_analytics_totals(publisher, keys),
    analytics_cumulative_counts: (key, maxes) =>
      Promise.all([...maxes.map((max) => publisher.zcount(key, 0, max)), publisher.zcard(key)]),
    leaderboard: (observation) => get_leaderboard(publisher, observation),
    leaderboard_rank: (metric, address) => get_leaderboard_rank(publisher, metric, address),
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
  const { closed: _closed, ...doors } = create_bus({
    subscriber,
    publisher,
    unsubscribe_grace_ms,
    local_channel: mesh_event_channel,
  })
  /** one SCAN per pod per window, whatever the connection count */
  const online_cache = {
    value: { online: 0, online_characters: null, online_agents: null } as OnlinePopulation,
    at_ms: 0,
    pending: null as Promise<OnlinePopulation> | null,
  }
  const read_online = async (): Promise<OnlinePopulation> => {
    const keys: string[] = []
    for (let cursor = '0'; ;) {
      const [next, found] = await publisher.scan(cursor, 'MATCH', `${POD_KEY}*`, 'COUNT', 100)
      keys.push(...found)
      if (next === '0') break
      cursor = next
    }
    online_cache.value = cluster_online_count(keys.length ? await publisher.mget(keys) : [])
    online_cache.at_ms = Date.now()
    return online_cache.value
  }
  return {
    ...doors,
    heartbeat: async (server_id, snapshot) => {
      await publisher.setex(`${POD_KEY}${server_id}`, 20, JSON.stringify(snapshot))
    },
    cluster_online: async () => {
      if (Date.now() - online_cache.at_ms < 4_000) return online_cache.value
      if (!online_cache.pending)
        online_cache.pending = read_online().finally(() => {
          online_cache.pending = null
        })
      return online_cache.pending
    },
    record_online: async ({ online, online_agents }, at_ms) => {
      const minute = Math.floor(at_ms / 60_000) * 60_000
      const [interval, hour, day, week, month] = (['15m', 'hour', 'day', 'week', 'month'] as const).map((tier) =>
        tier_start(tier, at_ms)
      ) as [number, number, number, number, number]
      const buckets = [
        [`15m:${interval}`, minute, interval + 2 * 86_400_000],
        [`hour:${hour}`, minute, hour + 8 * 86_400_000],
        [`day:${day}`, hour, day + 401 * 86_400_000],
        [`week:${week}`, hour, week + 105 * 86_400_000],
        [`month:${month}`, hour, month + 401 * 86_400_000],
      ] as const
      const split = typeof online_agents === 'number'
      const series = [
        ['online', online],
        ['online_players', split ? online - online_agents : null],
        ['online_agents', split ? online_agents : null],
      ] as const
      await Promise.all(
        series.flatMap(([name, count]) =>
          typeof count === 'number'
            ? buckets.flatMap(([bucket, sample_at, expires_ms]) => [
                publisher.zadd(`analytics:${name}:${bucket}`, 'GT', count, String(sample_at)),
                publisher.expireat(`analytics:${name}:${bucket}`, Math.floor(expires_ms / 1_000)),
              ])
            : []
        )
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
export const create_watcher = ({ graph, mesh }: Pubsub, signal?: AbortSignal): Watcher => {
  const watches = new Map<string, { forward: (payload: never) => void; ready: Promise<void> }>()
  const bus_of = (channel: string): Omit<Bus, 'publish'> => (is_indexer_channel(channel) ? graph : mesh)
  const unwatch = (channel: string): void => {
    const entry = watches.get(channel)
    if (!entry) return
    watches.delete(channel)
    bus_of(channel).emitter.off(channel, entry.forward as (payload: unknown) => void)
    // Failed acquisition owns no reference. Release only after this acquisition succeeds.
    void entry.ready
      .then(
        () => bus_of(channel).unsubscribe(channel),
        () => undefined
      )
      .catch((error: Error) => log.error({ channel, error: error.message }, 'unsubscribe failed'))
  }
  signal?.addEventListener(
    'abort',
    () => {
      for (const channel of watches.keys()) unwatch(channel)
    },
    { once: true }
  )
  return {
    // Returns the watch's own `ready` promise, which already logs a refusal: a caller that only
    // discards it (`void watch(...)`) can never turn a refused subscription into a process exit,
    // and a caller that awaits it still sees the rejection.
    watch: (channel, forward) => {
      if (signal?.aborted) return Promise.resolve()
      const existing = watches.get(channel)
      if (existing) return existing.ready
      const owned_forward = (payload: never) => {
        if (!signal?.aborted) forward(payload)
      }
      const entry = { forward: owned_forward, ready: Promise.resolve() }
      bus_of(channel).emitter.on(channel, owned_forward as (payload: unknown) => void)
      entry.ready = bus_of(channel)
        .subscribe(channel)
        .catch((error) => {
          if (watches.get(channel) === entry) watches.delete(channel)
          bus_of(channel).emitter.off(channel, owned_forward as (payload: unknown) => void)
          throw error
        })
      void entry.ready.catch((error: Error) => log.warn({ channel, error: error.message }, 'subscription refused'))
      watches.set(channel, entry)
      return entry.ready
    },
    unwatch,
    has: (channel) => watches.has(channel),
    watched: () => [...watches.keys()],
  }
}
