// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import { AdminWalletPanel, useAdminRevenue } from './AdminWalletPanel.tsx'

const card_class =
  'rounded-xl border border-white/[0.075] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))]'

const KpiCard = ({
  label,
  value,
  unit,
  gold = false,
  title,
}: Readonly<{ label: string; value: string; unit?: string; gold?: boolean; title?: string }>) => (
  <div className={`${card_class} min-h-28 px-4 py-4`} title={title}>
    <p className="text-[8px] tracking-[0.13em] text-[#858993] uppercase">{label}</p>
    <p className={`mt-5 text-[26px] font-light leading-none ${gold ? 'text-[#efbd45]' : 'text-[#e4dfd6]'}`}>
      {value}
      {unit && <span className="ml-2 text-[9px] tracking-[0.12em] text-[#8a8172] uppercase">{unit}</span>}
    </p>
  </div>
)

const EmptyVolumeChart = () => (
  <div className={`${card_class} flex min-h-[430px] flex-col p-5 xl:col-span-8`}>
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[9px] tracking-[0.18em] text-[#d8d3ca] uppercase">Daily shop volume</p>
        <p className="mt-2 text-[8px] text-[#626771]">30 days</p>
      </div>
      <span className="text-[8px] tracking-[0.1em] text-[#555b65] uppercase">SUI</span>
    </div>
    <div className="mt-8 grid min-h-0 flex-1 grid-cols-[28px_1fr] gap-3">
      <div className="flex flex-col justify-between pb-5 text-right text-[7px] text-[#4f545d]">
        <span>—</span>
        <span>—</span>
        <span>0</span>
      </div>
      <div className="relative min-h-72 border-b border-l border-white/[0.08]">
        <div className="absolute inset-0 grid grid-rows-4">
          {Array.from({ length: 4 }, (_, index) => (
            <span className="border-t border-white/[0.035]" key={index} />
          ))}
        </div>
        <div className="absolute inset-x-3 inset-y-0 grid grid-cols-[repeat(30,minmax(2px,1fr))] items-end gap-1">
          {Array.from({ length: 30 }, (_, index) => (
            <span
              className="h-px bg-gradient-to-t from-[#c8963c]/35 to-[#efbd45]/60"
              key={index}
              title="No volume projection"
            />
          ))}
        </div>
      </div>
    </div>
    <div className="ml-10 mt-3 flex justify-between text-[7px] tracking-[0.08em] text-[#555b65] uppercase">
      <span>30 days ago</span>
      <span>Today</span>
    </div>
  </div>
)

const PlayersCard = ({
  online,
  indexed,
  loading,
}: Readonly<{ online: number | null; indexed: number | undefined; loading: boolean }>) => (
  <section className={`${card_class} p-5`}>
    <div className="flex items-center justify-between gap-4">
      <p className="text-[9px] tracking-[0.18em] text-[#d8d3ca] uppercase">Players</p>
      <button
        className="cursor-pointer text-[8px] tracking-[0.12em] text-[#67adff] uppercase disabled:cursor-not-allowed disabled:opacity-35"
        disabled={loading}
        onClick={() => dispatch_app({ type: 'admin/overview_refresh' })}
        type="button"
      >
        {loading ? 'Reading…' : 'Refresh'}
      </button>
    </div>
    <div className="mt-4 flex min-h-11 items-center justify-between border-b border-white/[0.055] py-2">
      <span className="text-[8px] tracking-[0.08em] text-[#858993] uppercase">Online now</span>
      <span className="text-sm text-[#67adff]">{online?.toLocaleString() ?? '—'}</span>
    </div>
    <div className="flex min-h-11 items-center justify-between py-2">
      <span className="text-[8px] tracking-[0.08em] text-[#858993] uppercase">Indexed users</span>
      <span className="text-sm text-[#d8d3ca]">{indexed?.toLocaleString() ?? '—'}</span>
    </div>
  </section>
)

export const OverviewPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const admin = useAppStore((state) => state.admin)
  const online = useAppStore((state) => state.session.online)
  const revenue = useAdminRevenue(copy)
  const collectable = revenue.royalties.length > 0 && !revenue.reading ? format_sui(revenue.claimable, 4) : '—'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(200,150,60,0.025),transparent_28%)] p-5 md:p-7">
      <div className="mx-auto max-w-7xl">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard
            gold
            label="Collectable now"
            title="Withdrawable marketplace royalties"
            unit="SUI"
            value={collectable}
          />
          <KpiCard gold label="Shop volume 30d" title="No volume projection" unit="SUI" value="—" />
          <KpiCard label="Sales 30d" title="No sales projection" value="—" />
          <KpiCard label="MAU" title="No monthly-active-player projection" value="—" />
          <KpiCard label="DAU" title="No daily-active-player projection" value="—" />
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-12">
          <EmptyVolumeChart />
          <aside className="flex flex-col gap-4 xl:col-span-4">
            <AdminWalletPanel copy={copy} revenue={revenue} />
            <PlayersCard
              indexed={admin.overview.counts.User}
              loading={admin.overview.status === 'loading'}
              online={online}
            />
          </aside>
        </section>
      </div>
    </div>
  )
}
