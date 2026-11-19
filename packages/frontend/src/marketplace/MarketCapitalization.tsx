// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { MarketCapitalization as MarketCapitalizationCard } from '@aresrpg/ui'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { CopyText } from '../i18n/copy.ts'

import { useMarketState } from './MarketSource.tsx'
import { market_capitalization } from './price_history_model.ts'

export const MarketCapitalization = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const { prices } = useMarketState()
  const numbers = useNumbers()
  const history = prices.observation?.item_type === item_type ? prices.history : null
  const total_units = prices.observation?.item_type === item_type ? prices.total_units : null
  const capitalization = market_capitalization(history, total_units)
  if (total_units === null) return null
  return (
    <MarketCapitalizationCard
      labels={{
        total_units: text('total_units'),
        market_cap: text('market_cap'),
        market_cap_basis: text('market_cap_basis'),
      }}
      units={numbers.number(BigInt(total_units))}
      capitalization={capitalization === null ? null : numbers.sui(capitalization, 2)}
    />
  )
}
