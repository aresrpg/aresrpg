// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import { useNumbers } from '../i18n/useNumbers.ts'

import type { KaresCopy } from './copy.ts'
import { kares_distribution } from './distribution.ts'
import { Tokenomics } from './TokenomicsPanel.tsx'

export const TokenomicsTab = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const { amount: format_amount } = useNumbers()
  const allocations = kares_distribution(copy)
  return (
    <section className="mx-auto w-full max-w-5xl p-3 lg:p-6">
      <Tokenomics copy={copy} />
      <details className="mt-6 text-xs text-muted">
        <summary className="cursor-pointer text-gold">{copy.tokenomics}</summary>
        <h2 className="mt-10 text-sm text-gold">{copy.fixed_supply}</h2>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-gold-light">
          {format_amount(KARES_SUPPLY)} <span className="text-lg text-gold">KARES</span>
        </p>
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

        <p className="mt-4 leading-6">{copy.rewards_note}</p>
        <p className="mt-4 leading-6">{copy.revenue_note}</p>
        <p className="mt-4 leading-6">{copy.emissions_detail}</p>
        <p className="mt-4 leading-6">{copy.upgradeability_note}</p>
      </details>
    </section>
  )
}
