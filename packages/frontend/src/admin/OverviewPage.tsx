// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  AdminAddressesOverview,
  AdminBucket,
  AdminCharactersOverview,
  AdminOnlineOverview,
  AdminPlayersOverview,
  AdminRangeDays,
  AdminRevenueOverview,
  AdminTransactionsOverview,
} from '@aresrpg/protocol'
import type { ReactNode } from 'react'

import { PANEL } from '../encyclopedia/components.tsx'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import { admin_range_label, AdminRangeSelector } from './AdminRangeSelector.tsx'
import { useAdminRevenue } from './AdminWalletPanel.tsx'
import type { AdminRevenue } from './AdminWalletPanel.tsx'
import type { AdminOverviewState } from './admin_state.ts'
import { MetricChart, type MetricSeries, type MetricValueKind } from './MetricChart.tsx'

const COLORS = Object.freeze({
  gold: '#c8963c',
  blue: '#70bdf2',
  violet: '#ac8dde',
  white: '#e8e4dc',
  cyan: '#55c7b6',
  orange: '#d97745',
})
const text = (copy: Readonly<Record<string, string>>, key: string, fallback: string): string => copy[key] || fallback
const sui_number = (mist: string): number => Number(BigInt(mist)) / 1_000_000_000
const display_count = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—'
const display_sui = (value: unknown): string =>
  typeof value === 'string' && /^\d+$/.test(value) ? `${format_sui(BigInt(value), 2)} SUI` : '—'
const bucket_label = (copy: Readonly<Record<string, string>>, bucket: AdminBucket): string =>
  text(copy, `bucket_${bucket}`, bucket === '15m' ? '15-minute buckets' : `${bucket} buckets`)
type DashboardTone = 'revenue' | 'activity' | 'population' | 'transactions'
type KpiTone = 'gold' | 'blue' | 'green' | 'violet'
const DASHBOARD_TONES = Object.freeze({
  revenue: Object.freeze({
    group:
      'border-[#c8963c]/30 bg-[radial-gradient(circle_at_12%_0%,rgba(200,150,60,0.14),transparent_46%),repeating-linear-gradient(135deg,rgba(200,150,60,0.025)_0,rgba(200,150,60,0.025)_1px,transparent_1px,transparent_9px)]',
    heading: 'border-[#c8963c]/20 text-[#d6aa58]',
    chart:
      'border-[#c8963c]/25 bg-[radial-gradient(circle_at_8%_0%,rgba(200,150,60,0.09),transparent_42%),rgba(18,18,26,0.96)]',
  }),
  activity: Object.freeze({
    group:
      'border-[#55c7b6]/28 bg-[linear-gradient(rgba(85,199,182,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(85,199,182,0.025)_1px,transparent_1px),radial-gradient(circle_at_12%_0%,rgba(85,199,182,0.13),transparent_48%)] bg-[size:12px_12px,12px_12px,auto]',
    heading: 'border-[#55c7b6]/18 text-[#6dd6c6]',
    chart:
      'border-[#55c7b6]/22 bg-[radial-gradient(circle_at_8%_0%,rgba(85,199,182,0.08),transparent_42%),rgba(18,18,26,0.96)]',
  }),
  population: Object.freeze({
    group:
      'border-[#ac8dde]/28 bg-[radial-gradient(circle_at_12%_0%,rgba(172,141,222,0.13),transparent_48%),repeating-linear-gradient(90deg,rgba(172,141,222,0.022)_0,rgba(172,141,222,0.022)_1px,transparent_1px,transparent_11px)]',
    heading: 'border-[#ac8dde]/18 text-[#bd9ee9]',
    chart:
      'border-[#ac8dde]/22 bg-[radial-gradient(circle_at_8%_0%,rgba(172,141,222,0.08),transparent_42%),rgba(18,18,26,0.96)]',
  }),
  transactions: Object.freeze({
    group:
      'border-[#70bdf2]/28 bg-[radial-gradient(circle_at_12%_0%,rgba(112,189,242,0.13),transparent_48%),repeating-linear-gradient(0deg,rgba(112,189,242,0.024)_0,rgba(112,189,242,0.024)_1px,transparent_1px,transparent_9px)]',
    heading: 'border-[#70bdf2]/18 text-[#83c8f7]',
    chart:
      'border-[#70bdf2]/22 bg-[radial-gradient(circle_at_8%_0%,rgba(112,189,242,0.08),transparent_42%),rgba(18,18,26,0.96)]',
  }),
})
const kpi_value_color = (tone?: KpiTone): string =>
  tone === 'gold'
    ? 'text-[#c8963c]'
    : tone === 'blue'
      ? 'text-[#70bdf2]'
      : tone === 'green'
        ? 'text-[#77d99a]'
        : tone === 'violet'
          ? 'text-[#bd9ee9]'
          : 'text-[#e8e4dc]'

