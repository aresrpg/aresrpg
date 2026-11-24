// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import source from '../../../../seed/content/mastery.json'

import { items_by_type } from './items.ts'

type MasterySource = Readonly<{
  offers: readonly Readonly<{ item_type: string; cost: number; enabled?: boolean }>[]
}>

/** The Mastery shop's authored offers, each with its item; the staking page reads this table and the items. */
export const mastery_offers = Object.freeze(
  (source as unknown as MasterySource).offers.map((offer) =>
    Object.freeze({ ...offer, item: items_by_type[offer.item_type] ?? null })
  )
)
