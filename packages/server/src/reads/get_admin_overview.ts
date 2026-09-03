// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Typed admin analytics. Each visible chart owns its range; the server selects its compacted
// projection independently instead of forcing one global dashboard window.

import type {
  AdminAddressesOverview,
  AdminActivityPoint,
  AdminBucket,
  AdminCharactersOverview,
  AdminMoneyPoint,
  AdminOnlineOverview,
  AdminOnlinePoint,
  AdminOverviewResult,
  AdminOverviewSection,
  AdminOverviewSectionResult,
  AdminPlayersOverview,
  AdminRangeDays,
  AdminRevenueOverview,
  AdminTransactionsOverview,
} from '@aresrpg/protocol'

import type { Graph } from '../graph.ts'
import type { GraphBus, MeshBus } from '../pubsub_bus.ts'

const INTERVAL_MS = 15 * 60 * 1_000
const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000
const WEEK_MS = 7 * DAY_MS
const TRANSACTIONS_ALL_KEY = 'analytics:transactions:all'
const GAS_ALL_KEY = 'analytics:gas:all'

const bucket_start = (at_ms: number, width_ms: number): number => Math.floor(at_ms / width_ms) * width_ms
const bucket_range = (from_ms: number, to_ms: number, width_ms: number): readonly number[] => {
  const first = bucket_start(from_ms, width_ms)
  const last = bucket_start(to_ms, width_ms)
  return Object.freeze(
    Array.from({ length: Math.floor((last - first) / width_ms) + 1 }, (_, index) => first + index * width_ms)
  )
}
const recent_buckets = (to_ms: number, count: number, width_ms: number): readonly number[] => {
  const last = bucket_start(to_ms, width_ms)
  return Object.freeze(Array.from({ length: count }, (_, index) => last - (count - index - 1) * width_ms))
}
const week_start = (at_ms: number): number => Math.floor((at_ms - 4 * DAY_MS) / WEEK_MS) * WEEK_MS + 4 * DAY_MS
const month_start = (at_ms: number): number => {
  const date = new Date(at_ms)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}
const recent_months = (to_ms: number, count: number): readonly number[] => {
  const date = new Date(to_ms)
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - (count - index - 1), 1)
    )
  )
}
const range_buckets = (days: AdminRangeDays, now_ms: number) => {
  if (days === 1) return Object.freeze({ tier: '15m' as const, values: recent_buckets(now_ms, 96, INTERVAL_MS) })
  if (days === 7) return Object.freeze({ tier: 'hour' as const, values: recent_buckets(now_ms, 168, HOUR_MS) })
  if (days === 30) return Object.freeze({ tier: 'day' as const, values: recent_buckets(now_ms, 30, DAY_MS) })
  if (days === 90) {
    const last = week_start(now_ms)
    return Object.freeze({
      tier: 'week' as const,
      values: Object.freeze(Array.from({ length: 13 }, (_, index) => last - (12 - index) * WEEK_MS)),
    })
  }
  return Object.freeze({ tier: 'month' as const, values: recent_months(now_ms, 12) })
}
const bigint = (value: string | undefined): bigint => BigInt(value ?? '0')
const integer = (value: string | undefined): number => Number.parseInt(value ?? '0', 10) || 0
const sum_hash_values = (rows: readonly Readonly<Record<string, string>>[]): bigint =>
  rows.reduce((total, row) => total + Object.values(row).reduce((sum, value) => sum + BigInt(value), 0n), 0n)
