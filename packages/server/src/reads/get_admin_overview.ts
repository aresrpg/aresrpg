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

import { ZERO_TOTALS, type AnalyticsTotals } from './get_analytics_totals.ts'

const INTERVAL_MS = 15 * 60 * 1_000
const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000
const WEEK_MS = 7 * DAY_MS
const ALL_TOTALS_KEY = 'analytics:totals:all'

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
const safe_count = (value: bigint, label: string): number => {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label} is outside the safe count range`)
  return count
}

const graph_doors = (graph: GraphBus) => {
  const { analytics_hashes, analytics_counts, analytics_sets, analytics_cumulative_counts } = graph
  if (!analytics_hashes || !analytics_counts || !analytics_sets || !analytics_cumulative_counts)
    throw new Error('admin analytics projection is unavailable')
  return Object.freeze({
    analytics_hashes,
    analytics_counts,
    analytics_sets,
    analytics_cumulative_counts,
  })
}

const numeric_rows = async (
  graph: GraphBus,
  keys: readonly string[]
): Promise<ReadonlyMap<string, AnalyticsTotals>> => {
  if (!graph.analytics_totals) throw new Error('compact analytics reader unavailable')
  const unique = [...new Set(keys)]
  const rows = await graph.analytics_totals(unique)
  return new Map(unique.map((key, index) => [key, rows[index]!]))
}

const money_point = (at_ms: number, rows: readonly AnalyticsTotals[]): AdminMoneyPoint =>
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
  const buckets = range_buckets(days, now_ms)
  const selected_keys = buckets.values.map((at_ms) => `analytics:totals:${buckets.tier}:${at_ms}`)
  const last_30d_start = recent_buckets(now_ms, 30, DAY_MS)[0]!
  const mtd_start = month_start(now_ms)
  const daily = bucket_range(Math.min(last_30d_start, mtd_start), now_ms, DAY_MS)
  const day_key = (at_ms: number): string => `analytics:totals:day:${at_ms}`
  const rows = await numeric_rows(graph, [...selected_keys, ...daily.map(day_key)])
  const money = buckets.values.map((at_ms, index) =>
    money_point(at_ms, [rows.get(selected_keys[index]!) ?? ZERO_TOTALS])
  )
  const selected = sum_money(money)
  const total_since = (start: number) =>
    sum_money([
      money_point(
        0,
        daily.filter((at_ms) => at_ms >= start).map((at_ms) => rows.get(day_key(at_ms)) ?? ZERO_TOTALS)
      ),
    ])
  const last_30d = total_since(last_30d_start)
  const month_to_date = total_since(mtd_start)
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
  const buckets = range_buckets(days, now_ms)
  const keys_for = (range: ReturnType<typeof range_buckets>) =>
    range.values.map((at_ms) => `analytics:totals:${range.tier}:${at_ms}`)
  const keys = keys_for(buckets)
  const last_24h_keys = keys_for(range_buckets(1, now_ms))
  const last_30d_keys = keys_for(range_buckets(30, now_ms))
  const rows = await numeric_rows(graph, [ALL_TOTALS_KEY, ...keys, ...last_24h_keys, ...last_30d_keys])
  const sum = (selected: readonly string[], field: 'transactions' | 'gas_mist') =>
    selected.reduce((total, key) => total + BigInt((rows.get(key) ?? ZERO_TOTALS)[field]), 0n)
  const count = (selected: readonly string[]) => safe_count(sum(selected, 'transactions'), 'transaction count')
  const gas = (selected: readonly string[]) => sum(selected, 'gas_mist').toString()
  const transactions = buckets.values.map((at_ms, index) => ({ at_ms, transactions: count([keys[index]!]) }))
  return Object.freeze({
    days,
    bucket: buckets.tier,
    total: count(keys),
    last_24h: count(last_24h_keys),
    last_30d: count(last_30d_keys),
    all_time: count([ALL_TOTALS_KEY]),
    gas_range_mist: gas(keys),
    gas_last_24h_mist: gas(last_24h_keys),
    gas_last_30d_mist: gas(last_30d_keys),
    gas_all_time_mist: gas([ALL_TOTALS_KEY]),
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
