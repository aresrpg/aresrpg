// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import type { KaresCopy } from '../kares/copy.ts'
import { kares_distribution } from '../kares/distribution.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

export const SupplyCard = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const { amount } = useNumbers()
  const rows = kares_distribution(copy)
  return (
    <section className="supply-card">
      <header>
        <div>
          <h2>{copy.tokenomics}</h2>
          <p>{copy.supply_detail}</p>
        </div>
        <b>
          {amount(KARES_SUPPLY)} <small>KARES</small>
        </b>
      </header>
      <div className="supply-bar" aria-hidden="true">
        {rows.map((row) => (
          <span key={row.label} style={{ width: `${row.share}%`, background: row.color }} />
        ))}
      </div>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>
              <i style={{ background: row.color }} />
              {row.label}
            </dt>
            <dd>{row.share}%</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
