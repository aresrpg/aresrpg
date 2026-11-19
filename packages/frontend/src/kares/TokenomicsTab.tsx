// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import { useNumbers } from '../i18n/useNumbers.ts'

import type { KaresCopy } from './copy.ts'
import { kares_distribution } from './distribution.ts'
import { Tokenomics } from './TokenomicsPanel.tsx'

/** The token's live ledger, then its fixed distribution. The host supplies the surface it sits on. */
export const TokenomicsTab = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const { amount: format_amount } = useNumbers()
  const allocations = kares_distribution(copy)
  return (
    <div className="tokenomics-tab">
      <Tokenomics copy={copy} />
      <div className="kares-ledger">
        <section>
          <h3 className="tk-h">{copy.fixed_supply}</h3>
          <p className="tk-total">
            {format_amount(KARES_SUPPLY)}
            <small>KARES</small>
          </p>
          <div aria-hidden="true" className="tk-bar">
            {allocations.map((row) => (
              <span key={row.label} style={{ width: `${row.share}%`, background: row.color }} />
            ))}
          </div>
          <dl className="tk-shares">
            {allocations.map((row) => (
              <div key={row.label}>
                <i style={{ background: row.color }} />
                <dt>{row.label}</dt>
                <dd>{format_amount(row.amount)}</dd>
                <dd>{row.share}%</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="tk-notes">
          <p>{copy.rewards_note}</p>
          <p>{copy.revenue_note}</p>
          <p>{copy.emissions_detail}</p>
          <p>{copy.upgradeability_note}</p>
        </div>
      </div>
    </div>
  )
}
