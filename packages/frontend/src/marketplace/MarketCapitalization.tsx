// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useNumbers } from '../i18n/useNumbers.ts'
import { useAppStore } from '../store.ts'
import type { CopyText } from '../i18n/copy.ts'

import { market_capitalization } from './price_history_model.ts'
import { SuiUnit } from './marketplace_model.tsx'

export const MarketCapitalization = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const prices = useAppStore(({ marketplace }) => marketplace.prices)
  const numbers = useNumbers()
  const history = prices.observation?.item_type === item_type ? prices.history : null
  const capitalization = market_capitalization(history)
  if (capitalization === null) return null
  return (
    <aside
      className="flex min-w-40 shrink-0 flex-col gap-3 rounded-sm border border-border bg-surface-high px-4 py-3"
      data-marketplace-capitalization
      title={text('market_cap_basis')}
    >
      <div>
        <span className="block text-[8px] tracking-widest text-muted uppercase">{text('total_units')}</span>
        <strong className="mt-1 block text-sm font-semibold text-text tabular-nums">
          {numbers.number(BigInt(history!.total_units!))}
        </strong>
      </div>
      <div>
        <span className="block text-[8px] tracking-widest text-muted uppercase">{text('market_cap')}</span>
        <strong className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-gold tabular-nums">
          {numbers.sui(capitalization, 2)} <SuiUnit size={12} />
        </strong>
      </div>
    </aside>
  )
}