const safe_count = (value: bigint, label: string): number => {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label} is outside the safe count range`)
  return count
}

const graph_doors = (graph: GraphBus) => {
  const { analytics_hashes, analytics_counts, analytics_sums, analytics_sets, analytics_cumulative_counts } = graph
  if (!analytics_hashes || !analytics_counts || !analytics_sums || !analytics_sets || !analytics_cumulative_counts)
    throw new Error('admin analytics projection is unavailable')
  return Object.freeze({
    analytics_hashes,
    analytics_counts,
    analytics_sums,
    analytics_sets,
    analytics_cumulative_counts,
  })
}

type MoneyObservation = Readonly<{
  ts_ms: number
  item_royalty_mist: string
  character_royalty_mist: string
  character_creation_mist: string
  kolizeum_mist: string
}>

const optional_revenue = (value: unknown): string => {
  if (value === undefined) return '0'
  if (typeof value !== 'string') throw new Error('admin money observation has an invalid revenue shape')
  return value
}

const parse_money = (raw: string): MoneyObservation => {
  const row = JSON.parse(raw) as Record<string, unknown>
  const strings = ['item_royalty_mist', 'character_royalty_mist']
  if (typeof row.ts_ms !== 'number' || !strings.every((field) => typeof row[field] === 'string'))
    throw new Error('admin money observation has an invalid shape')
  const { character_creation_mist, kolizeum_mist } = row
  return Object.freeze({
    ...(row as Omit<MoneyObservation, 'character_creation_mist' | 'kolizeum_mist'>),
    character_creation_mist: optional_revenue(character_creation_mist),
    kolizeum_mist: optional_revenue(kolizeum_mist),
  })
}

const money_point = (at_ms: number, rows: readonly MoneyObservation[]): AdminMoneyPoint =>
  Object.freeze({
    at_ms,
    item_royalty_mist: rows.reduce((sum, row) => sum + bigint(row.item_royalty_mist), 0n).toString(),
    character_royalty_mist: rows.reduce((sum, row) => sum + bigint(row.character_royalty_mist), 0n).toString(),
    character_creation_mist: rows.reduce((sum, row) => sum + bigint(row.character_creation_mist), 0n).toString(),
    kolizeum_mist: rows.reduce((sum, row) => sum + bigint(row.kolizeum_mist), 0n).toString(),
  })

const money_bucket = (tier: AdminBucket, at_ms: number): number => {
  if (tier === '15m') return bucket_start(at_ms, INTERVAL_MS)
  if (tier === 'hour') return bucket_start(at_ms, HOUR_MS)
  if (tier === 'day') return bucket_start(at_ms, DAY_MS)
  if (tier === 'week') return week_start(at_ms)
  return month_start(at_ms)
}

const money_points = (
  buckets: Readonly<{ tier: AdminBucket; values: readonly number[] }>,
  observations: readonly MoneyObservation[]
): readonly AdminMoneyPoint[] => {
  const grouped = new Map<number, MoneyObservation[]>()
  observations.forEach((row) => {
    const bucket = money_bucket(buckets.tier, row.ts_ms)
    const existing = grouped.get(bucket)
    if (existing) {
      existing.push(row)
    } else grouped.set(bucket, [row])
  })
  return Object.freeze(buckets.values.map((bucket) => money_point(bucket, grouped.get(bucket) ?? [])))
}

const online_point = (at_ms: number, samples: readonly number[]): AdminOnlinePoint =>
  Object.freeze({ at_ms, peak: Math.max(0, ...samples) })

const sum_money = (rows: readonly AdminMoneyPoint[]) =>
  rows.reduce(
    (total, row) => ({
      item_royalty_mist: total.item_royalty_mist + bigint(row.item_royalty_mist),
      character_royalty_mist: total.character_royalty_mist + bigint(row.character_royalty_mist),
      character_creation_mist: total.character_creation_mist + bigint(row.character_creation_mist),
      kolizeum_mist: total.kolizeum_mist + bigint(row.kolizeum_mist),
    }),
    {
      item_royalty_mist: 0n,
      character_royalty_mist: 0n,
      character_creation_mist: 0n,
      kolizeum_mist: 0n,
    }
  )

const load_revenue = async (graph: GraphBus, days: AdminRangeDays, now_ms: number): Promise<AdminRevenueOverview> => {
  const { analytics_hashes } = graph_doors(graph)
  const buckets = range_buckets(days, now_ms)
  const last_30d_start = recent_buckets(now_ms, 30, DAY_MS)[0]!
  const mtd_start = month_start(now_ms)
  const first_day = bucket_start(Math.min(buckets.values[0]!, last_30d_start, mtd_start), DAY_MS)
  const keys = bucket_range(first_day, now_ms, DAY_MS).map((day) => `analytics:money:day:${day}`)
  const rows = await analytics_hashes(keys)
  const observations = Object.freeze(rows.flatMap((row) => Object.values(row).map(parse_money)))
  const money = money_points(buckets, observations)
  const selected = sum_money(money)
  const last_30d = sum_money([
    money_point(
      0,
      observations.filter((row) => row.ts_ms >= last_30d_start)
    ),
  ])
  const month_to_date = sum_money([
    money_point(
      0,
      observations.filter((row) => row.ts_ms >= mtd_start)
    ),
  ])
  const revenue_total = (row: ReturnType<typeof sum_money>): string =>
    (row.item_royalty_mist + row.character_royalty_mist + row.character_creation_mist + row.kolizeum_mist).toString()
  return Object.freeze({
    days,
    bucket: buckets.tier,
    item_royalty_mist: selected.item_royalty_mist.toString(),
    character_royalty_mist: selected.character_royalty_mist.toString(),
    character_creation_mist: selected.character_creation_mist.toString(),
    kolizeum_mist: selected.kolizeum_mist.toString(),
    last_30d_revenue_mist: revenue_total(last_30d),
    month_to_date_revenue_mist: revenue_total(month_to_date),
    money,
  })
}

const load_players = async (graph: GraphBus, days: AdminRangeDays, now_ms: number): Promise<AdminPlayersOverview> => {
  const { analytics_counts, analytics_sets } = graph_doors(graph)
  const buckets = range_buckets(days, now_ms)
  const active_keys = buckets.values.map((bucket) => `analytics:active:${buckets.tier}:${bucket}`)
  const rolling_days = recent_buckets(now_ms, 30, DAY_MS)
  const rolling_keys = rolling_days.map((day) => `analytics:active:day:${day}`)
  const current_day = bucket_start(now_ms, DAY_MS)
  const [active_counts, daily_members] = await Promise.all([
    analytics_counts([...active_keys, `analytics:active:day:${current_day}`]),
    analytics_sets(rolling_keys),
  ])
  const activity = Object.freeze(
    buckets.values.map((bucket, index): AdminActivityPoint =>
      Object.freeze({
        at_ms: bucket,
        active: active_counts[index] ?? 0,
      })
    )
  )
  return Object.freeze({
    days,
    bucket: buckets.tier,
    dau: active_counts.at(-1) ?? 0,
    rolling_30d: new Set(daily_members.flat()).size,
    activity,
  })
}

const load_transactions = async (
  graph: GraphBus,
  days: AdminRangeDays,
  now_ms: number
): Promise<AdminTransactionsOverview> => {
  const { analytics_hashes, analytics_sums } = graph_doors(graph)
  const buckets = range_buckets(days, now_ms)
  const keys = buckets.values.map((bucket) => `analytics:transactions:${buckets.tier}:${bucket}`)
  const gas_keys = buckets.values.map((bucket) => `analytics:gas:${buckets.tier}:${bucket}`)
  const [counts, [all_transactions], gas] = await Promise.all([
    analytics_sums(keys),
    analytics_hashes([TRANSACTIONS_ALL_KEY]),
    analytics_hashes([GAS_ALL_KEY, ...gas_keys]),
  ])
  const transactions = Object.freeze(
    buckets.values.map((at_ms, index) => Object.freeze({ at_ms, transactions: counts[index] ?? 0 }))
  )
  return Object.freeze({
    days,
    bucket: buckets.tier,
    total: transactions.reduce((total, point) => total + point.transactions, 0),
    all_time: safe_count(sum_hash_values([all_transactions ?? {}]), 'all-time transaction count'),
    gas_range_mist: sum_hash_values(gas.slice(1)).toString(),
    gas_all_time_mist: sum_hash_values(gas.slice(0, 1)).toString(),
    transactions,
  })
}

const load_online = async (mesh: MeshBus, days: AdminRangeDays, now_ms: number): Promise<AdminOnlineOverview> => {
  const { online_samples } = mesh
  if (!online_samples) throw new Error('admin online projection is unavailable')
  const buckets = range_buckets(days, now_ms)
  const keys = buckets.values.map((bucket) => `analytics:online:${buckets.tier}:${bucket}`)
  const rows = await online_samples(keys)
  const online = Object.freeze(buckets.values.map((bucket, index) => online_point(bucket, rows[index] ?? [])))
  return Object.freeze({
    days,
    bucket: buckets.tier,
    online_now: await mesh.cluster_online(),
    online_peak: online.reduce((peak, point) => Math.max(peak, point.peak), 0),
    online,
  })
}

const load_addresses = async (
  graph: GraphBus,
  days: AdminRangeDays,
  now_ms: number
): Promise<AdminAddressesOverview> => {
  const { analytics_cumulative_counts } = graph_doors(graph)
  const buckets = range_buckets(days, now_ms)
  const ends = buckets.values.map((_, index) => (buckets.values[index + 1] ? buckets.values[index + 1]! - 1 : now_ms))
  const counts = await analytics_cumulative_counts('analytics:addresses', ends)
  const total = counts.at(-1) ?? 0
  const addresses = Object.freeze(
    buckets.values.map((at_ms, index) => Object.freeze({ at_ms, total: counts[index] ?? 0 }))
  )
  return Object.freeze({ days, bucket: buckets.tier, total, addresses })
}

const load_characters = async (
  graph: Graph,
  bus: GraphBus,
  days: AdminRangeDays,
  now_ms: number
): Promise<AdminCharactersOverview> => {
  const { analytics_hashes } = graph_doors(bus)
  const buckets = range_buckets(days, now_ms)
  const first_day = bucket_start(buckets.values[0]!, DAY_MS)
  const keys = bucket_range(first_day, now_ms, DAY_MS).map((day) => `analytics:characters:day:${day}`)
  const [rows, graph_rows] = await Promise.all([
    analytics_hashes(keys),
    graph.read('MATCH (character:Character) RETURN count(character) AS total'),
  ])
  const total = Number(graph_rows[0]?.total ?? 0)
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('invalid Character count')
  const deltas = new Map<number, number>()
  rows.flatMap(Object.values).forEach((raw) => {
    const row = JSON.parse(raw) as Record<string, unknown>
    if (typeof row.ts_ms !== 'number' || (row.delta !== 1 && row.delta !== -1))
      throw new Error('invalid Character lifecycle observation')
    const bucket = money_bucket(buckets.tier, row.ts_ms)
    deltas.set(bucket, (deltas.get(bucket) ?? 0) + row.delta)
  })
  let cursor = total
  const points = Array<Readonly<{ at_ms: number; total: number }>>(buckets.values.length)
  for (let index = points.length - 1; index >= 0; index -= 1) {
    points[index] = Object.freeze({ at_ms: buckets.values[index]!, total: cursor })
    cursor -= deltas.get(buckets.values[index]!) ?? 0
  }
  return Object.freeze({ days, bucket: buckets.tier, total, characters: Object.freeze(points) })
}

export const get_admin_overview_section = async (
  graph: Graph,
  bus: GraphBus,
  mesh: MeshBus,
  section: AdminOverviewSection,
  days: AdminRangeDays,
  now_ms = Date.now()
): Promise<AdminOverviewSectionResult> => {
  if (section === 'revenue') return Object.freeze({ section, data: await load_revenue(bus, days, now_ms) })
  if (section === 'players') return Object.freeze({ section, data: await load_players(bus, days, now_ms) })
  if (section === 'transactions') return Object.freeze({ section, data: await load_transactions(bus, days, now_ms) })
  if (section === 'online') return Object.freeze({ section, data: await load_online(mesh, days, now_ms) })
  if (section === 'addresses') return Object.freeze({ section, data: await load_addresses(bus, days, now_ms) })
  return Object.freeze({ section, data: await load_characters(graph, bus, days, now_ms) })
}

export const get_admin_overview = async (
  graph: Graph,
  bus: GraphBus,
  mesh: MeshBus,
  {
    revenue_days,
    players_days,
    transactions_days,
    online_days,
    addresses_days,
    characters_days,
    now_ms = Date.now(),
  }: Readonly<{
    revenue_days: AdminRangeDays
    players_days: AdminRangeDays
    transactions_days: AdminRangeDays
    online_days: AdminRangeDays
    addresses_days: AdminRangeDays
    characters_days: AdminRangeDays
    now_ms?: number
  }>
): Promise<AdminOverviewResult> => {
  const [revenue, players, transactions, online, addresses, characters, checkpoint] = await Promise.all([
    load_revenue(bus, revenue_days, now_ms),
    load_players(bus, players_days, now_ms),
    load_transactions(bus, transactions_days, now_ms),
    load_online(mesh, online_days, now_ms),
    load_addresses(bus, addresses_days, now_ms),
    load_characters(graph, bus, characters_days, now_ms),
    bus.indexed_checkpoint(),
  ])
  return Object.freeze({
    as_of_checkpoint: checkpoint,
    as_of_ms: now_ms,
    revenue,
    players,
    transactions,
    online,
    addresses,
    characters,
  })
}
