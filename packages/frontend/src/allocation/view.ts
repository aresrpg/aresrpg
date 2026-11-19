// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  cap_mist,
  nominal_tokens,
  type AllocationStatus,
  type AllocationWallet,
  type PublicAward,
} from '@aresrpg/immutable/allocation'

import type { AuthSession } from '../auth.ts'

export const wallet_label = (wallet: AllocationWallet, session: AuthSession | null): string =>
  wallet.label || (wallet.address === session?.address ? session.wallet_name : '')

export const short_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`
export type CardView = Readonly<{ wallet: AllocationWallet; award: PublicAward }>
export const allocation_view = (status: AllocationStatus | null) => {
  const cards: readonly CardView[] = status
    ? [...new Map(status.wallets.map((wallet) => [wallet.address, wallet])).values()].flatMap((wallet) => {
        const award = status.awards.find(({ address }) => address === wallet.address)
        return award ? [{ wallet, award }] : []
      })
    : []
  return {
    cards,
    loaded: !!status,
    spots: cards.length,
    sui: cards.reduce((sum, { award }) => sum + Number(cap_mist(award.tier)) / 1e9, 0),
    tokens: cards.reduce((sum, { award }) => sum + nominal_tokens(award.tier), 0),
  }
}
