// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { GiftcardRow } from '@aresrpg/protocol'

export type GiftcardGroup = Readonly<{ template: string; amount: number }>

export const group_giftcards = (cards: readonly GiftcardRow[]): readonly GiftcardGroup[] =>
  Object.values(
    [...new Map(cards.map((card) => [card.id, card])).values()].reduce<Record<string, GiftcardGroup>>(
      (groups, card) => ({
        ...groups,
        [card.template]: { template: card.template, amount: (groups[card.template]?.amount ?? 0) + card.amount },
      }),
      {}
    )
  )