const KpiGroup = ({ children, label, tone }: Readonly<{ children: ReactNode; label: string; tone: DashboardTone }>) => {
  const colors = DASHBOARD_TONES[tone]
  return (
    <section
      className={`flex h-32 w-max max-w-full flex-col overflow-hidden border ${colors.group}`}
      data-kpi-group={tone}
    >
      <h2
        className={`border-b bg-black/12 px-4 py-2 text-[8px] font-semibold tracking-[0.18em] uppercase ${colors.heading}`}
      >
        {label}
      </h2>
      <div className="flex min-h-0 max-w-full flex-1 flex-wrap items-stretch divide-x divide-white/[0.07]">
        {children}
      </div>
    </section>
  )
}

const Stat = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="min-w-0 border-r border-border px-3 last:border-r-0">
    <span className="block truncate text-[7px] tracking-[0.14em] text-[#6b7280] uppercase">{label}</span>
    <strong className="mt-1 block truncate text-[11px] font-medium text-[#e8e4dc] tabular-nums">{value}</strong>
  </div>
)

const KpiCard = ({
  detail,
  label,
  tone,
  value,
}: Readonly<{ detail: string; label: string; tone?: KpiTone; value: string }>) => (
  <article className="flex h-full w-max max-w-64 min-w-40 flex-col justify-between bg-black/10 px-4 py-3.5">
    <span className="truncate text-[8px] tracking-[0.15em] text-[#777d89] uppercase">{label}</span>
    <strong className={`mt-2 truncate text-xl font-semibold tracking-[-0.035em] tabular-nums ${kpi_value_color(tone)}`}>
      {value}
    </strong>
    <span className="mt-0.5 truncate text-[8px] text-[#5f6570]">{detail}</span>
  </article>
)

export const TimelineKpiCard = ({
  entries,
  label,
  tone,
}: Readonly<{
  entries: readonly Readonly<{ label: string; value: string }>[]
  label: string
  tone?: KpiTone
}>) => (
  <article className="flex h-full w-max max-w-full flex-col bg-black/10 px-4 py-3.5">
    <span className="text-[8px] tracking-[0.15em] text-[#777d89] uppercase">{label}</span>
    <div className="mt-2 grid flex-1 grid-cols-[repeat(3,max-content)] items-end">
      {entries.map((row, index) => (
        <div className={index === 0 ? 'pr-3' : 'border-l border-white/[0.07] px-3'} key={row.label}>
          <span className="block text-[8px] tracking-[0.12em] whitespace-nowrap text-[#5f6570] uppercase">
            {row.label}
          </span>
          <strong
            className={`mt-1 block text-base font-semibold whitespace-nowrap tabular-nums ${kpi_value_color(tone)}`}
          >
            {row.value}
          </strong>
        </div>
      ))}
    </div>
  </article>
)

