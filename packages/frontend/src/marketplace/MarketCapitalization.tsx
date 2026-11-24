// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { MarketCapitalization as MarketCapitalizationCard } from '@aresrpg/ui'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { CopyText } from '../i18n/copy.ts'
import { useSiteStore } from '../store.ts'

import { market_capitalization } from './price_history_model.ts'
import { price_read_of } from './price_history_state.ts'

/** An item's supply and market cap. The card keeps both lines; a figure not known yet, or unknown, is a dash. */
export const MarketCapitalization = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const prices = useSiteStore(({ marketplace }) => marketplace.prices)
  const numbers = useNumbers()
  const read = price_read_of(prices, item_type)
  const total_units = read.status === 'read' ? read.total_units : null
  const capitalization = read.status === 'read' ? market_capitalization(read.history, total_units) : null
  return (
    <MarketCapitalizationCard
      labels={{
        total_units: text('total_units'),
        market_cap: text('market_cap'),
        market_cap_basis: text('market_cap_basis'),
      }}
      units={total_units === null ? '—' : numbers.number(BigInt(total_units))}
      capitalization={capitalization === null ? '—' : numbers.sui(capitalization, 2)}
    />
  )
}
