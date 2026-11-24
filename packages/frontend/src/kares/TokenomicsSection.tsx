// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import { useNumbers } from '../i18n/useNumbers.ts'

import type { KaresCopy } from './copy.ts'
import { kares_distribution } from './distribution.ts'
import { HEADING, LEDGER, SECTION, Tokenomics } from './TokenomicsPanel.tsx'

const SHARE = 'text-right font-mono text-[13px]/none font-semibold tabular-nums'

/** The token's live ledger, then its fixed distribution. The staking page supplies the panel it sits on. */
export const TokenomicsSection = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const { amount: format_amount } = useNumbers()
  const allocations = kares_distribution(copy)
  return (
    <div className="grid grid-cols-1 gap-7 p-5.5 max-[760px]:p-4">
      <Tokenomics copy={copy} />
      <div className={LEDGER}>
        <section className={SECTION}>
          <h3 className={HEADING}>{copy.fixed_supply}</h3>
          <p className="font-mono text-[length:clamp(26px,3vw,36px)]/none font-semibold tracking-[-0.02em] text-text tabular-nums">
            {format_amount(KARES_SUPPLY)}
            <small className="ml-[0.4em] font-mono text-xs/none font-bold tracking-widest text-hue-gold">KARES</small>
          </p>
          <div aria-hidden="true" className="flex h-2.5 gap-0.75">
            {allocations.map((row) => (
              <span key={row.label} style={{ width: `${row.share}%`, background: row.color }} />
            ))}
          </div>
          <dl>
            {allocations.map((row) => (
              <div
                className="grid grid-cols-[auto_minmax(0,1fr)_auto_5ch] items-center gap-3 border-t border-line py-2.5 text-[13px]"
                key={row.label}
              >
                <i className="size-2" style={{ background: row.color }} />
                <dt className="text-soft">{row.label}</dt>
                <dd className={`${SHARE} text-text`}>{format_amount(row.amount)}</dd>
                <dd className={`${SHARE} text-hue-gold`}>{row.share}%</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="grid grid-cols-2 gap-x-7 gap-y-3 *:text-[13px]/[1.55] *:text-muted max-[899px]:grid-cols-1">
          <p>{copy.rewards_note}</p>
          <p>{copy.revenue_note}</p>
          <p>{copy.emissions_detail}</p>
          <p>{copy.upgradeability_note}</p>
        </div>
      </div>
    </div>
  )
}