const ChartPanel = ({
  copy,
  title,
  subtitle,
  days,
  change,
  series,
  timestamps,
  value_kind,
  bucket,
  loading,
  tone,
}: Readonly<{
  copy: Readonly<Record<string, string>>
  title: string
  subtitle: string
  days: AdminRangeDays
  change: (days: AdminRangeDays) => void
  series: readonly MetricSeries[]
  timestamps: readonly number[]
  value_kind: MetricValueKind
  bucket: AdminBucket
  loading: boolean
  tone: DashboardTone
}>) => (
  <section
    className={`min-w-0 overflow-hidden border shadow-[0_18px_50px_rgba(0,0,0,0.24)] ${DASHBOARD_TONES[tone].chart}`}
  >
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-[10px] font-semibold tracking-[0.16em] text-[#d9d5cd] uppercase">{title}</h2>
        <p className="mt-1 truncate text-[8px] text-[#6b7280]">{subtitle}</p>
      </div>
      <AdminRangeSelector change={change} copy={copy} days={days} />
    </header>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-3">
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-[7px] tracking-[0.08em] text-[#777b86] uppercase">
        {series.map((row) => (
          <span className="inline-flex items-center gap-1" key={row.label}>
            <i className="size-1.5" style={{ background: row.color }} />
            {row.label}
          </span>
        ))}
      </span>
      <span className="text-[7px] tracking-[0.12em] text-[#555b66] uppercase">
        {loading ? text(copy, 'loading', 'Loading…') : bucket_label(copy, bucket)}
      </span>
    </div>
    <div className="px-4 py-3">
      <MetricChart className="h-44" label={title} series={series} timestamps={timestamps} value_kind={value_kind} />
    </div>
  </section>
)

const revenue_series = (
  copy: Readonly<Record<string, string>>,
  revenue: AdminRevenueOverview
): readonly MetricSeries[] =>
  Object.freeze([
    Object.freeze({
      label: text(copy, 'item_royalties', 'Item royalties'),
      color: COLORS.violet,
      values: revenue.money.map((row) => sui_number(row.item_royalty_mist)),
    }),
    Object.freeze({
      label: text(copy, 'character_royalties', 'Character royalties'),
      color: COLORS.white,
      values: revenue.money.map((row) => sui_number(row.character_royalty_mist)),
    }),
    Object.freeze({
      label: text(copy, 'character_creation_revenue', 'Character creation'),
      color: COLORS.cyan,
      values: revenue.money.map((row) => sui_number(row.character_creation_mist)),
    }),
    Object.freeze({
      label: text(copy, 'kolizeum_revenue', 'Kolizeum fees'),
      color: COLORS.orange,
      values: revenue.money.map((row) => sui_number(row.kolizeum_mist)),
    }),
  ])

const player_series = (
  copy: Readonly<Record<string, string>>,
  players: AdminPlayersOverview
): readonly MetricSeries[] =>
  Object.freeze([
    Object.freeze({
      label: text(copy, 'active_players_bucket', 'Active players per bucket'),
      color: COLORS.blue,
      values: players.activity.map(({ active }) => active),
      area: true,
    }),
  ])

const transaction_series = (
  copy: Readonly<Record<string, string>>,
  transactions: AdminTransactionsOverview
): readonly MetricSeries[] =>
  Object.freeze([
    Object.freeze({
      label: text(copy, 'game_transactions', 'Game transactions'),
      color: COLORS.white,
      values: transactions.transactions.map((row) => row.transactions),
      area: true,
    }),
  ])

const online_series = (copy: Readonly<Record<string, string>>, online: AdminOnlineOverview): readonly MetricSeries[] =>
  Object.freeze([
    Object.freeze({
      label: text(copy, 'peak', 'Peak'),
      color: COLORS.white,
      values: online.online.map((row) => row.peak),
      area: true,
    }),
  ])

const address_series = (
  copy: Readonly<Record<string, string>>,
  addresses: AdminAddressesOverview
): readonly MetricSeries[] =>
  Object.freeze([
    {
      label: text(copy, 'unique_addresses', 'Unique addresses'),
      color: COLORS.violet,
      values: addresses.addresses.map(({ total }) => total),
      area: true,
    },
  ])

const character_series = (
  copy: Readonly<Record<string, string>>,
  characters: AdminCharactersOverview
): readonly MetricSeries[] =>
  Object.freeze([
    {
      label: text(copy, 'total_characters', 'Total characters'),
      color: COLORS.gold,
      values: characters.characters.map(({ total }) => total),
      area: true,
    },
  ])

const claim_label = (copy: Readonly<Record<string, string>>, revenue: AdminRevenue, claimable: bigint): string => {
  if (revenue.claiming) return text(copy, 'claiming', 'Claiming…')
  if (revenue.claim_armed) return text(copy, 'confirm_claim', 'Confirm claim')
  return `${text(copy, 'claim', 'Claim')} ${claimable > 0n ? `${format_sui(claimable, 2)} SUI` : ''}`
}
const treasury_value = (revenue: AdminRevenue): string =>
  revenue.treasury_mist === null ? '—' : `${format_sui(revenue.treasury_mist, 2)} SUI`
const claim_disabled = (revenue: AdminRevenue): boolean =>
  !revenue.connected || revenue.claimable <= 0n || revenue.claiming

const TreasuryStrip = ({
  copy,
  revenue,
}: Readonly<{ copy: Readonly<Record<string, string>>; revenue: AdminRevenue }>) => {
  const item = revenue.royalties.find((row) => row.kind === 'item')?.balance_mist ?? 0n
  const character = revenue.royalties.find((row) => row.kind === 'character')?.balance_mist ?? 0n
  const { claimable } = revenue
  return (
    <section className={`${PANEL} flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3`}>
      <div className="mr-auto min-w-0">
        <span className="text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
          {text(copy, 'treasury', 'Treasury')}
        </span>
        <strong className="ml-3 text-[12px] font-medium text-[#c8963c] tabular-nums">{treasury_value(revenue)}</strong>
      </div>
      <Stat label={text(copy, 'item_royalties', 'Item royalties')} value={`${format_sui(item, 2)} SUI`} />
      <Stat
        label={text(copy, 'character_royalties', 'Character royalties')}
        value={`${format_sui(character, 2)} SUI`}
      />
      <button
        className="h-8 shrink-0 border border-[#c8963c]/40 bg-[#c8963c]/8 px-4 text-[8px] tracking-[0.12em] text-[#c8963c] uppercase disabled:opacity-30"
        disabled={claim_disabled(revenue)}
        onClick={revenue.claim_armed ? revenue.claim : revenue.arm_claim}
        type="button"
      >
        {claim_label(copy, revenue, claimable)}
      </button>
    </section>
  )
}

const LoadingOverview = ({
  copy,
  overview,
}: Readonly<{ copy: Readonly<Record<string, string>>; overview: AdminOverviewState }>) => (
  <div className="grid min-h-0 flex-1 place-items-center bg-surface/50 text-[9px] tracking-[0.14em] text-[#6b7280] uppercase">
    <div className="text-center">
      <p>
        {overview.status === 'failed'
          ? text(copy, 'overview_unavailable', 'Overview unavailable')
          : text(copy, 'loading_overview', 'Loading overview…')}
      </p>
      {overview.error && <p className="mt-2 text-[#ff8caa]">{overview.error}</p>}
      {overview.status === 'failed' && (
        <button
          className="mt-4 border border-border px-3 py-2 text-[#c8963c]"
          onClick={() => dispatch_app({ type: 'admin/overview_refresh' })}
          type="button"
        >
          {text(copy, 'retry', 'Retry')}
        </button>
      )}
    </div>
  </div>
)

export const OverviewPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const overview = useAppStore((state) => state.admin.overview)
  const revenue_wallet = useAdminRevenue(copy)
  const { result } = overview
  if (!result) return <LoadingOverview copy={copy} overview={overview} />
  const { revenue, players, transactions, online, addresses, characters } = result
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface/50 p-4">
      <div className="flex items-center gap-3 px-1 text-[8px] tracking-[0.12em] text-[#6b7280] uppercase">
        <span className="text-[#77d99a]">● {text(copy, 'all_systems_current', 'All systems current')}</span>
        <span>
          {text(copy, 'checkpoint', 'Checkpoint')} {result.as_of_checkpoint?.toLocaleString() ?? '—'}
        </span>
        <button
          className="ml-auto text-[#c8963c]"
          onClick={() => dispatch_app({ type: 'admin/overview_refresh' })}
          type="button"
        >
          ↻ {text(copy, 'refresh', 'Refresh')}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-stretch gap-3" data-admin-kpis="">
        <KpiGroup label={text(copy, 'revenue', 'Revenue')} tone="revenue">
          <KpiCard
            detail={text(copy, 'last_30_days', 'Last 30 days')}
            label={text(copy, 'revenue_30d', '30-day revenue')}
            tone="gold"
            value={`${format_sui(BigInt(revenue.last_30d_revenue_mist), 2)} SUI`}
          />
          <KpiCard
            detail={text(copy, 'calendar_month_to_date', 'Calendar month to date')}
            label={text(copy, 'revenue_mtd', 'Month-to-date revenue')}
            tone="gold"
            value={`${format_sui(BigInt(revenue.month_to_date_revenue_mist), 2)} SUI`}
          />
        </KpiGroup>
        <KpiGroup label={text(copy, 'player_activity', 'Player activity')} tone="activity">
          <KpiCard
            detail={text(copy, 'today', 'Today')}
            label={text(copy, 'daily_active', 'Daily active players')}
            tone="blue"
            value={players.dau.toLocaleString()}
          />
          <KpiCard
            detail={text(copy, 'active_last_30d', 'Active in the last 30 days')}
            label={text(copy, 'active_30d', '30-day active players')}
            tone="blue"
            value={players.rolling_30d.toLocaleString()}
          />
          <KpiCard
            detail={`${text(copy, 'peak', 'Peak')} ${display_count(online.online_peak)}`}
            label={text(copy, 'online_now', 'Players online')}
            tone="green"
            value={display_count(online.online_now)}
          />
        </KpiGroup>
        <KpiGroup label={text(copy, 'population', 'Population')} tone="population">
          <KpiCard
            detail={text(copy, 'successful_game_calls', 'Successful game-module callers')}
            label={text(copy, 'unique_addresses', 'Unique addresses')}
            tone="violet"
            value={addresses.total.toLocaleString()}
          />
          <KpiCard
            detail={text(copy, 'current_characters', 'Current on-chain characters')}
            label={text(copy, 'total_characters', 'Total characters')}
            tone="violet"
            value={characters.total.toLocaleString()}
          />
        </KpiGroup>
        <KpiGroup label={text(copy, 'game_transactions', 'Game transactions')} tone="transactions">
          <TimelineKpiCard
            entries={Object.freeze([
              Object.freeze({ label: admin_range_label(copy, 1), value: display_count(transactions.last_24h) }),
              Object.freeze({ label: admin_range_label(copy, 30), value: display_count(transactions.last_30d) }),
              Object.freeze({ label: text(copy, 'all_time', 'All time'), value: display_count(transactions.all_time) }),
            ])}
            label={text(copy, 'game_transactions', 'Game transactions')}
            tone="blue"
          />
          <TimelineKpiCard
            entries={Object.freeze([
              Object.freeze({ label: admin_range_label(copy, 1), value: display_sui(transactions.gas_last_24h_mist) }),
              Object.freeze({ label: admin_range_label(copy, 30), value: display_sui(transactions.gas_last_30d_mist) }),
              Object.freeze({
                label: text(copy, 'all_time', 'All time'),
                value: display_sui(transactions.gas_all_time_mist),
              }),
            ])}
            label={text(copy, 'game_gas_fees', 'Game gas fees')}
            tone="gold"
          />
        </KpiGroup>
      </div>
      <div className="mt-3">
        <TreasuryStrip copy={copy} revenue={revenue_wallet} />
      </div>
      <div className="mt-3 flex flex-col gap-3" data-admin-charts="">
        <div className="grid gap-3 xl:grid-cols-2">
          <ChartPanel
            bucket={revenue.bucket}
            change={(days) => dispatch_app({ type: 'admin/overview_range_changed', section: 'revenue', days })}
            copy={copy}
            days={overview.ranges.revenue}
            loading={!!overview.pending.revenue}
            series={revenue_series(copy, revenue)}
            subtitle={text(copy, 'revenue_over_time_body', 'All protocol revenue by source')}
            timestamps={revenue.money.map(({ at_ms }) => at_ms)}
            title={text(copy, 'revenue_over_time', 'Revenue over time')}
            tone="revenue"
            value_kind="continuous"
          />
          <ChartPanel
            bucket={transactions.bucket}
            change={(days) => dispatch_app({ type: 'admin/overview_range_changed', section: 'transactions', days })}
            copy={copy}
            days={overview.ranges.transactions}
            loading={!!overview.pending.transactions}
            series={transaction_series(copy, transactions)}
            subtitle={text(copy, 'game_transactions_body', 'Successful AresRPG transactions, counted once per PTB')}
            timestamps={transactions.transactions.map(({ at_ms }) => at_ms)}
            title={text(copy, 'game_transactions_over_time', 'Transactions over time')}
            tone="transactions"
            value_kind="count"
          />
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <ChartPanel
            bucket={players.bucket}
            change={(days) => dispatch_app({ type: 'admin/overview_range_changed', section: 'players', days })}
            copy={copy}
            days={overview.ranges.players}
            loading={!!overview.pending.players}
            series={player_series(copy, players)}
            subtitle={text(copy, 'player_activity_body', 'Daily activity and rolling 30-day reach')}
            timestamps={players.activity.map(({ at_ms }) => at_ms)}
            title={text(copy, 'player_activity', 'Player activity')}
            tone="activity"
            value_kind="count"
          />
          <ChartPanel
            bucket={online.bucket}
            change={(days) => dispatch_app({ type: 'admin/overview_range_changed', section: 'online', days })}
            copy={copy}
            days={overview.ranges.online}
            loading={!!overview.pending.online}
            series={online_series(copy, online)}
            subtitle={text(copy, 'online_players_body', 'Peak authenticated connections per bucket')}
            timestamps={online.online.map(({ at_ms }) => at_ms)}
            title={text(copy, 'online_players', 'Online players')}
            tone="activity"
            value_kind="count"
          />
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <ChartPanel
            bucket={addresses.bucket}
            change={(days) => dispatch_app({ type: 'admin/overview_range_changed', section: 'addresses', days })}
            copy={copy}
            days={overview.ranges.addresses}
            loading={!!overview.pending.addresses}
            series={address_series(copy, addresses)}
            subtitle={text(copy, 'unique_addresses_body', 'Addresses with successful AresRPG module calls')}
            timestamps={addresses.addresses.map(({ at_ms }) => at_ms)}
            title={text(copy, 'unique_addresses_over_time', 'Unique addresses over time')}
            tone="population"
            value_kind="count"
          />
          <ChartPanel
            bucket={characters.bucket}
            change={(days) => dispatch_app({ type: 'admin/overview_range_changed', section: 'characters', days })}
            copy={copy}
            days={overview.ranges.characters}
            loading={!!overview.pending.characters}
            series={character_series(copy, characters)}
            subtitle={text(copy, 'total_characters_body', 'Current on-chain Character objects')}
            timestamps={characters.characters.map(({ at_ms }) => at_ms)}
            title={text(copy, 'characters_over_time', 'Characters over time')}
            tone="population"
            value_kind="count"
          />
        </div>
      </div>
    </div>
  )
}
