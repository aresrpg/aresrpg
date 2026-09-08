// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { KARES_ALLOCATION, KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'
import { Flame, Gem, Waves } from 'lucide-react'

import type { KaresCopy } from './copy.ts'
import { format_amount } from './model.ts'
import { finance_label } from './components.tsx'

export const TokenomicsTab = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const allocations = [
    { label: `${copy.community} (${copy.vested_five_years})`, amount: KARES_ALLOCATION.community, color: '#b395dd' },
    { label: `${copy.offering} (${copy.unlocked_immediately})`, amount: KARES_ALLOCATION.offering, color: '#c8963c' },
    { label: `${copy.five_years} (${copy.vested_five_years})`, amount: KARES_ALLOCATION.rewards, color: '#4a9eff' },
    { label: copy.liquidity, amount: KARES_ALLOCATION.liquidity, color: '#60bca9' },
    { label: copy.combat_rewards, amount: KARES_ALLOCATION.combat, color: '#bd795c' },
    { label: copy.team, amount: KARES_ALLOCATION.team, color: '#899097' },
  ].map((row) => ({ ...row, share: Number((row.amount * 100n) / KARES_SUPPLY) }))
  return (
    <section className="mx-auto w-full max-w-5xl p-5 lg:p-10">
      <div className={finance_label}>{copy.tokenomics}</div>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-gold-light">
        {format_amount(KARES_SUPPLY)} <span className="text-lg text-gold">KARES</span>
      </h1>
      <p className="mt-3 text-xs text-muted">{copy.fixed_supply}</p>
      <p className="mt-4 max-w-3xl text-[11px] leading-6 text-muted">{copy.supply_detail}</p>
      <div aria-hidden="true" className="mt-8 flex h-3 gap-1">
        {allocations.map((row) => (
          <span key={row.label} style={{ width: `${row.share}%`, background: row.color }} />
        ))}
      </div>
      <div className="mt-5 divide-y divide-white/7 border-y border-border">
        {allocations.map((row) => (
          <div className="flex flex-wrap items-center gap-3 py-4 text-xs" key={row.label}>
            <span className="size-2" style={{ background: row.color }} />
            <span className="min-w-40 flex-1 text-muted">{row.label}</span>
            <span className="text-text tabular-nums">{format_amount(row.amount)}</span>
            <span className="w-12 text-right text-gold tabular-nums">{row.share}%</span>
          </div>
        ))}
      </div>
      <div className="mt-6 border border-gold/20 bg-gold/4 p-5">
        <h2 className="text-sm text-gold">{copy.community}</h2>
        <p className="mt-3 text-[11px] leading-6 text-muted">{copy.community_detail}</p>
        <p className="mt-3 text-[11px] leading-6 text-muted">{copy.community_release_note}</p>
      </div>
      <div className="mt-6 border border-border bg-surface-low/60 p-5">
        <h2 className="text-sm text-gold">{copy.combat_rewards}</h2>
        <p className="mt-3 text-[11px] leading-6 text-muted">{copy.combat_detail}</p>
      </div>
      <p className="mt-5 text-[11px] leading-6 text-muted">{copy.allocation_rationale}</p>
      <p className="mt-5 text-[11px] leading-6 text-muted">{copy.emissions_detail}</p>
      <p className="mt-3 text-[11px] leading-6 text-muted">{copy.sale_unlock_note}</p>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {[
          { Icon: Flame, title: copy.mastery_title, body: copy.mastery_note },
          { Icon: Gem, title: copy.five_years, body: copy.rewards_note },
          { Icon: Waves, title: copy.claimable, body: copy.revenue_note },
        ].map(({ Icon, title, body }) => (
          <article className="border border-border bg-surface-low/60 p-5" key={title}>
            <Icon className="text-gold" size={20} />
            <h2 className="mt-4 text-sm text-text">{title}</h2>
            <p className="mt-3 text-[11px] leading-6 text-muted">{body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
