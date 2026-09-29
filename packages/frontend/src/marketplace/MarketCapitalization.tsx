// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useNumbers } from '../i18n/useNumbers.ts'
import type { CopyText } from '../i18n/copy.ts'

import { useMarketState } from './MarketSource.tsx'
import { market_capitalization } from './price_history_model.ts'
import { SuiUnit } from './marketplace_model.tsx'

export const MarketCapitalization = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const { prices } = useMarketState()
  const numbers = useNumbers()
  const history = prices.observation?.item_type === item_type ? prices.history : null
  const total_units = prices.observation?.item_type === item_type ? prices.total_units : null
  const capitalization = market_capitalization(history, total_units)
  if (total_units === null) return null
  return (
    <aside
      className="flex min-w-40 shrink-0 flex-col gap-3 rounded-sm border border-border bg-surface-high px-4 py-3"
      data-marketplace-capitalization
    >
      <div>
        <span className="block text-[8px] tracking-widest text-muted uppercase">{text('total_units')}</span>
        <strong className="mt-1 block text-sm font-semibold text-text tabular-nums">
          {numbers.number(BigInt(total_units))}
        </strong>
      </div>
      {capitalization !== null && (
        <div title={text('market_cap_basis')}>
          <span className="block text-[8px] tracking-widest text-muted uppercase">{text('market_cap')}</span>
          <strong className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-gold tabular-nums">
            {numbers.sui(capitalization, 2)} <SuiUnit size={12} />
          </strong>
        </div>
      )}
    </aside>
  )
}
